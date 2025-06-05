// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module orchestrates the entire resource discovery process.
 * It coordinates the fetching of AWS Config resources, enriching them with
 * additional data from AWS SDK calls, identifying changes (deltas), and
 * persisting the updated resource and relationship information to the database.
 */

import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import logger from './logger.mjs'; // Imports the logging utility.
import {initialise} from './initialisation.mjs'; // Imports the initialization function for API clients.
import getAllConfigResources from './aggregator/getAllConfigResources.mjs'; // Imports function to get resources from AWS Config aggregator.
import {getAllSdkResources} from './sdkResources/index.mjs'; // Imports function to get additional resources via AWS SDK calls.
import {addAdditionalRelationships} from './additionalRelationships/index.mjs'; // Imports function to add custom relationships between resources.
import createResourceAndRelationshipDeltas from './createResourceAndRelationshipDeltas.mjs'; // Imports function to compute deltas between current and discovered resources.
import {createSaveObject, createResourcesRegionMetadata} from './persistence/transformers.mjs'; // Imports transformers for preparing data for persistence.
import {persistResourcesAndRelationships, persistAccounts, processPersistenceFailures} from './persistence/index.mjs'; // Imports persistence functions for saving data to the database.
import {GLOBAL, RESOURCE_NOT_RECORDED} from "./constants.mjs"; // Imports constants like GLOBAL region and resource status.

/**
 * Curried function to determine if a resource should be discovered.
 * A resource is discovered if:
 * 1. Its `configurationItemStatus` is not `RESOURCE_NOT_RECORDED`.
 * 2. Its `accountId` exists in the `accountsMap` (meaning the account is active and deployed).
 * 3. Its `awsRegion` is `GLOBAL` or is included in the list of regions associated with its account.
 * Resources from removed accounts/regions might linger in the Config aggregator, so they are filtered out.
 * @param {Map<string, object>} accountsMap - A map of active account IDs to their details, including regions.
 * @param {object} resource - The resource object from AWS Config.
 * @returns {boolean} True if the resource should be discovered, false otherwise.
 */
const shouldDiscoverResource = R.curry((accountsMap, resource) => {
    const {accountId, awsRegion, configurationItemStatus} = resource;

    // Exclude resources that are marked as not recorded in Config.
    if(configurationItemStatus === RESOURCE_NOT_RECORDED) {
        return false;
    }
    // Resources from removed accounts/regions can take a while to be deleted from the Config aggregator.
    // Ensure the account is still active and the region is valid for that account.
    const regions = accountsMap.get(accountId)?.regions ?? [];
    return (accountsMap.has(accountId) && awsRegion === GLOBAL) || regions.includes(awsRegion);
});

/**
 * Orchestrates the end-to-end resource discovery process.
 * This function performs the following steps:
 * 1. Initializes API clients (AppSync and Config Service).
 * 2. Fetches active accounts from the API.
 * 3. Retrieves existing relationships and resources from the database.
 * 4. Fetches all resources from the AWS Config aggregator.
 * 5. Filters Config resources based on active accounts and regions.
 * 6. Enriches filtered resources with additional data obtained via direct AWS SDK calls.
 * 7. Adds custom, inferred relationships between resources.
 * 8. Transforms resources into a format suitable for persistence.
 * 9. Calculates deltas (additions, modifications, deletions) between discovered and existing resources/relationships.
 * 10. Persists the resource and relationship deltas to the database.
 * 11. Processes any failures encountered during persistence.
 * 12. Creates and persists region metadata for discovered resources.
 * 13. Persists updated account information.
 * @param {object} appSync - The AppSync client instance.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {object} config - The application configuration object.
 * @returns {Promise<void>} A promise that resolves when the discovery process is complete.
 */
export async function discoverResources(appSync, awsClient, config) {
    logger.info('Beginning discovery of resources');

    // Step 1: Initialize API clients.
    const {apiClient, configServiceClient} = await initialise(awsClient, appSync, config);

    // Step 2: Fetch active accounts from the API.
    const accounts = await apiClient.getAccounts();

    // Step 3: Fetch existing database relationships and resources in parallel.
    // Also, fetch all resources from the AWS Config aggregator.
    const [dbLinksMap, dbResourcesMap, configResources] = await Promise.all([
        apiClient.getDbRelationshipsMap(), // Existing relationships in the database.
        apiClient.getDbResourcesMap(accounts), // Existing resources in the database.
        getAllConfigResources(configServiceClient, config.configAggregator) // Resources from AWS Config.
    ]);

    // Create a map of active accounts, filtering out deleted or non-deployed accounts,
    // and transforming region names for easier lookup.
    const accountsMap = new Map(accounts
        .filter(x => x.isIamRoleDeployed && !x.toDelete)
        .map(account => [account.accountId, R.evolve({regions: R.map(x => x.name)}, account)])
    );

    // Step 4-8: Process Config resources: filter, enrich with SDK data, add relationships, and transform for saving.
    const resources = await Promise.resolve(configResources)
        .then(R.filter(shouldDiscoverResource(accountsMap))) // Filter resources based on active accounts and regions.
        .then(getAllSdkResources(accountsMap, awsClient)) // Enrich resources with data from direct AWS SDK calls.
        .then(addAdditionalRelationships(accountsMap, awsClient)) // Add custom relationships.
        .then(R.map(createSaveObject)); // Transform resources into a format suitable for persistence.

    // Step 9-13: Calculate deltas and persist changes to the database.
    return Promise.resolve(resources)
        .then(createResourceAndRelationshipDeltas(dbResourcesMap, dbLinksMap)) // Calculate deltas.
        .then(persistResourcesAndRelationships(apiClient)) // Persist resource and relationship changes.
        .then(processPersistenceFailures(dbResourcesMap, resources)) // Handle any persistence failures.
        .then(createResourcesRegionMetadata) // Create metadata for resources by region.
        .then(persistAccounts(config, apiClient, accounts)); // Persist updated account information.
}
