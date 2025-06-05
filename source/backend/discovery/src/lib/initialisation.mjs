// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module handles the initialisation and validation steps required
 * before the main resource discovery process can begin. It performs checks
 * such as verifying VPC connectivity to AWS services, validating the Config aggregator,
 * and ensuring that another discovery ECS task is not already running.
 */

import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import logger from './logger.mjs'; // Imports the logging utility.
import {createApiClient} from './apiClient/index.mjs'; // Imports the API client factory.
import {
    AggregatorNotFoundError,
    OrgAggregatorValidationError,
    RequiredServicesTimeoutError,
} from './errors.mjs'; // Imports custom error classes for specific validation failures.
import {
    AWS_ORGANIZATIONS,
    ECS,
    WORKLOAD_DISCOVERY_TASKGROUP,
    TASK_DEFINITION,
    DISCOVERY_PROCESS_RUNNING,
} from './constants.mjs' // Imports constants related to AWS Organizations, ECS, and discovery status.
import {createArn, profileAsync} from './utils.mjs'; // Imports utility functions for ARN creation and async profiling.
import {PromisePool} from '@supercharge/promise-pool'; // Imports PromisePool for concurrent promise execution with concurrency control.

/**
 * Checks if another discovery ECS task is currently running in the specified cluster.
 * This prevents multiple discovery processes from potentially conflicting with each other.
 * It filters tasks by task definition ARN, ignoring the version.
 * @param {object} ecsClient - The ECS client instance.
 * @param {string} taskDefinitionArn - The ARN of the discovery task definition (without version).
 * @param {object} config - Configuration object containing the cluster name.
 * @returns {Promise<boolean>} True if more than one discovery task is running, false otherwise.
 */
async function isDiscoveryEcsTaskRunning (ecsClient, taskDefinitionArn, {cluster}) {
    const tasks = await ecsClient.getAllClusterTasks(cluster)
        .then(R.filter(task => {
            // The number after the last colon in the ARN is the version of the task definition.
            // We strip it out as we can't know what number it will be.
            // Furthermore, it's not relevant as we just need to know if there's another discovery task
            // potentially writing to the DB.
            return task.taskDefinitionArn.slice(0, task.taskDefinitionArn.lastIndexOf(':')) === taskDefinitionArn;
        }));

    logger.debug('Discovery ECS tasks currently running:', {tasks});

    // If more than one task is running, it indicates a potential conflict (the current one + another).
    return tasks.length > 1;
}

/**
 * Validates if the specified AWS Config aggregator exists and is configured for organization-wide aggregation.
 * Throws `AggregatorNotFoundError` if the aggregator does not exist, or `OrgAggregatorValidationError`
 * if it's not an organization-wide aggregator when required.
 * @param {object} configServiceClient - The AWS Config Service client instance.
 * @param {string} aggregatorName - The name of the AWS Config aggregator to validate.
 * @returns {Promise<void>} A promise that resolves if validation passes, or rejects with an error.
 */
async function validateOrgAggregator(configServiceClient, aggregatorName) {
    return configServiceClient.getConfigAggregator(aggregatorName)
        .catch(err => {
            // If the aggregator is not found, throw a custom error.
            if(err.name === 'NoSuchConfigurationAggregatorException') {
                throw new AggregatorNotFoundError(aggregatorName)
            }
            throw err; // Re-throw other errors.
        })
        .then(aggregator => {
            // If the aggregator does not have an OrganizationAggregationSource, it's not organization-wide.
            if(aggregator.OrganizationAggregationSource == null) throw new OrgAggregatorValidationError(aggregator);
        });
}

/**
 * Validates the VPC connectivity of the Workload Discovery account to required AWS services and API endpoints.
 * It attempts to fetch data from various global and regional AWS service endpoints.
 * If any required service times out, it logs an error and throws a `RequiredServicesTimeoutError`.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {object} config - Configuration object containing VPC ID, region, and GraphQL API URL.
 * @returns {Promise<void>} A promise that resolves if all connections are successful, or rejects with an error.
 */
async function validateWdAccountVpcConfiguration(awsClient, {isUsingOrganizations, vpcId, region, graphgQlUrl}) {
    const ec2Client = awsClient.createEc2Client();

    // Attempt to list NAT Gateways in the VPC. A timeout here indicates a potential routing issue to the public internet.
    const natGateways = await ec2Client.getNatGateways(vpcId)
        .catch(err => {
            // We don't throw here because we still want to do other connection checks to the required
            // AWS services: this error will caught again when we test the ability to route to EC2
            if (err.name === 'TimeoutError') {
                logger.error(`Failed to list NAT Gateways in ${vpcId}. The discovery process must be able to route to the public internet to function correctly.`);
                return []; // Return empty array to allow other checks to proceed.
            }
            throw err; // Re-throw other errors.
        });

    if (!R.isEmpty(natGateways)) {
        logger.info(`The VPC has ${natGateways.length} NAT Gateway(s).`, {
            natGateways: natGateways.map(x => x.NatGatewayId),
        });
    }

    logger.info('Verifying VPC connectivity to required AWS services and API endpoints.');

    // Define global AWS service URLs to test connectivity.
    const requiredAwsGlobalServiceUrls = [
        {url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08', service: 'IAM'},
    ];

    // Add AWS Organizations endpoint if cross-account discovery is enabled for organizations.
    if (isUsingOrganizations) {
        requiredAwsGlobalServiceUrls.push({
            url: 'https://organizations.us-east-1.amazonaws.com/?Action=ListAccounts',
            service: 'AWS Organizations',
        });
    }

    // Define regional AWS service URLs to test connectivity.
    const requiredAwsRegionalServiceUrls = [
        {url: `https://sts.${region}.amazonaws.com/?Action=GetCallerIdentity`, service: 'STS'},
        {
            url: `https://config.${region}.amazonaws.com/?Action=DescribeConfigurationRecorders`,
            service: 'AWS Config',
        },
        {url: `https://apigateway.${region}.amazonaws.com/restapis`, service: 'API Gateway'},
        {url: `https://dynamodb.${region}.amazonaws.com/?Action=ListTables`, service: 'DynamoDB'},
        {url: `https://ec2.${region}.amazonaws.com/?Action=DescribeInstances`, service: 'EC2'},
        {url: `https://ecs.${region}.amazonaws.com/?Action=ListClusters`, service: 'ECS'},
        {
            url: `https://elasticloadbalancing.${region}.amazonaws.com/?Action=DescribeLoadBalancers`,
            service: 'ELB',
        },
        {url: `https://eks.${region}.amazonaws.com/?Action=ListClusters`, service: 'EKS'},
        {url: `https://lambda.${region}.amazonaws.com/?Action=ListFunctions`, service: 'Lambda'},
        {
            url: `https://mediaconnect.${region}.amazonaws.com/?Action=ListFlows`,
            service: 'MediaConnect',
        },
        {url: `https://es.${region}.amazonaws.com/?Action=ListDomainNames1`, service: 'OpenSearch'},
        {url: `https://sns.${region}.amazonaws.com/?Action=ListTopics`, service: 'SNS'},
        {
            url: `https://servicecatalog-appregistry.${region}.amazonaws.com/?Action=ListApplications`,
            service: 'Service Catalog App Registry',
        },
        {
            url: `https://logs.${region}.amazonaws.com/?Action=DescribeLogGroups`,
            service: 'CloudWatch',
        },
        {url: graphgQlUrl, service: 'AppSync API'}, // Include the AppSync GraphQL API endpoint.
    ];

    // Use PromisePool to concurrently fetch from all required service URLs with a timeout.
    const {errors} = await PromisePool
        .withConcurrency(10) // Limit concurrency to 10 requests at a time.
        .for([
            ...requiredAwsRegionalServiceUrls,
            ...requiredAwsGlobalServiceUrls,
        ])
        .process(async ({url}) => {
            // Fetch each URL with a 5-second timeout.
            return fetch(url, {signal: AbortSignal.timeout(5000)});
        });

    // Filter for timeout errors specifically.
    const timeoutErrors = errors.filter(error => error.raw.name === 'TimeoutError');

    // If any timeout errors occurred, log them and throw a consolidated error.
    if (timeoutErrors.length > 0) {
        timeoutErrors.forEach(error => {
            logger.error(`Could not connect to ${error.item.service} API.`);
        });
        throw new RequiredServicesTimeoutError(timeoutErrors.map(error => error.item.service));
    }
}

/**
 * Initializes the discovery process by performing necessary validations and setting up clients.
 * This function:
 * 1. Validates VPC connectivity to required AWS services.
 * 2. Retrieves current AWS credentials.
 * 3. Checks if another discovery ECS task is already running.
 * 4. Validates the AWS Config aggregator if AWS Organizations is used.
 * 5. Creates and returns the API client and Config Service client instances.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {object} appSync - The AppSync client instance (or factory).
 * @param {object} config - The application configuration object.
 * @returns {Promise<object>} A promise that resolves to an object containing `apiClient` and `configServiceClient`.
 */
export async function initialise(awsClient, appSync, config) {
    logger.info('Initialising discovery process');
    const {region, rootAccountId, configAggregator: configAggregatorName, crossAccountDiscovery} = config;

    // Step 1: Validate VPC connectivity.
    await validateWdAccountVpcConfiguration(awsClient, config);

    // Step 2: Retrieve current AWS credentials using STS.
    const stsClient = awsClient.createStsClient();
    const credentials = await stsClient.getCurrentCredentials();

    // Step 3: Check if another discovery ECS task is running to prevent conflicts.
    const ecsClient = awsClient.createEcsClient(credentials, region);
    // Construct the ARN for the discovery task definition.
    const taskDefinitionArn = createArn({service: ECS, region, accountId: rootAccountId, resource: `${TASK_DEFINITION}/${WORKLOAD_DISCOVERY_TASKGROUP}`});

    if (await isDiscoveryEcsTaskRunning(ecsClient, taskDefinitionArn, config)) {
        throw new Error(DISCOVERY_PROCESS_RUNNING); // If running, throw an error to stop the current process.
    }

    // Step 4: Initialize Config Service client and validate aggregator if using AWS Organizations.
    const configServiceClient = awsClient.createConfigServiceClient(credentials, region);
    if(crossAccountDiscovery === AWS_ORGANIZATIONS) {
        await validateOrgAggregator(configServiceClient, configAggregatorName);
    }

    // Step 5: Initialize AppSync client and the main API client.
    const appSyncClient = appSync({...config, creds: credentials});
    const apiClient = createApiClient(awsClient, appSyncClient, config);

    // Return the initialized clients.
    return {
        apiClient,
        configServiceClient
    };
}
