// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module is responsible for enriching AWS resources discovered by AWS Config
 * with additional, more detailed information obtained through direct AWS SDK calls.
 * It orchestrates different tiers of SDK data retrieval (batch, first-order, second-order)
 * to manage dependencies and concurrency, and also handles the creation of tag resources.
 */

import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import {PromisePool} from '@supercharge/promise-pool'; // Imports PromisePool for concurrent promise execution.
import {
    createArn,
    createConfigObject
} from '../utils.mjs'; // Imports utility functions for ARN creation and creating standardized config objects.
import {
    AWS_TAGS_TAG,
    GLOBAL,
    NOT_APPLICABLE,
    TAG,
    TAGS,
    IS_ASSOCIATED_WITH
} from '../constants.mjs'; // Imports constants related to tags, global region, and relationship types.
import logger from '../logger.mjs'; // Imports the logging utility.
import createAllBatchResources from './createAllBatchResources.mjs'; // Imports function to create resources from batch SDK calls.
import {createFirstOrderHandlers} from './firstOrderHandlers.mjs'; // Imports factory for first-order SDK handlers.
import {createSecondOrderHandlers} from './secondOrderHandlers.mjs'; // Imports factory for second-order SDK handlers.

/**
 * Creates a standardized `AWS::Tags::Tag` resource object.
 * This function transforms a simple key-value tag into a full resource object
 * that can be stored in the database.
 * @param {string} accountId - The AWS account ID where the tag originates.
 * @param {object} tag - The tag object with `key` and `value` properties.
 * @returns {object} A standardized tag resource object.
 */
const createTag = R.curry((accountId, {key, value}) => {
    const resourceName = `${key}=${value}`; // Format tag name as "key=value".
    // Create an ARN for the tag resource.
    const arn = createArn({
        service: TAGS, accountId, resource: `${TAG}/${resourceName}`
    });
    // Create a standardized config object for the tag resource.
    return createConfigObject({
        arn,
        accountId,
        awsRegion: GLOBAL, // Tags are considered global resources.
        availabilityZone: NOT_APPLICABLE,
        resourceType: AWS_TAGS_TAG,
        resourceId: arn, // Use ARN as resource ID for tags.
        resourceName
    }, {}); // Empty configuration as tags are simple.
});

/**
 * Processes a list of resources to extract their tags and create new `AWS::Tags::Tag` resources.
 * It also establishes 'Is associated with' relationships between the original resources and their tags.
 * This function ensures that each unique tag (key=value pair) is represented as a single resource.
 * @param {Array<object>} resources - An array of discovered resource objects.
 * @returns {Array<object>} An array of newly created `AWS::Tags::Tag` resource objects.
 */
function createTags(resources) {
    // Use a Map to store unique tags, keyed by their ARN, to avoid duplicates.
    const resourceMap = resources.reduce((acc, {accountId, awsRegion, resourceId, resourceName, resourceType, tags = []}) => {
        tags
            .map(createTag(accountId)) // Transform each tag into a tag resource object.
            .forEach(tag => {
                const {id, relationships} = tag;
                if (!acc.has(id)) {
                    // If this is the first time seeing this tag, add the relationship to the current resource.
                    relationships.push({
                        relationshipName: IS_ASSOCIATED_WITH,
                        resourceId,
                        resourceName,
                        resourceType,
                        awsRegion
                    })
                    acc.set(id, tag); // Store the new tag resource.
                } else {
                    // If the tag already exists, just add the relationship to the current resource.
                    acc.get(id).relationships.push({
                        relationshipName: IS_ASSOCIATED_WITH,
                        resourceId,
                        resourceName,
                        resourceType,
                        awsRegion
                    });
                }
            })
        return acc;
    }, new Map());

    return Array.from(resourceMap.values()); // Return all unique tag resources.
}

/**
 * Main function to get all additional resources and relationships via AWS SDK calls.
 * It orchestrates the fetching of data in multiple stages:
 * 1. **Batch Resources**: Fetches resources that can be retrieved in large batches across accounts/regions.
 * 2. **First-Order Handlers**: Processes resources that require individual SDK calls, but whose data
 *    does not depend on other SDK-enriched resources.
 * 3. **Second-Order Handlers**: Processes resources whose data depends on resources enriched by first-order handlers.
 * 4. **Tag Resources**: Creates `AWS::Tags::Tag` resources from existing resource tags.
 * @param {Map<string, object>} accountsMap - A map of active account IDs to their details.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {Array<object>} resources - An initial array of resources (typically from AWS Config).
 * @returns {Promise<Array<object>>} A promise that resolves to the enriched array of resources, including new SDK-discovered resources and tags.
 */
export const getAllSdkResources = R.curry(async (accountsMap, awsClient, resources) => {
    logger.profile('Time to get all resources from AWS SDK'); // Start profiling.
    const resourcesCopy = [...resources]; // Create a mutable copy of the resources array.

    const credentialsTuples = Array.from(accountsMap.entries()); // Get account credentials for SDK calls.

    // Step 1: Fetch resources that can be retrieved in batches.
    const batchResources = await createAllBatchResources(credentialsTuples, awsClient);
    batchResources.forEach(resource => resourcesCopy.push(resource)); // Add batch resources to the main list.

    // Step 2: Create first-order SDK handlers. These handlers enrich resources
    // without depending on other SDK-enriched data.
    const firstOrderHandlers = createFirstOrderHandlers(accountsMap, awsClient);
    const firstOrderResourceTypes = new Set(R.keys(firstOrderHandlers)); // Get resource types handled by first-order.

    // Process resources with first-order handlers concurrently.
    const {results: firstResults, errors: firstErrors} = await PromisePool
        .withConcurrency(15) // Limits concurrency for first-order handlers.
        .for(resourcesCopy.filter(({resourceType}) => firstOrderResourceTypes.has(resourceType)))
        .process(async resource => {
            const handler = firstOrderHandlers[resource.resourceType];
            return handler(resource); // Execute the handler for the resource.
        });

    logger.error(`There were ${firstErrors.length} errors when adding first order SDK resources.`);
    logger.debug('Errors: ', {firstErrors});
    firstResults.flat().forEach(resource => resourcesCopy.push(resource) ); // Add results from first-order handlers.

    // Step 3: Create second-order SDK handlers. These handlers enrich resources
    // that may depend on data added by first-order handlers.
    const secondOrderHandlers = createSecondOrderHandlers(accountsMap, awsClient);
    const secondOrderResourceTypes = new Set(R.keys(secondOrderHandlers)); // Get resource types handled by second-order.

    // Process resources with second-order handlers concurrently.
    const {results: secondResults, errors: secondErrors} = await PromisePool
        .withConcurrency(10) // Limits concurrency for second-order handlers.
        .for(firstResults.flat().filter(({resourceType}) => secondOrderResourceTypes.has(resourceType)))
        .process(async resource => {
            const handler = secondOrderHandlers[resource.resourceType];
            return handler(resource); // Execute the handler for the resource.
        });

    logger.error(`There were ${secondErrors.length} errors when adding second order SDK resources.`);
    logger.debug('Errors: ', {secondErrors});
    secondResults.flat().forEach(resource => resourcesCopy.push(resource)); // Add results from second-order handlers.

    // Step 4: Create `AWS::Tags::Tag` resources from existing resource tags.
    const tags = createTags(resourcesCopy);
    tags.forEach(tag => resourcesCopy.push(tag)) // Add tag resources to the main list.

    logger.profile('Time to get all resources from AWS SDK'); // End profiling.

    return resourcesCopy; // Return the fully enriched list of resources.
});
