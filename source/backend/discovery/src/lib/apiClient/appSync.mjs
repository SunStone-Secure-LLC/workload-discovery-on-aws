// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module provides a client for interacting with the AWS AppSync GraphQL API.
 * It handles signing GraphQL requests with AWS Signature Version 4, sending queries/mutations,
 * and implementing retry logic for transient errors. It also includes a paginator utility
 * for handling large datasets returned by GraphQL queries.
 */

import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import {request} from 'undici'; // Imports `request` from undici for making HTTP requests.
import retry from 'async-retry'; // Imports `async-retry` for implementing retry logic on failed requests.
import aws4 from 'aws4'; // Imports `aws4` for signing AWS requests with Signature Version 4.
import logger from '../logger.mjs'; // Imports the logging utility.
import {
    CONNECTION_CLOSED_PREMATURELY,
    FUNCTION_RESPONSE_SIZE_TOO_LARGE,
    RESOLVER_CODE_SIZE_ERROR
} from '../constants.mjs'; // Imports constants for specific AppSync/Lambda error messages.

/**
 * Sends a GraphQL query or mutation to the AppSync endpoint.
 * This function signs the request using AWS Signature Version 4 and includes retry logic
 * for transient network errors or specific AppSync/Lambda-related errors.
 * @param {object} opts - Configuration options including host, region, path, credentials, and GraphQL URL.
 * @param {string} name - The name of the GraphQL operation (e.g., 'getAccounts', 'addResources').
 * @param {object} payload - An object containing the `query` string and `variables` object for the GraphQL request.
 * @returns {Promise<any>} A promise that resolves to the data returned by the GraphQL operation,
 *   or rejects with an error if the request fails after retries.
 */
async function sendQuery(opts, name, {query, variables = {}}) {
    // Options for signing the AWS request.
    const sigOptions = {
        method: 'POST',
        host: opts.host,
        region: opts.region,
        path: opts.path,
        headers: {
            'x-amzn-workload-discovery-requester': 'discovery-process' // Custom header for tracking requests.
        },
        body: JSON.stringify({
            query,
            variables
        }),
        service: 'appsync' // The AWS service to sign for.
    };

    // Signs the request using AWS Signature Version 4 with provided credentials.
    const sig = aws4.sign(sigOptions, opts.creds);

    // Implements retry logic for the HTTP request.
    return retry(async bail => {
        return request(opts.graphgQlUrl, {
            method: 'POST',
            headers: sig.headers, // Signed headers.
            body: sigOptions.body // Request body.
        }).catch(err => {
            logger.error(`Error sending gql request, ensure query is not malformed: ${err.message}`)
            bail(err); // Bail (stop retrying) on immediate request errors.
        }).then(({body}) => body.json()) // Parse the JSON response body.
            .then((body) => {
                const {errors} = body;
                if (errors != null) {
                    if(errors.length === 1) {
                        const {message} = R.head(errors);
                        // This transient error can happen due to a bug in the Gremlin client library
                        // that the AppSync Lambda uses. One retry is normally sufficient.
                        if(message === CONNECTION_CLOSED_PREMATURELY) {
                            throw new Error(message); // Throw to trigger a retry.
                        }
                        // If the resolver code size limit or function response size limit is reached,
                        // bail immediately as retrying won't help; it requires reducing page size.
                        if([RESOLVER_CODE_SIZE_ERROR, FUNCTION_RESPONSE_SIZE_TOO_LARGE].includes(message)) {
                            return bail(new Error(message)); // Bail on these specific errors.
                        }
                    }
                    logger.error('Error executing gql request', {errors: body.errors, query, variables})
                    return bail(new Error(JSON.stringify(errors))); // Bail on other GraphQL errors.
                }
                return body.data[name]; // Return the data for the requested operation.
            });
    }, {
        retries: 3, // Maximum number of retries.
        onRetry: (err, count) => {
            logger.error(`Retry attempt for ${name} no ${count}: ${err.message}`); // Log retry attempts.
        }
    });
}

/**
 * Creates an asynchronous generator function that handles pagination for GraphQL operations.
 * It repeatedly calls the provided `operation` function, adjusting the page size dynamically
 * if `FUNCTION_RESPONSE_SIZE_TOO_LARGE` or `RESOLVER_CODE_SIZE_ERROR` is encountered.
 * @param {function} operation - The GraphQL operation function (e.g., `getResources`, `getRelationships`).
 * @param {number} PAGE_SIZE - The initial page size for pagination.
 * @returns {function(object): AsyncGenerator} An async generator that yields pages of resources.
 */
function createPaginator(operation, PAGE_SIZE) {
    return async function*(args) {
        let pageSize = PAGE_SIZE;
        let start = 0;
        let end = pageSize;
        let resources = null; // Initialize to null to ensure the loop runs at least once.

        // Loop continues as long as resources are not empty (meaning there are more pages).
        while(resources === null || !R.isEmpty(resources)) {
            try {
                resources = await operation({pagination: {start, end}, ...args}); // Fetch a page of resources.
                yield resources // Yield the current page.
                start = start + pageSize; // Move to the next page start.
                pageSize = PAGE_SIZE; // Reset page size to original after successful fetch.
                end = end + pageSize; // Update end for the next page.
            } catch(err) {
                // If a size limit error occurs, reduce the page size and retry the current page.
                if([RESOLVER_CODE_SIZE_ERROR, FUNCTION_RESPONSE_SIZE_TOO_LARGE].includes(err.message)) {
                    pageSize = Math.floor(pageSize / 2); // Halve the page size.
                    logger.debug(`Lambda response size too large, reducing page size to ${pageSize}`);
                    end = start + pageSize; // Adjust end to new page size.
                } else {
                    throw err; // Re-throw other errors.
                }
            }
        }
    }
}

/**
 * Fetches all accounts from AppSync.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(): Promise<Array>} An async function that returns an array of account objects.
 */
const getAccounts = opts => async () => {
    const name = 'getAccounts';
    const query = `
      query ${name} {
        getAccounts {
          accountId
          lastCrawled
          name
          regions {
            name
          }
        }
      }`;
    return sendQuery(opts, name, {query});
};

/**
 * Adds new relationships to the database via AppSync.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(Array): Promise<object>} An async function that adds relationships.
 */
const addRelationships = opts => async relationships => {
    const name = 'addRelationships';
    const query = `
    mutation ${name}($relationships: [RelationshipInput]!) {
      ${name}(relationships: $relationships) {
        id
      }
    }`;
    const variables = {relationships};
    return sendQuery(opts, name, {query, variables});
};

/**
 * Adds new resources to the database via AppSync.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(Array): Promise<object>} An async function that adds resources.
 */
const addResources = opts => async resources => {
    const name = 'addResources';
    const query = `
    mutation ${name}($resources: [ResourceInput]!) {
      ${name}(resources: $resources) {
        id
        label
      }
    }`;
    const variables = {resources};
    return sendQuery(opts, name, {query, variables});
};

/**
 * Fetches resources from the database via AppSync, with optional pagination, resource types, and accounts filters.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(object): Promise<Array>} An async function that returns an array of resource objects.
 */
const getResources = opts => async ({pagination, resourceTypes, accounts}) => {
    const name = 'getResources';
    const query = `
    query ${name}(
    $pagination: Pagination
    $resourceTypes: [String]
    $accounts: [AccountInput]
  ) {
    getResources(
      pagination: $pagination
      resourceTypes: $resourceTypes
      accounts: $accounts
    ) {
      id
      label
      md5Hash
      properties {
        accountId
        arn
        availabilityZone
        awsRegion
        configuration
        configurationItemCaptureTime
        configurationStateId
        configurationItemStatus
        loggedInURL
        loginURL
        private
        resourceCreationTime
        resourceName
        resourceId
        resourceType
        resourceValue
        state
        supplementaryConfiguration
        subnetId
        subnetIds
        tags
        title
        version
        vpcId
        dBInstanceStatus
        statement
        instanceType
      }
    }
  }`;
    const variables = {pagination, resourceTypes, accounts};
    return sendQuery(opts, name, {query, variables});
};

/**
 * Fetches relationships from the database via AppSync with pagination.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(object): Promise<Array>} An async function that returns an array of relationship objects.
 */
const getRelationships = opts => async ({pagination}) => {
    const name = 'getRelationships';
    const query = `
    query ${name}($pagination: Pagination) {
      getRelationships(pagination: $pagination) {
        target {
          id
          label
        }
        id
        label
        source {
          id
          label
        }
      }
}`;
    const variables = {pagination};
    return sendQuery(opts, name, {query, variables});
};

/**
 * Indexes resources in OpenSearch via AppSync.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(Array): Promise<object>} An async function that indexes resources.
 */
const indexResources = opts => async resources => {
    const name = 'indexResources';
    const query = `
    mutation ${name}($resources: [ResourceInput]!) {
      ${name}(resources: $resources) {
        unprocessedResources
      }
    }`;
    const variables = {resources};
    return sendQuery(opts, name, {query, variables});
};

/**
 * Updates existing resources in the database via AppSync.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(Array): Promise<object>} An async function that updates resources.
 */
const updateResources = opts => async resources => {
    const name = 'updateResources';
    const query = `
    mutation ${name}($resources: [ResourceInput]!) {
      ${name}(resources: $resources) {
        id
      }
    }`;
    const variables = {resources};
    return sendQuery(opts, name, {query, variables});
};

/**
 * Deletes relationships from the database via AppSync.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(Array): Promise<object>} An async function that deletes relationships.
 */
const deleteRelationships = opts => async relationshipIds => {
    const name = 'deleteRelationships';
    const query = `
    mutation ${name}($relationshipIds: [String]!) {
      ${name}(relationshipIds: $relationshipIds)
    }`;
    const variables = {relationshipIds};
    return sendQuery(opts, name, {query, variables});
};

/**
 * Deletes resources from the database via AppSync.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(Array): Promise<object>} An async function that deletes resources.
 */
const deleteResources = opts => async resourceIds => {
    const name = 'deleteResources';
    const query = `
    mutation ${name}($resourceIds: [String]!) {
      ${name}(resourceIds: $resourceIds)
    }`;
    const variables = {resourceIds};
    return sendQuery(opts, name, {query, variables});
};

/**
 * Deletes indexed resources from OpenSearch via AppSync.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(Array): Promise<object>} An async function that deletes indexed resources.
 */
const deleteIndexedResources = opts => async resourceIds => {
    const name = 'deleteIndexedResources';
    const query = `
    mutation ${name}($resourceIds: [String]!) {
      ${name}(resourceIds: $resourceIds) {
        unprocessedResources
      }
    }`;
    const variables = {resourceIds};
    return sendQuery(opts, name, {query, variables});
};

/**
 * Updates indexed resources in OpenSearch via AppSync.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(Array): Promise<object>} An async function that updates indexed resources.
 */
const updateIndexedResources = opts => async resources => {
    const name = 'updateIndexedResources';
    const query = `
    mutation ${name}($resources: [ResourceInput]!) {
      ${name}(resources: $resources) {
        unprocessedResources
      }
    }`;
    const variables = {resources};
    return sendQuery(opts, name, {query, variables});
};

/**
 * Adds new accounts to the database via AppSync.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(Array): Promise<object>} An async function that adds accounts.
 */
const addAccounts = opts => async accounts => {
    const name = 'addAccounts';
    const query = `
      mutation ${name}($accounts: [AccountInput]!) {
        addAccounts(accounts: $accounts) {
          unprocessedAccounts
        }
      }
`
    const variables = {accounts};
    return sendQuery(opts, name, {query, variables});
}

/**
 * Updates an existing account's details in the database via AppSync.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(string, string, boolean, string, object): Promise<object>} An async function that updates an account.
 */
const updateAccount = opts => async (accountId, accountName, isIamRoleDeployed, lastCrawled, resourcesRegionMetadata) => {
    const name = 'updateAccount';
    const query = `
    mutation ${name}($accountId: String!, $name: String, $isIamRoleDeployed: Boolean, $lastCrawled: AWSDateTime, $resourcesRegionMetadata: ResourcesRegionMetadataInput) {
      ${name}(accountId: $accountId, name: $name, isIamRoleDeployed: $isIamRoleDeployed, lastCrawled: $lastCrawled, resourcesRegionMetadata: $resourcesRegionMetadata) {
        accountId
        lastCrawled
      }
    }`;
    const variables = {accountId, name: accountName, lastCrawled, isIamRoleDeployed, resourcesRegionMetadata};
    return sendQuery(opts, name, {query, variables});
};

/**
 * Deletes accounts from the database via AppSync.
 * @param {object} opts - Configuration options for `sendQuery`.
 * @returns {function(Array): Promise<object>} An async function that deletes accounts.
 */
const deleteAccounts = opts => async (accountIds) => {
    const name = 'deleteAccounts';
    const query = `
    mutation ${name}($accountIds: [String]!) {
        deleteAccounts(accountIds: $accountIds) {
            unprocessedAccounts
        }
    }`;
    const variables = {accountIds};
    return sendQuery(opts, name, {query, variables});
};

/**
 * Default export function that initializes the AppSync client.
 * It parses the GraphQL API URL to extract host and path, then returns an object
 * containing all the callable GraphQL operations.
 * @param {object} config - Configuration object containing `graphgQlUrl` and `creds`.
 * @returns {object} An object with methods for interacting with the AppSync API.
 */
export default function(config) {
    // Parses the GraphQL API URL to extract host and path for signing requests.
    const [host, path] = config.graphgQlUrl.replace('https://', '').split('/');

    // Combines parsed host/path with other configuration options.
    const opts = {
        host,
        path,
        ...config
    };

    // Returns an object containing all the AppSync operations, bound with the configuration options.
    return {
        addRelationships: addRelationships(opts),
        addResources: addResources(opts),
        deleteRelationships: deleteRelationships(opts),
        deleteResources: deleteResources(opts),
        indexResources: indexResources(opts),
        addAccounts: addAccounts(opts),
        deleteAccounts: deleteAccounts(opts),
        getAccounts: getAccounts(opts),
        updateAccount: updateAccount(opts),
        updateResources: updateResources(opts),
        deleteIndexedResources: deleteIndexedResources(opts),
        updateIndexedResources: updateIndexedResources(opts),
        getResources: getResources(opts),
        getRelationships: getRelationships(opts),
        createPaginator // Exposes the paginator creation utility.
    };
};
