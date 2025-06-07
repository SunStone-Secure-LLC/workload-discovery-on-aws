// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module provides a factory for creating an API client that interacts
 * with the backend GraphQL API (AppSync) and underlying data stores (Neptune/OpenSearch).
 * It includes functions for fetching, processing, and persisting AWS resources and relationships,
 * as well as managing account-related data, with built-in concurrency and error handling.
 */

import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import {PromisePool, PromisePoolError} from '@supercharge/promise-pool'; // Imports PromisePool for concurrent promise execution with error handling.
import {profileAsync, createArn} from '../utils.mjs'; // Imports utility functions for async profiling and ARN creation.
import {UnprocessedOpenSearchResourcesError} from '../errors.mjs' // Imports custom error for OpenSearch processing failures.
import logger from '../logger.mjs'; // Imports the logging utility.
import {parse as parseArn} from '@aws-sdk/util-arn-parser'; // Imports ARN parser from AWS SDK utility.
import {
    ACCESS_DENIED,
    ACCESS_DENIED_EXCEPTION,
    IAM,
    ROLE,
    DISCOVERY_ROLE_NAME,
} from '../constants.mjs'; // Imports constants related to IAM, roles, and access errors.

/**
 * Creates a function to retrieve all resources from the database (Neptune) via AppSync.
 * It handles pagination and can fetch resources for specific accounts concurrently.
 * @param {object} appSync - The AppSync client instance with `createPaginator` and `getResources` methods.
 * @returns {function(object): Promise<Map<string, object>>} An async function that takes an optional `accounts` object
 *   and returns a Map where keys are resource IDs and values are resource objects.
 */
function getDbResourcesMap(appSync) {
    const {createPaginator, getResources} = appSync;
    // Creates a paginator for fetching resources with a page size of 1000.
    const getResourcesPaginator = createPaginator(getResources, 1000);

    return async ({accounts} = {}) => {
        const resourcesMap = new Map();

        // If `accounts` is not specified, a single paginator is created to fetch all resources serially.
        // Otherwise, a paginator is created for each account, and they are executed concurrently
        // up to the limit defined for the promise pool.
        const paginators = accounts == null ?
            [getResourcesPaginator({})] :
            accounts.map(({accountId}) => getResourcesPaginator({accounts: [{accountId}]}));

        // Uses PromisePool to process paginators concurrently.
        await PromisePool
            .withConcurrency(20) // Limits concurrency to 20 parallel paginator executions.
            .for(paginators)
            .handleError(async (error) => {
                logger.error(`There was a problem downloading accounts from Neptune: ${error}.`);
                throw error; // Re-throw the error after logging.
            })
            .process(async paginator => {
                // Iterates through each page of resources from the paginator.
                for await (const resources of paginator) {
                    resources.forEach(r => resourcesMap.set(r.id, {
                        id: r.id,
                        label: r.label,
                        md5Hash: r.md5Hash,
                        // GraphQL might return `null` for missing properties, which can break
                        // hashing comparisons for SDK-discovered resources. Reject nil values.
                        properties: R.reject(R.isNil, r.properties),
                    }));
                }
            });

        return resourcesMap;
    };
}

/**
 * Creates a function to retrieve all relationships from the database (Neptune) via AppSync.
 * It handles pagination recursively to fetch all relationships.
 * @param {object} appSync - The AppSync client instance with a `getRelationships` method.
 * @returns {function(): Promise<Map<string, object>>} An async function that returns a Map
 *   where keys are composite strings (source_label_target) and values are relationship objects.
 */
function getDbRelationshipsMap(appSync) {
    const pageSize = 2500; // Defines the page size for fetching relationships.

    /**
     * Recursively fetches relationships from the database.
     * @param {object} pagination - Pagination parameters (`start`, `end`).
     * @param {Map<string, object>} relationshipsMap - Accumulator for relationships.
     * @returns {Promise<Map<string, object>>} A promise that resolves to the accumulated relationships map.
     */
    function getDbRelationships(pagination, relationshipsMap= new Map()) {
        return appSync.getRelationships({pagination})
            .then(relationships => {
                if(R.isEmpty(relationships)) return relationshipsMap; // Base case: no more relationships.
                relationships.forEach(rel => {
                    const {id: source} = rel.source;
                    const {id: target} = rel.target;
                    const {label, id} = rel;
                    // Stores relationships using a composite key for uniqueness.
                    relationshipsMap.set(`${source}_${label}_${target}`, {
                        source, target, id, label
                    })
                });
                const {start, end} = pagination;
                // Recursively call for the next page.
                return getDbRelationships({start: start + pageSize, end: end + pageSize}, relationshipsMap);
            })
    }

    return async () => getDbRelationships({start: 0, end: pageSize}); // Initiates the recursive fetch.
}

/**
 * Creates a generic processor function that takes a batch processor and applies it
 * to a list of resources, splitting them into batches and handling concurrency.
 * It collects and reports any errors encountered during processing.
 * @param {function} processor - An async function that processes a batch of resources.
 * @returns {function(object, Array): Promise<object>} An async function that takes concurrency/batch size
 *   and resources, returning results and errors.
 */
function process(processor) {
    return async ({concurrency, batchSize}, resources) => {
        const errors = [];
        const {results} = await PromisePool
            .withConcurrency(concurrency) // Sets the maximum number of concurrent batches.
            .for(R.splitEvery(batchSize, resources)) // Splits resources into batches.
            .handleError(async (error, batch) => {
                // If the error is an `UnprocessedOpenSearchResourcesError`, extract its failures; otherwise, use the whole batch.
                const failures = error instanceof UnprocessedOpenSearchResourcesError ? error.failures : batch;
                errors.push(new PromisePoolError(error, failures)); // Store the error with associated failures.
            })
            .process(processor); // Process each batch using the provided processor function.
        return {results, errors};
    }
}

/**
 * Creates a resource processor function that handles mutations to both OpenSearch and Neptune.
 * It attempts to index/delete/update resources in OpenSearch first, then in Neptune.
 * If OpenSearch processing fails for some resources, it partitions the batch and only processes
 * the successfully indexed ones in Neptune, throwing a custom error for unprocessed resources.
 * @param {function} openSearchMutation - An async function to perform mutation in OpenSearch (e.g., `indexResources`).
 * @param {function} neptuneMutation - An async function to perform mutation in Neptune (e.g., `addResources`).
 * @param {string} errorMsg - A descriptive error message for unprocessed resources.
 * @returns {function(Array): Promise<void>} An async function that processes resources.
 */
function createResourceProcessor(openSearchMutation, neptuneMutation, errorMsg) {
    return async resources => {
        // Attempt to mutate resources in OpenSearch.
        const {unprocessedResources: unprocessedResourceArns} = await openSearchMutation(resources)
        // Create a Set of ARNs for resources that OpenSearch failed to process.
        const unprocessedSet = new Set(unprocessedResourceArns);
        // Partition the original resources into processed and unprocessed based on OpenSearch's response.
        const [unprocessedResources, processedResources] = R.partition(x => unprocessedSet.has(x.id ?? x), resources);

        // Mutate only the successfully processed resources in Neptune.
        await neptuneMutation(processedResources)

        // If there are any unprocessed resources from OpenSearch, log an error and throw a custom error.
        if(!R.isEmpty(unprocessedResources)) {
            logger.error(`${unprocessedResources.length} resources ${errorMsg}`, {unprocessedResources});
            throw new UnprocessedOpenSearchResourcesError(unprocessedResources);
        }
    }
}

/**
 * Creates a function to update the `lastCrawled` timestamp and `resourcesRegionMetadata` for accounts
 * in the database via AppSync.
 * It processes accounts concurrently and logs any errors.
 * @param {object} appSync - The AppSync client instance with an `updateAccount` method.
 * @returns {function(Array): Promise<object>} An async function that updates crawled accounts.
 */
function updateCrawledAccounts(appSync) {
    return async accounts => {
        const {errors, results} = await PromisePool
            .withConcurrency(10) // Concurrency limit, matching the reserved concurrency of the settings Lambda.
            .for(accounts)
            .process(async ({accountId, name, isIamRoleDeployed, lastCrawled, resourcesRegionMetadata}) => {
                // Updates account details, setting `lastCrawled` to current time if IAM role is deployed.
                return appSync.updateAccount(
                    accountId,
                    name,
                    isIamRoleDeployed, isIamRoleDeployed ? new Date().toISOString() : lastCrawled,
                    resourcesRegionMetadata
                );
            });

        logger.error(`There were ${errors.length} errors when updating last crawled time for accounts.`);
        logger.debug('Errors: ', {errors});

        return {errors, results};
    }
}

/**
 * Creates a function to add new accounts to the database via AppSync.
 * It omits temporary credentials and transforms region data before persistence.
 * @param {object} appSync - The AppSync client instance with an `addAccounts` method.
 * @returns {function(Array): Promise<any>} An async function that adds new accounts.
 */
function addCrawledAccounts(appSync) {
    return async accounts => {
        return Promise.resolve(accounts)
            // Ensure temporary credentials and `toDelete` flag are not persisted to the database.
            .then(R.map(R.omit(['credentials', 'toDelete'])))
            .then(R.map(({regions, isIamRoleDeployed, lastCrawled, ...props}) => {
                return {
                    ...props,
                    isIamRoleDeployed,
                    // Omit `isConfigEnabled` from regions before persisting.
                    regions: regions.map(R.omit(['isConfigEnabled'])),
                    // Set `lastCrawled` to current time if IAM role is deployed, otherwise keep existing.
                    lastCrawled: isIamRoleDeployed ? new Date().toISOString() : lastCrawled
                }
            }))
            .then(appSync.addAccounts); // Call AppSync to add the transformed accounts.
    }
}

/**
 * Fetches and reconciles accounts from AWS Organizations and the database.
 * It identifies new accounts, existing accounts, and accounts that have been deleted from the organization.
 * @param {object} clients - An object containing `ec2Client`, `organizationsClient`, and `configClient`.
 * @param {object} appSyncClient - The AppSync client instance.
 * @param {object} config - Configuration object including `configAggregator` and `organizationUnitId`.
 * @returns {Promise<Array>} A promise that resolves to a reconciled list of account objects.
 */
async function getOrgAccounts(
    {ec2Client, organizationsClient, configClient}, appSyncClient, {configAggregator, organizationUnitId}
) {
    // Fetch existing accounts from DB, active accounts from Organizations, Config aggregator details, and all regions concurrently.
    const [dbAccounts, orgAccounts, {OrganizationAggregationSource}, regions] = await Promise.all([
        appSyncClient.getAccounts(), // Accounts currently in the database.
        organizationsClient.getAllActiveAccountsFromParent(organizationUnitId), // Active accounts from AWS Organizations.
        configClient.getConfigAggregator(configAggregator), // Details of the Config aggregator.
        ec2Client.getAllRegions() // All available AWS regions.
    ]);

    logger.info(`Organization source info.`, {OrganizationAggregationSource});
    const dbAccountsMap = new Map(dbAccounts.map(x => [x.accountId, x]));
    logger.info('Accounts from db.', {dbAccounts});
    const orgAccountsMap = new Map(orgAccounts.map(x => [x.Id, x]));

    // Identify accounts that exist in the DB but are no longer in the organization (marked for deletion).
    const deletedAccounts = dbAccounts.reduce((acc, account) => {
        const {accountId} = account;
        if(dbAccountsMap.has(accountId) && !orgAccountsMap.has(accountId)) {
            acc.push({...account, toDelete: true});
        }
        return acc;
    }, []);

    // Reconcile organization accounts with DB accounts, adding relevant properties.
    return orgAccounts
        .map(({Id, isManagementAccount, Name: name, Arn}) => {
            const [, organizationId] = parseArn(Arn).resource.split('/'); // Extract organization ID from ARN.
            const lastCrawled = dbAccountsMap.get(Id)?.lastCrawled; // Get last crawled time from DB if available.
            return {
                accountId: Id,
                organizationId,
                name,
                ...(isManagementAccount ? {isManagementAccount} : {}), // Mark management account.
                ...(lastCrawled != null ? {lastCrawled} : {}), // Include last crawled time.
                // Determine regions based on whether the aggregator is for all regions or specific ones.
                regions: OrganizationAggregationSource.AllAwsRegions
                    ? regions : OrganizationAggregationSource.AwsRegions.map(name => ({name})),
                // Mark accounts for deletion if they are in DB but not in Org.
                toDelete: dbAccountsMap.has(Id) && !orgAccountsMap.has(Id)
            };
        })
        .concat(deletedAccounts); // Combine with accounts marked for deletion.
}

/**
 * Creates an ARN for the discovery IAM role in a given account.
 * @param {string} accountId - The AWS account ID where the role resides.
 * @param {string} rootAccountId - The root AWS account ID (used in the role name).
 * @returns {string} The ARN of the discovery role.
 */
function createDiscoveryRoleArn(accountId, rootAccountId) {
    return createArn({service: IAM, accountId, resource: `${ROLE}/${DISCOVERY_ROLE_NAME}-${rootAccountId}`});
}

/**
 * Curried function to add AWS Config enablement status to accounts.
 * It checks if AWS Config is enabled in each region of an account by calling `isConfigEnabled`.
 * Handles access denied errors gracefully.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {Array<object>} accounts - An array of account objects to process.
 * @returns {Promise<Array>} A promise that resolves to an array of account objects with updated Config status.
 */
const addConfigStatus = R.curry(async (awsClient, accounts) => {
    const {errors, results} = await PromisePool
        .withConcurrency(5) // Limits concurrency for Config enablement checks.
        .for(accounts.map(({regions, ...account}) => {
            // Initialize `isConfigEnabled` to null for each region.
            return {
                ...account,
                regions: regions.map(region => {
                    return {
                        ...region,
                        isConfigEnabled: null,
                    }
                })
            }
        }))
        .process(async (account) => {
            // Skip accounts where the global resources template is not deployed (no IAM role).
            if(!account.isIamRoleDeployed) return account;

            const {accountId, credentials} = account;

            const regions = await Promise.resolve(account.regions)
                .then(R.map(async region => {
                    const configClient = awsClient.createConfigServiceClient(credentials, region.name);
                    const isConfigEnabled = await configClient.isConfigEnabled()
                        .catch(error => {
                            // If access is denied, re-throw to be caught by the outer PromisePool error handler.
                            if (error.name === ACCESS_DENIED_EXCEPTION) throw error;
                            logger.error(`Error verifying AWS Config is enabled in the ${region.name} of account ${accountId}: ${error}`);
                            return null; // Return null if other errors occur.
                        });

                    return {
                        ...region,
                        isConfigEnabled
                    };
                }))
                .then(ps => Promise.all(ps)) // Wait for all region checks to complete.
                .catch(error => {
                    // Handle specific access denied error for Config enablement check.
                    if (error.name === ACCESS_DENIED_EXCEPTION) {
                        logger.error(`AWS Config enablement check failed, the Workload discovery role does not have permission to verify if AWS Config is enabled in account ${accountId}. Ensure that the global resources template has been updated in this account.`, {error: error.message});
                    } else {
                        logger.error(`Error verifying AWS Config is enabled in account ${accountId}: ${error}`);
                    }
                    return account.regions; // Return original regions if an unhandled error occurs.
                });

            return {
                ...account,
                regions
            };
        });

    logger.error(`There were ${errors.length} account errors when verifying if Config was enabled in accounts to be discovered.`, {errors});

    // Combine accounts that had errors with successfully processed accounts.
    return [
        ...errors.filter(({raw}) => raw.Code === ACCESS_DENIED).map(({item}) => ({...item, isIamRoleDeployed: false})),
        ...results
    ];
});

/**
 * Curried function to add temporary AWS credentials to account objects by assuming the discovery role.
 * It attempts to assume the discovery role in each account concurrently.
 * Handles access denied errors and marks accounts where the role cannot be assumed.
 * @param {object} clients - An object containing the `stsClient`.
 * @param {string} rootAccountId - The root AWS account ID.
 * @param {Array<object>} accounts - An array of account objects.
 * @returns {Promise<Array>} A promise that resolves to an array of account objects with added credentials or `isIamRoleDeployed` status.
 */
const addAccountCredentials = R.curry(async ({stsClient}, rootAccountId, accounts) => {
    const {errors, results} = await PromisePool
        .withConcurrency(30) // Limits concurrency for role assumption.
        .for(accounts)
        .process(async ({accountId, organizationId, ...props}) => {
            const roleArn = createDiscoveryRoleArn(accountId, rootAccountId);
            const credentials = await stsClient.getCredentials(roleArn); // Assume role to get credentials.
            return {
                ...props,
                accountId,
                isIamRoleDeployed: true, // Mark as true if role assumption is successful.
                ...(organizationId != null ? {organizationId} : {}),
                credentials // Attach temporary credentials.
            };
        });

    // Log errors for failed role assumptions.
    errors.forEach(({message, raw: error, item: {accountId, isManagementAccount}}) => {
        const roleArn = createDiscoveryRoleArn(accountId, rootAccountId);
        if (error.Code === ACCESS_DENIED) {
            const errorMessage = `Access denied assuming role: ${roleArn}.`;
            if(isManagementAccount) {
                logger.error(`${errorMessage} This is the management account, ensure the global resources template has been deployed to the account.`);
            } else {
                logger.error(`${errorMessage} Ensure the global resources template has been deployed to account: ${accountId}. The discovery for this account will be skipped.`);
            }
        } else {
            logger.error(`Error assuming role: ${roleArn}: ${message}`);
        }
    });

    // Return successfully processed accounts and accounts that failed due to access denied (marked as not deployed).
    return [
        ...errors.filter(({raw}) => raw.Code === ACCESS_DENIED).map(({item}) => ({...item, isIamRoleDeployed: false})),
        ...results,
    ];
});

/**
 * Main factory function for creating the API client.
 * It initializes various AWS SDK clients and composes them into a single API client
 * with methods for interacting with the backend data stores and managing accounts.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {object} appSync - The AppSync client instance.
 * @param {object} config - The application configuration object.
 * @returns {object} An object representing the API client with various data access methods.
 */
export function createApiClient(awsClient, appSync, config) {
    // Initialize necessary AWS SDK clients.
    const ec2Client = awsClient.createEc2Client();
    const organizationsClient = awsClient.createOrganizationsClient();
    const configClient = awsClient.createConfigServiceClient();
    const stsClient = awsClient.createStsClient();

    return {
        // Methods for fetching data from Neptune (resources and relationships), with profiling.
        getDbResourcesMap: profileAsync('Time to download resources from Neptune', getDbResourcesMap(appSync)),
        getDbRelationshipsMap: profileAsync('Time to download relationships from Neptune', getDbRelationshipsMap(appSync)),
        /**
         * Retrieves and processes accounts, including fetching from Organizations (if enabled),
         * adding credentials, and checking Config enablement status.
         */
        getAccounts: profileAsync('Time to get accounts', () => {
            // Determine whether to get accounts from Organizations or directly from AppSync.
            const accountsP = config.isUsingOrganizations
                ? getOrgAccounts({ec2Client, organizationsClient, configClient}, appSync, config)
                : appSync.getAccounts()

            // Chain promises to add account credentials and Config status.
            return accountsP
                .then(addAccountCredentials({stsClient}, config.rootAccountId))
                .then(addConfigStatus(awsClient))
        }),
        // Methods for persisting account and resource data.
        addCrawledAccounts: addCrawledAccounts(appSync),
        deleteAccounts: appSync.deleteAccounts, // Direct passthrough to AppSync deleteAccounts.
        // Process functions for storing, deleting, and updating resources in OpenSearch and Neptune.
        storeResources: process(createResourceProcessor(appSync.indexResources, appSync.addResources, 'not written to OpenSearch')),
        deleteResources: process(createResourceProcessor(appSync.deleteIndexedResources, appSync.deleteResources, 'not deleted from OpenSearch')),
        updateResources: process(createResourceProcessor(appSync.updateIndexedResources, appSync.updateResources, 'not updated in OpenSearch')),
        // Process functions for deleting and storing relationships in Neptune.
        deleteRelationships: process(async ids => {
            return appSync.deleteRelationships(ids);
        }),
        storeRelationships: process(async relationships => {
            return appSync.addRelationships(relationships);
        }),
        updateCrawledAccounts: updateCrawledAccounts(appSync) // Updates crawled accounts.
    };
}
