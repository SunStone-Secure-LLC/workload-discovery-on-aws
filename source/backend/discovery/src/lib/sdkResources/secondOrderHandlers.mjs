// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module defines "second-order" AWS SDK handlers. These handlers are functions
 * that enrich resources with additional, more detailed information by making direct AWS SDK calls.
 * They are considered "second-order" because their data retrieval often depends on information
 * that has already been added or enriched by "first-order" SDK handlers.
 * Each handler is specific to a particular AWS resource type.
 */

import {
    APIGATEWAY,
    RESTAPIS,
    RESOURCES,
    AWS_API_GATEWAY_RESOURCE,
    POST,
    GET,
    PUT,
    DELETE,
    NOT_FOUND_EXCEPTION,
    METHODS,
    AWS_API_GATEWAY_METHOD
} from '../constants.mjs'; // Imports various constants, including API Gateway resource types, HTTP methods, and error types.
import {createArn, createConfigObject, createContainedInRelationship} from '../utils.mjs'; // Imports utility functions for ARN creation, config object creation, and relationship creation.
import logger from '../logger.mjs'; // Imports the logging utility.

/**
 * Factory function that creates a collection of "second-order" AWS SDK handlers.
 * Each handler is an asynchronous function responsible for fetching additional data
 * for a specific AWS resource type and transforming it into new or enriched resource objects.
 * These handlers typically operate on resources that have already been processed by first-order handlers.
 * @param {Map<string, object>} accountsMap - A map of active account IDs to their details (including credentials).
 * @param {object} awsClient - The AWS client factory instance.
 * @returns {object} An object where keys are AWS resource types and values are their corresponding handler functions.
 */
export function createSecondOrderHandlers(accountsMap, awsClient) {
    return {
        /**
         * Handler for AWS::ApiGateway::Resource resources.
         * Discovers and transforms API Gateway Methods (POST, GET, PUT, DELETE) associated with the resource.
         * This is a second-order handler because it operates on API Gateway Resources, which are
         * themselves discovered by a first-order handler (AWS::ApiGateway::RestApi).
         * @param {object} resource - The API Gateway Resource object.
         * @returns {Promise<Array<object>>} A promise that resolves to an array of new API Gateway Method resource objects.
         */
        [AWS_API_GATEWAY_RESOURCE]: async ({resourceId, accountId, availabilityZone, awsRegion, arn: apiResourceArn, configuration}) => {
            // `ResourceId` here refers to the ID assigned by API Gateway to this resource,
            // not the AWS Config ID. `RestApiId` is also from the configuration.
            const {RestApiId, id: ResourceId} = configuration;

            const {credentials} = accountsMap.get(accountId); // Get credentials for the account.
            const apiGatewayClient = awsClient.createApiGatewayClient(credentials, awsRegion);

            // Attempt to fetch all common HTTP methods (POST, GET, PUT, DELETE) for the resource concurrently.
            const results = await Promise.allSettled([
                apiGatewayClient.getMethod(POST, ResourceId, RestApiId),
                apiGatewayClient.getMethod(GET, ResourceId, RestApiId),
                apiGatewayClient.getMethod(PUT, ResourceId, RestApiId),
                apiGatewayClient.getMethod(DELETE, ResourceId, RestApiId),
            ]);

            // Log errors for rejected promises, excluding `NOT_FOUND_EXCEPTION` as it's expected for missing methods.
            results.forEach(({status, reason}) => {
                if(status === 'rejected' && reason.name !== NOT_FOUND_EXCEPTION) {
                    logger.error(`Error discovering API Gateway integration for resource: ${apiResourceArn}`, {error: reason});
                }
            });

            // Filter for fulfilled promises (successful method fetches) and transform them into resource objects.
            return results.filter(x => x.status === 'fulfilled').map(({value: item}) => {
                // Construct ARN for the API Gateway Method.
                const arn = createArn({
                    service: APIGATEWAY, region: awsRegion, resource: `/${RESTAPIS}/${RestApiId}/${RESOURCES}/${ResourceId}/${METHODS}/${item.httpMethod}`
                });
                return createConfigObject({
                    arn,
                    accountId,
                    awsRegion,
                    availabilityZone,
                    resourceType: AWS_API_GATEWAY_METHOD,
                    resourceId: arn,
                    resourceName: arn,
                    relationships: [
                        // Create 'Is contained in' relationship to the parent API Gateway Resource.
                        createContainedInRelationship(AWS_API_GATEWAY_RESOURCE, {resourceId}),
                    ]
                }, {RestApiId, ResourceId, ...item});
            });
        }
    };
}
