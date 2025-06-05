// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module provides transformer functions responsible for preparing
 * discovered AWS resource data for persistence in the backend database.
 * This includes normalizing properties, generating console login URLs,
 * creating display titles, and aggregating resource metadata by region and account.
 */

import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import {
    NAME,
    AWS_ELASTIC_LOAD_BALANCING_V2_TARGET_GROUP,
    AWS_ELASTIC_LOAD_BALANCING_V2_LISTENER,
    AWS_AUTOSCALING_AUTOSCALING_GROUP,
    AWS_API_GATEWAY_METHOD,
    AWS_API_GATEWAY_RESOURCE,
    AWS_EC2_VPC,
    AWS_EC2_NETWORK_INTERFACE,
    AWS_EC2_INSTANCE,
    AWS_EC2_VOLUME,
    AWS_EC2_SUBNET,
    AWS_EC2_SECURITY_GROUP,
    AWS_EC2_ROUTE_TABLE,
    AWS_EC2_INTERNET_GATEWAY,
    AWS_EC2_NETWORK_ACL,
    AWS_ELASTIC_LOAD_BALANCING_V2_LOADBALANCER,
    AWS_EC2_EIP,
    AWS_API_GATEWAY_REST_API,
    AWS_LAMBDA_FUNCTION,
    AWS_IAM_ROLE,
    AWS_IAM_GROUP,
    AWS_IAM_USER,
    AWS_IAM_POLICY,
    AWS_S3_BUCKET,
    APIGATEWAY,
    EC2,
    IAM,
    VPC,
    SIGN_IN,
    CONSOLE,
    AWS_AMAZON_COM,
    S3,
    LAMBDA,
    HOME,
    REGION
} from '../constants.mjs'; // Imports various constants, including AWS resource types, service names, and URL components.
import {hash, resourceTypesToHash} from '../utils.mjs'; // Imports utility functions for hashing and resource type categorization.
import logger from '../logger.mjs'; // Imports the logging utility.

// Default URL mappings for various EC2 and VPC-related resource types in the AWS console.
const defaultUrlMappings = {
    [AWS_EC2_VPC]: { url: 'vpcs:sort=VpcId', type: VPC.toLowerCase()},
    [AWS_EC2_NETWORK_INTERFACE]: { url: 'NIC:sort=description', type: EC2},
    [AWS_EC2_INSTANCE]: { url: 'Instances:sort=instanceId', type: EC2},
    [AWS_EC2_VOLUME]: { url: 'Volumes:sort=desc:name', type: EC2},
    [AWS_EC2_SUBNET]: { url: 'subnets:sort=SubnetId', type: VPC.toLowerCase()},
    [AWS_EC2_SECURITY_GROUP]: { url: 'SecurityGroups:sort=groupId', type: EC2},
    [AWS_EC2_ROUTE_TABLE]: { url: 'RouteTables:sort=routeTableId', type: VPC.toLowerCase()},
    [AWS_EC2_INTERNET_GATEWAY]: { url: 'igws:sort=internetGatewayId', type: VPC.toLowerCase()},
    [AWS_EC2_NETWORK_ACL]: { url: 'acls:sort=networkAclId', type: VPC.toLowerCase()},
    [AWS_ELASTIC_LOAD_BALANCING_V2_LOADBALANCER]: { url: 'LoadBalancers:', type: EC2},
    [AWS_ELASTIC_LOAD_BALANCING_V2_TARGET_GROUP]: { url: 'TargetGroups:', type: EC2},
    [AWS_ELASTIC_LOAD_BALANCING_V2_LISTENER]: { url: 'LoadBalancers:', type: EC2},
    [AWS_EC2_EIP]: { url: 'Addresses:sort=PublicIp', type: EC2},
};

// URL mappings specific to IAM resource types in the AWS console.
const iamUrlMappings = {
    [AWS_IAM_USER]: { url: "/users", type: IAM},
    [AWS_IAM_ROLE]: { url: "/roles", type: IAM},
    [AWS_IAM_POLICY]: { url: "/policies", type: IAM},
    [AWS_IAM_GROUP]: { url: "/groups", type: IAM},
};

/**
 * Creates an AWS console sign-in URL for a specific account and service.
 * This URL directs users to the console and automatically signs them into the specified account.
 * @param {string} accountId - The AWS account ID.
 * @param {string} service - The AWS service identifier (e.g., 'ec2', 's3').
 * @returns {string} The constructed sign-in URL.
 */
function createSignInHostname(accountId, service) {
    return `https://${accountId}.${SIGN_IN}.${AWS_AMAZON_COM}/${CONSOLE}/${service}`
}

/**
 * Creates an AWS console URL for a logged-in user, directing them to a specific service's home page.
 * This URL assumes the user is already logged in.
 * @param {string} awsRegion - The AWS region.
 * @param {string} service - The AWS service identifier (e.g., 'ec2', 's3').
 * @returns {string} The constructed logged-in URL.
 */
function createLoggedInHostname(awsRegion, service) {
    return `https://${awsRegion}.${CONSOLE}.${AWS_AMAZON_COM}/${service}/${HOME}`;
}

/**
 * Generates AWS console login and logged-in URLs for a given resource.
 * It uses a switch statement to handle different resource types and constructs
 * appropriate deep links into the AWS console.
 * @param {object} resource - The resource object.
 * @returns {object} An object containing `loginURL` and `loggedInURL`, or an empty object if no mapping exists.
 */
function createConsoleUrls(resource) {
    const {resourceType, resourceName, accountId, awsRegion, configuration} = resource;

    switch(resourceType) {
        case AWS_API_GATEWAY_REST_API:
            return {
                loginURL: `${createSignInHostname(accountId, APIGATEWAY)}?${REGION}=${awsRegion}#/apis/${configuration.id}/resources`,
                loggedInURL: `${createLoggedInHostname(awsRegion,  APIGATEWAY)}?${REGION}=${awsRegion}#/apis/${configuration.id}/resources`
            }
        case AWS_API_GATEWAY_RESOURCE:
            return {
                loginURL: `${createSignInHostname(accountId, APIGATEWAY)}?${REGION}=${awsRegion}#/apis/${configuration.RestApiId}/resources/${configuration.id}`,
                loggedInURL: `${createLoggedInHostname(awsRegion,  APIGATEWAY)}?${REGION}=${awsRegion}#/apis/${configuration.RestApiId}/resources/${configuration.id}`
            }
        case AWS_API_GATEWAY_METHOD:
            const {httpMethod} = configuration;
            return {
                loginURL: `${createSignInHostname(accountId, APIGATEWAY)}?${REGION}=${awsRegion}#/apis/${configuration.RestApiId}/resources/${configuration.ResourceId}/${httpMethod}`,
                loggedInURL: `${createLoggedInHostname(awsRegion,  APIGATEWAY)}?${REGION}=${awsRegion}#/apis/${configuration.RestApiId}/resources/${configuration.ResourceId}/${httpMethod}`
            }
        case AWS_AUTOSCALING_AUTOSCALING_GROUP:
            return {
                loginURL: `${createSignInHostname(accountId, EC2)}/autoscaling/home?${REGION}=${awsRegion}#AutoScalingGroups:id=${resourceName};view=details`,
                loggedInURL: `${createLoggedInHostname(awsRegion,  EC2)}/autoscaling/home?${REGION}=${awsRegion}#AutoScalingGroups:id=${resourceName};view=details`
            }
        case AWS_LAMBDA_FUNCTION:
            return {
                loginURL: `${createSignInHostname(accountId,  LAMBDA)}?${REGION}=${awsRegion}#/functions/${resourceName}?tab=graph`,
                loggedInURL: `${createLoggedInHostname(awsRegion,  LAMBDA)}?${REGION}=${awsRegion}#/functions/${resourceName}?tab=graph`
            }
        case AWS_IAM_ROLE:
        case AWS_IAM_GROUP:
        case AWS_IAM_USER:
        case AWS_IAM_POLICY:
            const {url, type} = iamUrlMappings[resourceType];
            return {
                loginURL: `${createSignInHostname(accountId,  type)}?${HOME}?#${url}`,
                loggedInURL: `https://${CONSOLE}.${AWS_AMAZON_COM}/${type}/${HOME}?#${url}`,
            }
        case AWS_S3_BUCKET:
            return {
                loginURL: `${createSignInHostname(accountId,  S3)}?bucket=${resourceName}`,
                loggedInURL: `https://${S3}.${CONSOLE}.${AWS_AMAZON_COM}/${S3}/buckets/${resourceName}/?${REGION}=${awsRegion}`
            }
        default:
            // For other resource types, check if a default mapping exists.
            if(defaultUrlMappings[resourceType] != null) {
                const {url, type} = defaultUrlMappings[resourceType];
                const v2Type = `${type}/v2` // Some services use a /v2 path in their logged-in console URL.
                return {
                    loginURL: `${createSignInHostname(accountId, type)}?${REGION}=${awsRegion}#${url}`,
                    loggedInURL: `${createLoggedInHostname(awsRegion, v2Type)}?${REGION}=${awsRegion}#${url}`
                }
            }
            return {}; // Return empty object if no URL mapping is found.
    }
}

/**
 * Generates a display title for a resource.
 * It prioritizes a 'Name' tag, then uses ARN parsing for specific resource types,
 * and falls back to resource name or ID.
 * @param {object} params - An object containing resource properties like `resourceId`, `resourceName`, `arn`, `resourceType`, `tags`.
 * @returns {string} The generated display title.
 */
function createTitle({resourceId, resourceName, arn, resourceType, tags}) {
    // Prioritize the 'Name' tag if available.
    const name = tags.find(tag => tag.key === NAME);
    if(name != null) return name.value;

    switch (resourceType) {
        case AWS_ELASTIC_LOAD_BALANCING_V2_TARGET_GROUP:
        case AWS_ELASTIC_LOAD_BALANCING_V2_LISTENER:
            // For ELBv2 Target Groups and Listeners, extract the last part of the ARN.
            return R.last(arn.split(":"));
        case AWS_AUTOSCALING_AUTOSCALING_GROUP:
            // For Auto Scaling Groups, parse the ARN to get the group name.
            const parsedAsg = R.last(arn.split(":"));
            return R.last(parsedAsg.split("/"));
        default:
            // Default to resource name if available, otherwise resource ID.
            return resourceName == null ? resourceId : resourceName;
    }
}

// A Set of properties that should be kept when transforming a resource for persistence.
const propertiesToKeep = new Set([
    'accountId', 'arn', 'availabilityZone', 'awsRegion', 'configuration', 'configurationItemCaptureTime',
    'configurationItemStatus', 'configurationStateId', 'resourceCreationTime', 'resourceId',
    'resourceName', 'resourceType', 'supplementaryConfiguration', 'tags', 'version', 'vpcId', 'subnetId', 'subnetIds',
    'resourceValue', 'state', 'private', 'dBInstanceStatus', 'statement', 'instanceType']);

// A Set of properties whose values should be JSON.stringified before storing in Neptune.
// Neptune cannot store nested properties directly.
const propertiesToJsonStringify = new Set(['configuration', 'supplementaryConfiguration', 'tags', 'state'])

/**
 * Transforms a resource object into a flat set of properties suitable for Neptune.
 * It extracts specified properties, converts nested objects to JSON strings,
 * and adds generated console URLs and a display title.
 * @param {object} resource - The raw resource object.
 * @returns {object} A flattened object containing properties for persistence.
 */
function createProperties(resource) {
    const properties = Object.entries(resource).reduce((acc, [key, value]) => {
        if (propertiesToKeep.has(key)) {
            if(propertiesToJsonStringify.has(key)) {
                acc[key] = JSON.stringify(value); // Convert nested objects to JSON strings.
            } else {
                acc[key] = value; // Keep other properties as is.
            }
        }
        return acc;
    }, {});

    // Generate console login URLs.
    const logins = createConsoleUrls(resource)

    // Add login URLs to properties if generated.
    if(!R.isEmpty(logins)) {
        properties.loginURL = logins.loginURL;
        properties.loggedInURL = logins.loggedInURL;
    }

    // Add a display title to properties.
    properties.title = createTitle(resource);

    return properties;
}

/**
 * Creates the final object structure for saving a resource to the database.
 * It transforms the resource's properties, generates an MD5 hash for certain types,
 * and includes core metadata and relationships.
 * @param {object} resource - The discovered resource object.
 * @returns {object} The object ready to be saved to the database.
 */
export function createSaveObject(resource) {
    const {id, resourceId, resourceName, resourceType, accountId, arn, awsRegion, relationships = [], tags = []} = resource;

    // Transform and flatten resource properties.
    const properties = createProperties(resource);

    return {
        id, // Unique identifier for the resource (usually ARN).
        // Generate MD5 hash of properties for change detection if resource type is configured for hashing.
        md5Hash: resourceTypesToHash.has(resourceType) ? hash(properties) : '',
        resourceId,
        resourceName,
        resourceType,
        accountId,
        arn,
        awsRegion,
        relationships, // Relationships are stored separately but included here for context.
        properties, // Flattened properties.
        tags // Tags are also stored as properties.
    };
}

/**
 * Aggregates resource counts by account and region to create metadata about discovered resources.
 * This metadata is used to provide an overview of resource distribution across accounts and regions.
 * @param {Array<object>} resources - An array of discovered resource objects.
 * @returns {Map<string, object>} A map where keys are account IDs and values are objects
 *   containing total resource count for the account and a breakdown by region and resource type.
 */
export function createResourcesRegionMetadata(resources) {
    logger.profile('Time to createResourcesRegionMetadata'); // Start profiling.

    // Group resources by a composite key: accountId__awsRegion__resourceType.
    const grouped = R.groupBy(({properties}) => {
        const {accountId, awsRegion, resourceType} = properties;
        return `${accountId}__${awsRegion}__${resourceType}`;
    }, resources);

    // Transform the grouped resources into an object structured by accountId__awsRegion,
    // containing total count for that region and a list of resource types with their counts.
    const regionsObj = Object.entries(grouped)
        .reduce((acc, [key, resources]) => {
            const [accountId, awsRegion, resourceType] = key.split('__');

            const regionKey = `${accountId}__${awsRegion}`;

            // Initialize region entry if it doesn't exist.
            if(acc[regionKey] == null) {
                acc[regionKey] = {
                    count: 0,
                    resourceTypes: []
                };
            }

            acc[regionKey].count = acc[regionKey].count + resources.length; // Accumulate total count for the region.
            acc[regionKey].name = awsRegion; // Set region name.
            acc[regionKey].resourceTypes.push({
                count: resources.length,
                type: resourceType
            }); // Add resource type breakdown.

            return acc;
        }, {});

    // Transform the region-level aggregation into a final map keyed by accountId,
    // containing total count for the account and a list of regions with their resource type breakdowns.
    const metadata = Object.entries(regionsObj)
        .reduce((acc, [key, resourceTypes]) => {
            const [accountId] = key.split('__');

            // Initialize account entry if it doesn't exist.
            if(!acc.has(accountId)) {
                acc.set(accountId, {
                    accountId,
                    count: 0,
                    regions: []
                });
            }

            const account = acc.get(accountId)

            account.count = account.count + resourceTypes.count; // Accumulate total count for the account.
            account.regions.push(resourceTypes); // Add region-specific metadata.

            return acc;
        }, new Map());

    logger.profile('Time to createResourcesRegionMetadata'); // End profiling.

    return metadata;
}
