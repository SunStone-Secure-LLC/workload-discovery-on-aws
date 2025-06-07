// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module provides the core SDK client for interacting with the backend GraphQL API (AppSync).
 * It encapsulates functionalities such as AWS Signature Version 4 request signing,
 * retry mechanisms for transient errors, and pagination for large query results.
 * The client dynamically exposes GraphQL queries and mutations based on the application's
 * configuration, particularly for AWS Organizations integration.
 */

import aws4 from 'aws4'; // Imports `aws4` for signing AWS requests with Signature Version 4.
import curry from 'lodash.curry'; // Imports `curry` for creating curried functions.
import retry from 'async-retry'; // Imports `async-retry` for implementing retry logic on failed requests.
import {fromNodeProviderChain} from '@aws-sdk/credential-providers'; // Imports credential provider for Node.js environments.
import {request} from 'undici'; // Imports `request` from undici for making HTTP requests.

import logger from './logger.mjs'; // Imports the logging utility.
import * as mutations from './mutations.mjs'; // Imports all GraphQL mutations.
import * as queries from './queries.mjs'; // Imports all GraphQL queries.

import {
    CONNECTION_CLOSED_PREMATURELY, // Constant for a specific transient error message.
    FUNCTION_RESPONSE_SIZE_TOO_LARGE, // Constant for Lambda response size limit error.
    AWS_ORGANIZATIONS, // Constant for AWS Organizations discovery method.
    ALLOWED_CROSS_ACCOUNT_DISCOVERY_VALUES // Constant for allowed values of cross-account discovery.
} from './constants.mjs' // Imports various constants.

// List of GraphQL operations that are always excluded from the client's public interface.
const alwaysExclude = [
    'deleteRelationships',
    'deleteResources',
    'addRelationships',
    'addResources',
    'updateResources',
    'indexResources',
    'deleteIndexedResources',
    'updateIndexedResources',
];

// List of GraphQL operations that are excluded when AWS Organizations is used for cross-account discovery.
const orgsExclude = [
    'getGlobalTemplate',
    'getRegionalTemplate',
    'addAccounts',
    'deleteAccounts',
    'updateAccount',
    'deleteRegions',
    'addRegions',
    'updateRegions'
]

/**
 * Checks if the cross-account discovery method is set to AWS Organizations.
 * @param {string} crossAccountDiscovery - The configured cross-account discovery method.
 * @returns {boolean} True if AWS Organizations is used, false otherwise.
 */
function isUsingOrganizations(crossAccountDiscovery) {
    return crossAccountDiscovery === AWS_ORGANIZATIONS;
}

// A Set of GraphQL query names that are considered "cost queries".
// These queries have a specific structure for pagination.
const costQueries = new Set([
    'costForServiceQuery',
    'costForResourceQuery',
    'resourcesByCostQuery',
    'resourcesByCostByDayQuery',
]);

/**
 * Checks if the given variables object represents a cost query.
 * A cost query is identified by having exactly one key, and that key's name
 * must be present in the `costQueries` set.
 * @param {object} variables - The GraphQL variables object.
 * @returns {boolean} True if it's a cost query, false otherwise.
 */
function isCostQuery(variables) {
    const keys = Object.keys(variables);
    return keys.length === 1 && costQueries.has(keys[0]);
}

/**
 * Checks if an array is empty.
 * @param {Array} array - The array to check.
 * @returns {boolean} True if the array is empty, false otherwise.
 */
function isEmpty(array) {
    return array.length == 0;
}

/**
 * Determines if pagination for a given GraphQL response is complete.
 * It checks if the response array is empty, or if specific properties like
 * `costItems`, `nodes`, or `edges` are empty, indicating no more data.
 * @param {any} response - The GraphQL response data.
 * @returns {boolean} True if pagination is complete, false otherwise.
 * @throws {Error} If the operation is not recognized as paginated.
 */
function isPaginationComplete(response) {
    if(Array.isArray(response)) {
        return isEmpty(response);
    } else if(response.costItems != null) {
        return isEmpty(response.costItems);
    } else if(response.nodes != null && response.edges != null) {
        return isEmpty(response.nodes) && isEmpty(response.edges);
    } else {
        throw new Error('This operation is not paginated.');
    }
}

/**
 * Creates an asynchronous generator function that handles pagination for GraphQL operations.
 * It repeatedly calls the provided `operation` function, adjusting the page size dynamically
 * if `FUNCTION_RESPONSE_SIZE_TOO_LARGE` is encountered.
 * @param {function} operation - The GraphQL operation function to paginate.
 * @param {object} options - Pagination options.
 * @param {number} options.pageSize - The initial page size.
 * @returns {function(object): AsyncGenerator} An async generator that yields pages from the operation.
 */
export function createPaginator(operation, { pageSize: PAGE_SIZE }) {
    return async function* (variables = {}) {
        let pageSize = PAGE_SIZE;
        let start = 0;
        let end = pageSize;
        let response = null; // Initialize to null to ensure the loop runs at least once.

        // Loop continues as long as the response is null (first iteration) or pagination is not complete.
        while (response == null || !isPaginationComplete(response)) {
            try {
                // Adjust variables for cost queries, which have a nested structure.
                if(isCostQuery(variables)) {
                    const keys = Object.keys(variables);
                    const key = keys[0];
                    const args = { ...variables[key], pagination: { start, end } };
                    response = await operation({ [key]: { ...args } });
                } else {
                    // For other queries, add pagination directly to variables.
                    response = await operation({...variables, pagination: { start, end } });
                }

                // Yield the response if pagination is not yet complete.
                if(!isPaginationComplete(response)) yield response;

                start = start + pageSize; // Move to the next page start.
                pageSize = PAGE_SIZE; // Reset page size to original after successful fetch.
                end = end + pageSize; // Update end for the next page.
            } catch (err) {
                // If a Lambda response size limit error occurs, halve the page size and retry the current page.
                if (err.message === FUNCTION_RESPONSE_SIZE_TOO_LARGE) {
                    pageSize = Math.floor(pageSize / 2);
                    logger.debug(`Lambda response size too large, reducing page size to ${pageSize}`);
                    end = start + pageSize; // Adjust end to new page size.
                } else {
                    throw err; // Re-throw other errors.
                }
            }
        }
    };
}

/**
 * Handles errors returned in the GraphQL response body.
 * It checks for specific transient errors (e.g., `CONNECTION_CLOSED_PREMATURELY`)
 * to trigger retries, or bails (stops retrying) for non-recoverable errors
 * like `FUNCTION_RESPONSE_SIZE_TOO_LARGE` or other GraphQL errors.
 * @param {function} bail - The `async-retry` bail function to stop retries.
 * @returns {function(object): any} A function that processes the GraphQL response body.
 */
function errorHandler(bail) {
    return body => {
        const {errors} = body;
        if (errors != null) {
            if (errors.length === 1) {
                const {errorType, message} = errors[0];
                // This transient error can happen due to a bug in the Gremlin client library
                // that the GraphQL Lambda uses. One retry is normally sufficient.
                if (message === CONNECTION_CLOSED_PREMATURELY) {
                    throw new Error(message); // Throw to trigger a retry.
                }
                // If the function response size limit is reached, bail immediately.
                if (errorType === FUNCTION_RESPONSE_SIZE_TOO_LARGE) {
                    return bail(new Error(errorType)); // Bail on this specific error.
                }
            }
            logger.error('Error executing gql request', {errors: body.errors})
            return bail(new Error(JSON.stringify(errors))); // Bail on other GraphQL errors.
        }

        // If no errors, extract the data for the single query/mutation.
        const [queryName] = Object.keys(body.data);
        return body.data[queryName];
    }
}

/**
 * Creates the main SDK client for interacting with the AppSync GraphQL API.
 * This client handles authentication, request signing, and exposes GraphQL
 * queries and mutations. It dynamically excludes certain operations based on
 * the `crossAccountDiscovery` configuration.
 * @param {object} config - Configuration object for the client.
 * @param {string} config.apiUrl - The AppSync GraphQL API URL.
 * @param {object} [config.credentials] - Optional AWS credentials. If not provided, they will be fetched.
 * @param {string} config.crossAccountDiscovery - The cross-account discovery method (e.g., 'AWS_ORGANIZATIONS').
 * @returns {object} The SDK client object with various GraphQL operation methods.
 * @throws {Error} If `crossAccountDiscovery` is invalid or `apiUrl` is not a valid AppSync URL.
 */
export function createClient({apiUrl, credentials, crossAccountDiscovery}) {
    // Validate the `crossAccountDiscovery` parameter.
    if(!ALLOWED_CROSS_ACCOUNT_DISCOVERY_VALUES.includes(crossAccountDiscovery)) {
        throw new Error(`The crossAccountDiscovery parameter must one of: ${ALLOWED_CROSS_ACCOUNT_DISCOVERY_VALUES}.`);
    }

    // Extract the AWS region from the AppSync API URL.
    const {groups: {region}} = apiUrl.match(/appsync-api\.(?<region>.*)\.amazonaws\.com/) ?? {groups: {}};
    if(region == null) {
        throw new Error(`The apiUrl parameter value is not a valid AppSync URL.`);
    }

    const url = new URL(apiUrl); // Parse the API URL.

    // Determine which operations to exclude based on `alwaysExclude` and `orgsExclude` (if using Organizations).
    const exclude = new Set([
        ...alwaysExclude,
        ...(isUsingOrganizations(crossAccountDiscovery) ? orgsExclude : [])
    ]);

    /**
     * Curried function to send a GraphQL request.
     * It handles fetching credentials if not provided, signing the request with AWS Signature Version 4,
     * and applying retry logic.
     * @param {string} query - The GraphQL query or mutation string.
     * @param {object} variables - The variables for the GraphQL operation.
     * @returns {Promise<any>} A promise that resolves to the GraphQL data.
     */
    const sendRequest = curry(async (query, variables) => {
        // Fetch credentials if not already provided.
        if (credentials == null) {
            const CredentialsProvider = fromNodeProviderChain();
            credentials = await CredentialsProvider();
        }

        const method = 'POST';

        // Options for signing the AWS request.
        const signingOptions = {
            method,
            host: url.hostname,
            path: url.pathname,
            region,
            body: JSON.stringify({
                query,
                variables
            }),
            service: 'appsync'
        };

        // Sign the request.
        const sig = aws4.sign(signingOptions, credentials);

        // Send the request with retry logic.
        return retry(async bail => {
            return request(apiUrl, {
                method,
                headers: sig.headers,
                body: signingOptions.body
            })
                .catch(err => {
                    logger.error(`Error with HTTP request: ${err.message}`)
                    throw err; // Re-throw HTTP errors to be caught by `async-retry`.
                })
                .then(({body}) => body.json()) // Parse JSON response.
                .then(errorHandler(bail)) // Handle GraphQL errors in the response.
        }, {
            retries: 3, // Max 3 retries.
            onRetry: (err, count) => {
                logger.error(`Retry attempt no ${count}: ${err.message}`); // Log retry attempts.
            }
        });
    });

    // Create an object of query functions, excluding those marked for exclusion.
    const queryFunctions = Object.entries(queries).reduce((acc, [name, query]) => {
        if(!exclude.has(name)) acc[name] = (variables = {}) => sendRequest(query, variables);
        return acc;
    }, {});

    // Create an object of mutation functions, excluding those marked for exclusion.
    const mutationFunctions = Object.entries(mutations).reduce((acc, [name, mutation]) => {
        if(!exclude.has(name)) acc[name] = (variables = {}) => sendRequest(mutation, variables);
        return acc;
    }, {});

    // Return the final SDK client object.
    return {
        getRegion: () => region, // Provides access to the client's configured region.
        sendRequest, // Exposes the raw sendRequest function.
        ...queryFunctions, // All exposed query methods.
        ...mutationFunctions // All exposed mutation methods.
    };
}
