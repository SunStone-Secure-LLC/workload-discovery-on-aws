// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module handles the persistence layer for the discovered resources,
 * relationships, and account information. It orchestrates the operations
 * (add, update, delete) to synchronize the backend database with the
 * latest state of the AWS environment based on calculated deltas.
 */

import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import logger from '../logger.mjs'; // Imports the logging utility.

/**
 * Curried function to persist resource and relationship deltas to the database.
 * It orchestrates the deletion, updating, and storing of resources and links
 * by calling the appropriate API client methods with specified concurrency and batch sizes.
 * It also logs the progress and returns a summary of failed operations.
 * @param {object} apiClient - The API client instance with methods for resource and relationship mutations.
 * @param {object} deltas - An object containing the calculated deltas:
 *   - `resourceIdsToDelete`: IDs of resources to delete.
 *   - `resourcesToStore`: New resources to add.
 *   - `resourcesToUpdate`: Resources to update.
 *   - `linksToAdd`: New links to add.
 *   - `linksToDelete`: IDs of links to delete.
 * @returns {Promise<object>} A promise that resolves to an object containing lists of failed deletes and stores.
 */
export const persistResourcesAndRelationships = R.curry(async (apiClient, deltas) => {
    const {
        resourceIdsToDelete, resourcesToStore, resourcesToUpdate,
        linksToAdd, linksToDelete
    } = deltas;

    logger.info(`Deleting ${resourceIdsToDelete.length} resources...`);
    logger.profile('Total time to upload'); // Start profiling for total upload time.
    // Delete resources with a concurrency of 5 and batch size of 50.
    const {errors: deleteResourcesErrors} = await apiClient.deleteResources({concurrency: 5, batchSize: 50}, resourceIdsToDelete);

    logger.info(`Updating ${resourcesToUpdate.length} resources...`);
    // Update resources with a concurrency of 10 and batch size of 10.
    await apiClient.updateResources({concurrency: 10, batchSize: 10}, resourcesToUpdate);

    logger.info(`Storing ${resourcesToStore.length} resources...`);
    // Store new resources with a concurrency of 10 and batch size of 10.
    const {errors: storeResourcesErrors} = await apiClient.storeResources({concurrency: 10, batchSize: 10}, resourcesToStore);

    logger.info(`Deleting ${linksToDelete.length} relationships...`);
    // Delete relationships with a concurrency of 5 and batch size of 50.
    await apiClient.deleteRelationships({concurrency: 5, batchSize: 50}, linksToDelete);

    logger.info(`Storing ${linksToAdd.length} relationships...`);
    // Store new relationships with a concurrency of 10 and batch size of 20.
    await apiClient.storeRelationships({concurrency: 10, batchSize: 20}, linksToAdd);

    logger.profile('Total time to upload'); // End profiling for total upload time.

    return {
        // Flatten errors to get a list of items that failed deletion or storage.
        failedDeletes: deleteResourcesErrors.flatMap(x => x.item),
        failedStores: storeResourcesErrors.flatMap(x => x.item.map(x => x.id))
    };
});

/**
 * Curried function to persist account information to the database.
 * It handles adding, updating, and deleting accounts, distinguishing between
 * organization-based and non-organization-based account management.
 * @param {object} config - Configuration object, including `isUsingOrganizations`.
 * @param {object} apiClient - The API client instance with methods for account mutations.
 * @param {Array<object>} accounts - An array of account objects to persist.
 * @param {Map<string, object>} resourcesRegionMetadata - A map of account IDs to their region metadata.
 * @returns {Promise<void>} A promise that resolves when account persistence is complete.
 */
export const persistAccounts = R.curry(async ({isUsingOrganizations}, apiClient, accounts, resourcesRegionMetadata) => {
    // Attach resourcesRegionMetadata to each account object.
    const accountsWithMetadata = accounts.map(({accountId, ...props}) => {
        return {
            accountId,
            ...props,
            resourcesRegionMetadata: resourcesRegionMetadata.get(accountId)
        }
    });

    if(isUsingOrganizations) {
        // Partition accounts into those to delete and those to store/update.
        const [accountsToDelete, accountsToStore] = R.partition(account => account.toDelete, accountsWithMetadata);
        // Further partition accounts to store into new accounts (to add) and existing accounts (to update).
        const [accountsToAdd, accountsToUpdate] = R.partition(account => account.lastCrawled == null, accountsToStore);

        logger.info(`Adding ${accountsToAdd.length} accounts...`);
        logger.info(`Updating ${accountsToUpdate.length} accounts...`);
        logger.info(`Deleting ${accountsToDelete.length} accounts...`);

        // Execute add, update, and delete operations concurrently using Promise.allSettled
        // to ensure all operations attempt to complete regardless of individual failures.
        const results = await Promise.allSettled([
            apiClient.addCrawledAccounts(accountsToAdd),
            apiClient.updateCrawledAccounts(accountsToUpdate),
            apiClient.deleteAccounts(accountsToDelete.map(x => x.accountId))
        ]);

        // Log any errors from rejected promises.
        results.filter(x => x.status === 'rejected').forEach(res => {
            logger.error('Error', {reason: {message: res.reason.message, stack: res.reason.stack}});
        });
    } else {
        // If not using organizations, simply update all accounts.
        logger.info(`Updating ${accountsWithMetadata.length} accounts...`);
        return apiClient.updateCrawledAccounts(accountsWithMetadata);
    }
});

/**
 * Curried function to process persistence failures and reconcile the list of resources.
 * Resources that failed to be stored are removed from the list, and resources that failed
 * to be deleted are re-added (restored) from the database's previous state.
 * @param {Map<string, object>} dbResourcesMap - A map of existing database resources (used for restoring failed deletes).
 * @param {Array<object>} resources - The current list of discovered resources.
 * @param {object} persistenceFailures - An object containing lists of `failedDeletes` and `failedStores`.
 * @returns {Array<object>} The reconciled list of resources after accounting for persistence failures.
 */
export const processPersistenceFailures = R.curry((dbResourcesMap, resources, {failedDeletes, failedStores}) => {
    // Create a mutable map from the current list of resources.
    const resourceMap = new Map(resources.map(x => [x.id, x]));
    // Remove resources that failed to be stored.
    failedStores.forEach(id => resourceMap.delete(id));
    // For resources that failed to be deleted, re-add them from the database's previous state.
    failedDeletes.forEach(id => resourceMap.set(id, dbResourcesMap.get(id)));
    // Return the reconciled list of resources.
    return Array.from(resourceMap.values());
});
