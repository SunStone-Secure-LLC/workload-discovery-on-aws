// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module provides a collection of utility functions used throughout the Workload Discovery application.
 * These utilities include:
 * - Hashing for object comparison.
 * - Functions for creating standardized relationship objects.
 * - ARN (Amazon Resource Name) construction and parsing helpers.
 * - Type checking and data normalization functions.
 * - Asynchronous profiling and memoization decorators.
 * - Constants and logic for resource type handling.
 */

import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import {build as buildArn} from '@aws-sdk/util-arn-parser'; // Imports ARN builder from AWS SDK utility.
import logger from './logger.mjs'; // Imports the logging utility.
import {
    AWS,
    AWS_CN,
    AWS_US_GOV,
    CONTAINS,
    AWS_EC2_SECURITY_GROUP,
    IS_ASSOCIATED_WITH,
    IS_ATTACHED_TO,
    IS_CONTAINED_IN,
    SUBNET,
    VPC,
    AWS_EC2_VPC,
    AWS_EC2_SUBNET,
    CN_NORTH_1,
    CN_NORTHWEST_1,
    US_GOV_EAST_1,
    US_GOV_WEST_1,
    RESOURCE_DISCOVERED,
    SECURITY_GROUP,
    AWS_API_GATEWAY_METHOD,
    AWS_API_GATEWAY_RESOURCE,
    AWS_COGNITO_USER_POOL,
    AWS_ECS_TASK,
    AWS_ELASTIC_LOAD_BALANCING_V2_LISTENER,
    AWS_EKS_NODE_GROUP,
    AWS_ELASTIC_LOAD_BALANCING_V2_TARGET_GROUP,
    AWS_IAM_AWS_MANAGED_POLICY,
    AWS_DYNAMODB_STREAM,
    AWS_EC2_SPOT,
    AWS_EC2_SPOT_FLEET,
    AWS_IAM_INLINE_POLICY,
    AWS_OPENSEARCH_DOMAIN,
    AWS_EC2_INSTANCE,
    AWS_EC2_NETWORK_INTERFACE,
    AWS_EC2_VOLUME,
    AWS_IAM_ROLE
} from './constants.mjs'; // Imports various constants, primarily AWS resource types and relationship names.
import crypto from 'crypto'; // Node.js built-in module for cryptographic functionality.

/**
 * Generates an MD5 hash of a given data object.
 * This hash is primarily used for comparing two JavaScript objects to check for equality
 * or to generate unique identifiers based on their content.
 * @param {object} data - The JavaScript object to be hashed.
 * @returns {string} The MD5 hash as a hexadecimal string.
 */
export function hash(data) {
    const algo = 'md5';
    // Creates an MD5 hash of the JSON string representation of the data.
    // NOSONAR: This hashing algorithm is used for object comparison, not for security-sensitive operations.
    let shasum = crypto.createHash(algo).update(JSON.stringify(data));
    return "" + shasum.digest('hex');
}

/**
 * Curried function to create a standardized relationship object.
 * This function is a base for creating various types of relationships between resources.
 * @param {string} relationshipName - The name of the relationship (e.g., 'Contains', 'Is associated with').
 * @param {string} resourceType - The AWS resource type of the target resource (e.g., 'AWS::EC2::VPC').
 * @param {object} params - An object containing properties for the target resource.
 * @param {string} [params.arn] - The ARN of the target resource.
 * @param {string} [params.relNameSuffix] - An optional suffix to append to the relationship name.
 * @param {string} [params.resourceName] - The name of the target resource.
 * @param {string} [params.resourceId] - The ID of the target resource.
 * @param {string} [params.awsRegion] - The AWS region of the target resource.
 * @param {string} [params.accountId] - The AWS account ID of the target resource.
 * @returns {object} A relationship object with specified properties.
 */
export const createRelationship = R.curry((relationshipName, resourceType, {arn, relNameSuffix, resourceName, resourceId, awsRegion, accountId}) => {
    const relationship = {relationshipName}
    if(arn != null) {
        relationship.arn = arn;
    }
    if(resourceType != null) {
        relationship.resourceType = resourceType;
    }
    if(resourceName != null) {
        relationship.resourceName = resourceName;
    }
    if(relNameSuffix != null) {
        relationship.relationshipName = relationshipName + relNameSuffix;
    }
    if(resourceId != null) {
        relationship.resourceId = resourceId;
    }
    if(accountId != null) {
        relationship.accountId = accountId;
    }
    if(awsRegion != null) {
        relationship.awsRegion = awsRegion;
    }
    return relationship;
});

/**
 * Creates a 'Contains' relationship.
 * @param {string} resourceType - The AWS resource type of the contained resource.
 * @param {object} params - Parameters for the contained resource.
 * @returns {object} A relationship object of type 'Contains'.
 */
export const createContainsRelationship = createRelationship(CONTAINS);

/**
 * Creates an 'Is associated with' relationship.
 * @param {string} resourceType - The AWS resource type of the associated resource.
 * @param {object} params - Parameters for the associated resource.
 * @returns {object} A relationship object of type 'Is associated with'.
 */
export const createAssociatedRelationship = createRelationship(IS_ASSOCIATED_WITH);

/**
 * Creates an 'Is attached to' relationship.
 * @param {string} resourceType - The AWS resource type of the attached resource.
 * @param {object} params - Parameters for the attached resource.
 * @returns {object} A relationship object of type 'Is attached to'.
 */
export const createAttachedRelationship = createRelationship(IS_ATTACHED_TO);

/**
 * Creates an 'Is contained in' relationship.
 * @param {string} resourceType - The AWS resource type of the containing resource.
 * @param {object} params - Parameters for the containing resource.
 * @returns {object} A relationship object of type 'Is contained in'.
 */
export const createContainedInRelationship = createRelationship(IS_CONTAINED_IN);

/**
 * Creates an 'Is contained in VPC' relationship.
 * @param {string} resourceId - The ID of the VPC.
 * @returns {object} A relationship object indicating containment within a VPC.
 */
export function createContainedInVpcRelationship(resourceId) {
    return createRelationship(IS_CONTAINED_IN + VPC, AWS_EC2_VPC, {resourceId});
}

/**
 * Creates an 'Is contained in Subnet' relationship.
 * @param {string} resourceId - The ID of the Subnet.
 * @returns {object} A relationship object indicating containment within a Subnet.
 */
export function createContainedInSubnetRelationship(resourceId) {
    return createRelationship(IS_CONTAINED_IN + SUBNET, AWS_EC2_SUBNET, {resourceId});
}

/**
 * Creates an 'Is associated with SecurityGroup' relationship.
 * @param {string} resourceId - The ID of the Security Group.
 * @returns {object} A relationship object indicating association with a Security Group.
 */
export function createAssociatedSecurityGroupRelationship(resourceId) {
    return createRelationship(IS_ASSOCIATED_WITH + SECURITY_GROUP, AWS_EC2_SECURITY_GROUP, {resourceId})
}

/**
 * Curried function to create a relationship based on an ARN.
 * This is a specialized version of `createRelationship` where the target is identified by its ARN.
 * @param {string} relationshipName - The name of the relationship.
 * @param {string} arn - The ARN of the target resource.
 * @returns {object} A relationship object with the specified ARN.
 */
export const createArnRelationship = R.curry((relationshipName, arn) => {
    return createRelationship(relationshipName, null, {arn});
});

// Maps for special AWS partitions (China and GovCloud) based on region.
const chinaRegions = new Map([[CN_NORTH_1, AWS_CN], [CN_NORTHWEST_1, AWS_CN]]);
const govRegions = new Map([[US_GOV_EAST_1, AWS_US_GOV], [US_GOV_WEST_1, AWS_US_GOV]]);

/**
 * Constructs an AWS ARN (Amazon Resource Name) from its components.
 * Automatically determines the correct partition (e.g., 'aws', 'aws-cn', 'aws-us-gov')
 * based on the provided region.
 * @param {object} params - Parameters for ARN construction.
 * @param {string} params.service - The AWS service namespace (e.g., 'ec2', 's3').
 * @param {string} [params.accountId=''] - The AWS account ID. Defaults to empty string for global resources.
 * @param {string} [params.region=''] - The AWS region. Defaults to empty string for global resources.
 * @param {string} params.resource - The resource identifier within the service (e.g., 'instance/i-1234567890abcdef0').
 * @returns {string} The constructed ARN string.
 */
export function createArn({service, accountId = '', region = '', resource}) {
    // Determine the AWS partition based on the region.
    const partition = chinaRegions.get(region) ?? govRegions.get(region) ?? AWS;
    return buildArn({ service, partition, region, accountId, resource});
}

/**
 * Constructs an AWS ARN from a resource type and resource ID.
 * It parses the service and resource type from the `resourceType` string.
 * @param {object} params - Parameters for ARN construction.
 * @param {string} params.resourceType - The AWS resource type (e.g., 'AWS::EC2::Instance').
 * @param {string} [params.accountId=''] - The AWS account ID.
 * @param {string} [params.awsRegion=''] - The AWS region.
 * @param {string} params.resourceId - The ID of the resource.
 * @returns {string} The constructed ARN string.
 */
export function createArnWithResourceType({resourceType, accountId = '', awsRegion: region = '', resourceId}) {
    // Extracts service and resource from the resourceType string (e.g., 'AWS::EC2::Instance' -> 'ec2', 'instance').
    const [, service, resource] = resourceType.toLowerCase().split('::');
    return createArn({ service, region, accountId, resource: `${resource}/${resourceId}`});
}

/**
 * Checks if a given value is a plain JavaScript object (not an array or null).
 * @param {*} val - The value to check.
 * @returns {boolean} True if the value is a plain object, false otherwise.
 */
export function isObject(val) {
    return typeof val === 'object' && !Array.isArray(val) && val !== null;
}

/**
 * Converts object keys from PascalCase/CamelCase to camelCase (first letter lowercase).
 * This is typically used for normalizing tag keys from AWS Config.
 * @param {object} obj - The object whose keys are to be converted.
 * @returns {object} A new object with camelCased keys.
 */
function objKeysToCamelCase(obj) {
    return Object.entries(obj).reduce((acc, [k, v]) => {
        acc[k.replace(/^./, k[0].toLowerCase())] = v;
        return acc
    }, {});
}

/**
 * Converts a plain object into an array of { key, value } pairs.
 * Useful for transforming tag objects into a standardized array format.
 * @param {object} obj - The object to convert.
 * @returns {Array<object>} An array of objects, each with 'key' and 'value' properties.
 */
export function objToKeyNameArray(obj) {
    return Object.entries(obj).map(([key, value]) => {
        return {
            key,
            value
        }
    });
}

/**
 * Normalizes a collection of tags.
 * If tags are provided as an object, they are converted to an array of { key, value } pairs.
 * If tags are already an array, their keys are converted to camelCase.
 * @param {Array<object>|object} [tags=[]] - The tags to normalize, either an array of tag objects or a plain object.
 * @returns {Array<object>} A normalized array of tag objects.
 */
export function normaliseTags(tags = []) {
    return isObject(tags) ? objToKeyNameArray(tags) : tags.map(objKeysToCamelCase);
}

/**
 * Creates a standardized configuration object for a discovered resource.
 * This object combines basic resource metadata with its AWS Config configuration,
 * and normalizes tags and relationships.
 * @param {object} resourceMetadata - Basic metadata about the resource (arn, accountId, etc.).
 * @param {object} configuration - The raw configuration object from AWS Config.
 * @returns {object} A standardized resource configuration object.
 */
export function createConfigObject({arn, accountId, awsRegion, availabilityZone, resourceType, resourceId, resourceName, relationships = []}, configuration) {
    // Normalizes tags from the configuration.
    const tags = normaliseTags(configuration.Tags ?? configuration.tags);

    return {
        id: arn, // Uses ARN as the unique identifier.
        accountId,
        // If ARN is not provided, construct it from resource type, account ID, region, and resource ID.
        arn: arn ?? createArn({resourceType, accountId, awsRegion, resourceId}),
        availabilityZone,
        awsRegion,
        configuration: configuration, // Stores the raw configuration item.
        configurationItemStatus: RESOURCE_DISCOVERED, // Marks the resource as discovered.
        resourceId,
        resourceName,
        resourceType,
        tags,
        relationships // Includes any pre-existing relationships.
    }
}

/**
 * Checks if a given value is a string.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a string, false otherwise.
 */
export function isString(value) {
    return typeof value === 'string' && Object.prototype.toString.call(value) === "[object String]"
}

/**
 * Checks if a given value is a valid Date object.
 * @param {*} date - The value to check.
 * @returns {boolean} True if the value is a valid Date object, false otherwise.
 */
export function isDate(date) {
    return date && Object.prototype.toString.call(date) === "[object Date]" && !isNaN(date);
}

/**
 * Creates a unique key for a resource based on its name, type, account ID, and region.
 * Used for mapping and lookup purposes.
 * @param {object} params - Parameters for key creation.
 * @param {string} params.resourceName - The name of the resource.
 * @param {string} params.resourceType - The type of the resource.
 * @param {string} params.accountId - The account ID of the resource.
 * @param {string} params.awsRegion - The AWS region of the resource.
 * @returns {string} A unique string key.
 */
export function createResourceNameKey({resourceName, resourceType, accountId, awsRegion}) {
    const first = resourceType == null ? '' : `${resourceType}_`;
    return `${first}${resourceName}_${accountId}_${awsRegion}`;
}

/**
 * Creates a unique key for a resource based on its ID, type, account ID, and region.
 * Used for mapping and lookup purposes.
 * @param {object} params - Parameters for key creation.
 * @param {string} params.resourceId - The ID of the resource.
 * @param {string} params.resourceType - The type of the resource.
 * @param {string} params.accountId - The account ID of the resource.
 * @param {string} params.awsRegion - The AWS region of the resource.
 * @returns {string} A unique string key.
 */
export function createResourceIdKey({resourceId, resourceType, accountId, awsRegion}) {
    const first = resourceType == null ? '' : `${resourceType}_`;
    return `${first}${resourceId}_${accountId}_${awsRegion}`;
}

/**
 * Safely iterates over an array, applying a function to each item.
 * Catches and collects any errors that occur during the function application,
 * allowing the iteration to continue without interruption.
 * @param {function} f - The function to apply to each item.
 * @param {Array} xs - The array to iterate over.
 * @returns {object} An object containing an array of errors encountered during iteration.
 */
export const safeForEach = R.curry((f, xs) => {
    const errors = [];

    xs.forEach(item => {
        try {
            f(item);
        } catch(error) {
            errors.push({
                error,
                item
            })
        }
    });

    return {errors};
});

/**
 * Curried asynchronous profiling decorator.
 * Logs the start and end of an asynchronous function's execution,
 * along with a provided message, useful for performance monitoring.
 * @param {string} message - The message to log for profiling.
 * @param {function} f - The asynchronous function to profile.
 * @returns {function} A new asynchronous function that logs profiling information.
 */
export const profileAsync = R.curry((message, f) => {
    return async (...args) => {
        logger.profile(message); // Logs the start of the profiled section.
        const result = await f(...args); // Executes the original asynchronous function.
        logger.profile(message); // Logs the end of the profiled section.
        return result;
    }
});

/**
 * Memoization utility using JSON.stringify for cache key generation.
 * Caches the results of a function call based on its arguments,
 * preventing redundant computations for the same inputs.
 * @param {function} func - The function to memoize.
 * @returns {function} A memoized version of the function.
 */
export const memoize = R.memoizeWith((...args) => JSON.stringify(args));

// A Set of AWS resource types whose configurations should be hashed for comparison.
// Hashing is used for these types to detect changes efficiently.
export const resourceTypesToHash = new Set([
        AWS_API_GATEWAY_METHOD,
        AWS_API_GATEWAY_RESOURCE,
        AWS_DYNAMODB_STREAM,
        AWS_ECS_TASK,
        AWS_ELASTIC_LOAD_BALANCING_V2_LISTENER,
        AWS_EKS_NODE_GROUP,
        AWS_ELASTIC_LOAD_BALANCING_V2_TARGET_GROUP,
        AWS_IAM_AWS_MANAGED_POLICY,
        AWS_EC2_SPOT,
        AWS_EC2_SPOT_FLEET,
        AWS_IAM_INLINE_POLICY,
        AWS_COGNITO_USER_POOL,
        AWS_OPENSEARCH_DOMAIN
    ]
);

// An array of AWS resource types that require normalization of their relationship names.
// This is typically for resources whose type name is used as a suffix in relationships.
export const resourceTypesToNormalize = [
    AWS_EC2_INSTANCE,
    AWS_EC2_NETWORK_INTERFACE,
    AWS_EC2_SECURITY_GROUP,
    AWS_EC2_SUBNET,
    AWS_EC2_VOLUME,
    AWS_EC2_VPC,
    AWS_IAM_ROLE
];

// A Set version of `resourceTypesToNormalize` for efficient lookup.
export const resourceTypesToNormalizeSet = new Set(resourceTypesToNormalize);

// A Set containing the lowercase suffixes derived from `resourceTypesToNormalize`.
// Used to quickly check if a relationship name's suffix corresponds to a normalized resource type.
const normalizedSuffixSet = new Set(resourceTypesToNormalize.map(resourceType => {
    const [,, relSuffix] = resourceType.split('::'); // Extracts the last part of the resource type (e.g., 'Instance' from 'AWS::EC2::Instance').
    return relSuffix.toLowerCase();
}));

/**
 * Checks if a given relationship name is "qualified", meaning its suffix matches
 * one of the normalized resource types. This helps in identifying relationships
 * that are specifically tied to certain AWS resource types.
 * @param {string} relationshipName - The name of the relationship to check.
 * @returns {boolean} True if the relationship name is qualified, false otherwise.
 */
export function isQualifiedRelationshipName(relationshipName) {
    // Extracts the last word of the relationship name and converts it to lowercase for comparison.
    return normalizedSuffixSet.has(relationshipName.split(' ').at(-1).toLowerCase());
}
