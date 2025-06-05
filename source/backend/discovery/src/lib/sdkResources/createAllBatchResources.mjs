// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module is responsible for fetching AWS resources that can be retrieved
 * efficiently in large batches using AWS SDK calls. These resources are typically
 * fetched across multiple accounts and regions. It includes handlers for various
 * resource types and consolidates their data into a standardized format.
 */

import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import {
    AWS, NOT_APPLICABLE,
    AWS_IAM_AWS_MANAGED_POLICY,
    MULTIPLE_AVAILABILITY_ZONES,
    AWS_ELASTIC_LOAD_BALANCING_V2_TARGET_GROUP,
    AWS_SERVICE_CATALOG_APP_REGISTRY_APPLICATION,
    SPOT_FLEET_REQUEST_ID_TAG,
    EC2,
    SPOT_FLEET_REQUEST,
    AWS_EC2_SPOT_FLEET,
    AWS_EC2_INSTANCE,
    SPOT_INSTANCE_REQUEST,
    AWS_EC2_SPOT,
    AWS_MEDIA_CONNECT_FLOW,
    AWS_OPENSEARCH_DOMAIN,
    GLOBAL,
    REGIONAL
} from '../constants.mjs'; // Imports various constants, including AWS resource types, regions, and tags.
import {
    createArn,
    createAssociatedRelationship,
    createConfigObject
} from '../utils.mjs'; // Imports utility functions for ARN creation, relationship creation, and config object creation.
import logger from '../logger.mjs'; // Imports the logging utility.

/**
 * Fetches all Service Catalog AppRegistry applications for a given account and region.
 * It uses the `ServiceCatalogAppRegistryClient` to retrieve applications and transforms
 * them into standardized resource objects.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} accountId - The AWS account ID.
 * @param {string} region - The AWS region.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of application resource objects.
 */
async function createApplications(awsClient, credentials, accountId, region) {
    const appRegistryClient = awsClient.createServiceCatalogAppRegistryClient(credentials, region);

    const applications = await appRegistryClient.getAllApplications();

    return applications.map(application => {
        return createConfigObject({
            arn: application.arn,
            accountId,
            awsRegion: region,
            availabilityZone: NOT_APPLICABLE, // Applications are not region-specific in terms of AZ.
            resourceType: AWS_SERVICE_CATALOG_APP_REGISTRY_APPLICATION,
            resourceId: application.arn, // Use ARN as resource ID.
            resourceName: application.name
        }, application)
    });
}

/**
 * Fetches all MediaConnect flows for a given account and region.
 * It uses the `MediaConnectClient` to retrieve flows and transforms them
 * into standardized resource objects.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} accountId - The AWS account ID.
 * @param {string} region - The AWS region.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of MediaConnect flow resource objects.
 */
async function createMediaConnectFlows(awsClient, credentials, accountId, region) {
    const mediaConnectClient = awsClient.createMediaConnectClient(credentials, region);

    const flows = await mediaConnectClient.getAllFlows();

    return flows.map(flow => {
        return createConfigObject({
            arn: flow.FlowArn,
            accountId: accountId,
            awsRegion: region,
            availabilityZone: flow.AvailabilityZone,
            resourceType: AWS_MEDIA_CONNECT_FLOW,
            resourceId: flow.FlowArn,
            resourceName: flow.Name
        }, flow);
    });
}

/**
 * Fetches all attached AWS managed IAM policies for a given account and region.
 * It uses the `IamClient` to retrieve policies and transforms them into standardized resource objects.
 * Note: IAM policies are global resources, but this function is called per region for consistency
 * in the batch processing loop. The `accountId` for these resources is `AWS`.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} accountId - The AWS account ID (of the calling account).
 * @param {string} region - The AWS region (of the calling context).
 * @returns {Promise<Array<object>>} A promise that resolves to an array of IAM managed policy resource objects.
 */
async function createAttachedAwsManagedPolices(awsClient, credentials, accountId, region) {
    const iamClient = awsClient.createIamClient(credentials, region)

    const managedPolices = await iamClient.getAllAttachedAwsManagedPolices();

    return managedPolices.map(policy => {
        return createConfigObject({
            arn: policy.Arn,
            accountId: AWS, // AWS managed policies belong to the 'aws' account.
            awsRegion: region, // They are global but associated with a region for discovery context.
            availabilityZone: NOT_APPLICABLE,
            resourceType: AWS_IAM_AWS_MANAGED_POLICY,
            resourceId: policy.Arn,
            resourceName: policy.PolicyName
        }, policy);
    });
}

/**
 * Fetches all ELBv2 Target Groups for a given account and region.
 * It uses the `ElbV2Client` to retrieve target groups and transforms them
 * into standardized resource objects.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} accountId - The AWS account ID.
 * @param {string} region - The AWS region.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of ELBv2 Target Group resource objects.
 */
async function createTargetGroups(awsClient, credentials, accountId, region) {
    const elbV2Client = awsClient.createElbV2Client(credentials, region);

    const targetGroups = await elbV2Client.getAllTargetGroups();

    return targetGroups.map(targetGroup => {
        return createConfigObject({
            arn: targetGroup.TargetGroupArn,
            accountId,
            awsRegion: region,
            availabilityZone: MULTIPLE_AVAILABILITY_ZONES, // Target groups can span multiple AZs.
            resourceType: AWS_ELASTIC_LOAD_BALANCING_V2_TARGET_GROUP,
            resourceId: targetGroup.TargetGroupArn,
            resourceName: targetGroup.TargetGroupArn // Use ARN as resource name for consistency.
        }, targetGroup);
    })
}

/**
 * Fetches all EC2 Spot Instance Requests and Spot Fleet Requests for a given account and region.
 * It transforms them into standardized resource objects and infers relationships
 * between Spot Fleet Requests and their associated Spot Instances.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} accountId - The AWS account ID.
 * @param {string} region - The AWS region.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of Spot resource objects.
 */
async function createSpotResources(awsClient, credentials, accountId, region) {
    const ec2Client = awsClient.createEc2Client(credentials, region);

    const spotInstanceRequests = await ec2Client.getAllSpotInstanceRequests();

    // Group spot instance requests by their associated Spot Fleet Request ID (if any).
    const groupedReqs = R.groupBy(x => {
        const sfReqId = x.Tags.find(x => x.Key === SPOT_FLEET_REQUEST_ID_TAG);
        return sfReqId == null ? 'spotInstanceRequests' : sfReqId.Value; // 'spotInstanceRequests' for standalone requests.
    }, spotInstanceRequests);

    // Process Spot Fleet Requests.
    const spotFleetRequests = (await ec2Client.getAllSpotFleetRequests()).map((request) => {
        // Construct ARN for the Spot Fleet Request.
        const arn = createArn({
            service: EC2, region, accountId, resource: `${SPOT_FLEET_REQUEST}/${request.SpotFleetRequestId}`
        });
        return createConfigObject({
            arn,
            accountId,
            awsRegion: region,
            availabilityZone: MULTIPLE_AVAILABILITY_ZONES,
            resourceType: AWS_EC2_SPOT_FLEET,
            resourceId: arn,
            resourceName: arn,
            // Create 'Is associated with' relationships to EC2 Instances launched by this Spot Fleet.
            relationships: groupedReqs[request.SpotFleetRequestId].map(({InstanceId}) => {
                return createAssociatedRelationship(AWS_EC2_INSTANCE, {resourceId: InstanceId});
            })
        }, request);
    });

    // Process standalone Spot Instance Requests (not part of a Spot Fleet).
    const spotInstanceRequestObjs = (groupedReqs.spotInstanceRequests ?? []).map(spiReq => {
        // Construct ARN for the Spot Instance Request.
        const arn = createArn({
            service: EC2, region, accountId, resource: `${SPOT_INSTANCE_REQUEST}/${spiReq.SpotInstanceRequestId}`
        });
        return createConfigObject({
            arn,
            accountId,
            awsRegion: region,
            availabilityZone: MULTIPLE_AVAILABILITY_ZONES,
            resourceType: AWS_EC2_SPOT,
            resourceId: arn,
            resourceName: arn,
            // Create 'Is associated with' relationship to the EC2 Instance.
            relationships: [
                createAssociatedRelationship(AWS_EC2_INSTANCE, {resourceId: spiReq.InstanceId})
            ]
        }, spiReq);
    });

    return [...spotFleetRequests, ...spotInstanceRequestObjs]; // Combine and return all Spot resources.
}

/**
 * Fetches all OpenSearch domains for a given account and region.
 * It uses the `OpenSearchClient` to retrieve domains and transforms them
 * into standardized resource objects.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} accountId - The AWS account ID.
 * @param {string} region - The AWS region.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of OpenSearch domain resource objects.
 */
async function createOpenSearchDomains(awsClient, credentials, accountId, region) {
    const openSearchClient = awsClient.createOpenSearchClient(credentials, region)

    const domains = await openSearchClient.getAllOpenSearchDomains();

    return domains.map(domain => {
        return createConfigObject({
            arn: domain.ARN,
            accountId,
            awsRegion: region,
            availabilityZone: MULTIPLE_AVAILABILITY_ZONES, // OpenSearch domains can span multiple AZs.
            resourceType: AWS_OPENSEARCH_DOMAIN,
            resourceId: domain.DomainName,
            resourceName: domain.DomainName
        }, domain);
    });
}

/**
 * Curried function to create a standardized error object for batch resource handlers.
 * This helps in consistent error logging and reporting.
 * @param {string} handlerName - The name of the handler function that encountered the error.
 * @param {string} accountId - The AWS account ID where the error occurred.
 * @param {string} region - The AWS region where the error occurred.
 * @param {Error} error - The raw error object.
 * @returns {object} A standardized error object.
 */
const handleError = R.curry((handlerName, accountId, region, error) => {
    return {
        item: {handlerName, accountId, region}, // Contextual information about where the error occurred.
        raw: error, // The original error object.
        message: error.message // The error message.
    }
});

/**
 * Orchestrates the fetching of all batch-retrievable resources across multiple accounts and regions.
 * It defines a list of handlers for different resource types and executes them concurrently
 * for each account and its relevant regions (global or regional services).
 * It consolidates results and logs any errors encountered.
 * @param {Array<Array<string, object>>} credentialsTuples - An array of [accountId, accountObject] tuples, where accountObject includes `regions` and `credentials`.
 * @param {object} awsClient - The AWS client factory instance.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of all discovered batch resources.
 */
async function createAllBatchResources(credentialsTuples, awsClient) {
    // Define handlers for different batch resource types, categorized by their service region scope.
    const handlers = [
        [GLOBAL, createAttachedAwsManagedPolices], // IAM policies are global.
        [REGIONAL, createApplications],
        [REGIONAL, createMediaConnectFlows],
        [REGIONAL, createTargetGroups],
        [REGIONAL, createOpenSearchDomains],
        [REGIONAL, createSpotResources]
    ];

    // Execute all handlers concurrently for each account and its regions.
    // `Promise.all` is used to wait for all promises to settle.
    const {results, errors} = await Promise.all(handlers.flatMap(([serviceRegion, handler]) => {
        return credentialsTuples
            .flatMap(([accountId, {regions, credentials}]) => {
                const errorHandler = handleError(handler.name, accountId); // Create a specific error handler for this context.
                // If service is global, call handler once for the account.
                // Otherwise, map over regions and call handler for each region.
                return serviceRegion === GLOBAL
                    ? handler(awsClient, credentials, accountId, GLOBAL).catch(errorHandler(GLOBAL))
                    : regions.map(region => handler(awsClient, credentials, accountId, region.name).catch(errorHandler(region.name)));
            });
    })).then(R.reduce((acc, item) => {
        // Reduce the results of Promise.all into separate arrays for successful results and errors.
        if (item.raw != null) { // Check if the item is an error object (from `handleError`).
            acc.errors.push(item);
        } else {
            acc.results.push(...item); // Add successful results.
        }
        return acc;
    }, {results: [], errors: []})); // Initial accumulator for results and errors.

    logger.error(`There were ${errors.length} errors when adding batch SDK resources.`);
    logger.debug('Errors: ', {errors: errors});

    return results; // Return only the successfully retrieved resources.
}

export default createAllBatchResources;
