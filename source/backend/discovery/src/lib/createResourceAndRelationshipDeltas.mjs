// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module is responsible for calculating the differences (deltas)
 * between the newly discovered AWS resources and relationships and the existing
 * data stored in the database. It identifies which resources and relationships
 * need to be added, updated, or deleted to synchronize the database with the
 * latest discovered state.
 */

import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import {iterate} from 'iterare'; // Imports `iterare` for iterable-based operations.
import {
    GLOBAL,
    AWS_IAM_AWS_MANAGED_POLICY,
    AWS,
    AWS_IAM_INLINE_POLICY,
    AWS_IAM_USER,
    AWS_IAM_ROLE,
    AWS_IAM_POLICY,
    AWS_IAM_GROUP,
    AWS_TAGS_TAG,
    UNKNOWN
} from './constants.mjs'; // Imports various constants, including global region, IAM resource types, and special resource types.
import {resourceTypesToHash} from './utils.mjs'; // Imports a set of resource types that require hashing for change detection.

/**
 * Creates lookup maps for efficient access to resources.
 * This function is local to this module and helps in quickly finding resources
 * by their ID or a composite key.
 * @param {Array<object>} resources - An array of resource objects.
 * @returns {object} An object containing:
 *   - `resourcesMap`: A map of resource ARNs/IDs to resource objects.
 *   - `resourceIdentifierToIdMap`: A map of composite keys (resource ID/name + type + account + region) to resource ARNs/IDs.
 */
function createLookUpMaps(resources) {
    const resourcesMap = new Map(); // Maps resource ARN/ID to the full resource object.
    const resourceIdentifierToIdMap = new Map(); // Maps a composite key to the resource's ARN/ID.

    for(let resource of resources) {
        const {id, resourceId, resourceType, resourceName, accountId, awsRegion} = resource;

        // Create and store a composite key based on resource name if available.
        if(resourceName != null) {
            resourceIdentifierToIdMap.set(
                createResourceNameKey({resourceType, resourceName, accountId, awsRegion}),
                id);
        }
        // Create and store a composite key based on resource ID.
        resourceIdentifierToIdMap.set(
            createResourceIdKey({resourceType, resourceId, accountId, awsRegion}),
            id);

        // Store the resource itself in the resources map.
        resourcesMap.set(id, resource);
    }

    return {
        resourcesMap,
        resourceIdentifierToIdMap
    }
}

/**
 * Creates a unique key for a resource based on its name, type, account ID, and region.
 * This is a local helper function used within this module for map lookups.
 * @param {object} params - Parameters for key creation.
 * @param {string} params.resourceName - The name of the resource.
 * @param {string} params.resourceType - The type of the resource.
 * @param {string} params.accountId - The account ID of the resource.
 * @param {string} params.awsRegion - The AWS region of the resource.
 * @returns {string} A unique string key.
 */
function createResourceNameKey({resourceName, resourceType, accountId, awsRegion}) {
    return `${resourceType}_${resourceName}_${accountId}_${awsRegion}`;
}

/**
 * Creates a unique key for a resource based on its ID, type, account ID, and region.
 * This is a local helper function used within this module for map lookups.
 * @param {object} params - Parameters for key creation.
 * @param {string} params.resourceId - The ID of the resource.
 * @param {string} params.resourceType - The type of the resource.
 * @param {string} params.accountId - The account ID of the resource.
 * @param {string} params.awsRegion - The AWS region of the resource.
 * @returns {string} A unique string key.
 */
function createResourceIdKey({resourceId, resourceType, accountId, awsRegion}) {
    return `${resourceType}_${resourceId}_${accountId}_${awsRegion}`;
}

// A Set of AWS IAM resource types that are considered global (not region-specific).
const globalResourceTypes = new Set([
    AWS_IAM_INLINE_POLICY,
    AWS_IAM_USER,
    AWS_IAM_ROLE,
    AWS_IAM_POLICY,
    AWS_IAM_GROUP,
    AWS_IAM_AWS_MANAGED_POLICY
]);

/**
 * Checks if a given resource type is considered a global AWS resource type.
 * @param {string} resourceType - The AWS resource type to check.
 * @returns {boolean} True if the resource type is global, false otherwise.
 */
function isGlobalResourceType(resourceType) {
    return globalResourceTypes.has(resourceType);
}

/**
 * Curried function to transform a resource's relationships into standardized link objects.
 * It resolves target resource IDs using lookup maps and assigns appropriate account ID and region
 * for global resources.
 * @param {Map<string, string>} resourceIdentifierToIdMap - Map for resolving resource identifiers to IDs.
 * @param {Map<string, object>} resourcesMap - Map of all discovered resources by ARN/ID.
 * @param {object} resource - The source resource object.
 * @returns {Array<object>} An array of standardized link objects.
 */
const createLinksFromRelationships = R.curry((resourceIdentifierToIdMap, resourcesMap, resource) => {
    const  {id: source, accountId: sourceAccountId, awsRegion: sourceRegion, relationships = []} = resource;

    return relationships.map(({arn, resourceId, resourceType, resourceName, relationshipName, awsRegion: targetRegion, accountId: targetAccountId}) => {
        // Determine the target region: use targetRegion if provided, otherwise GLOBAL for global types, else sourceRegion.
        const awsRegion = targetRegion ?? (isGlobalResourceType(resourceType) ? GLOBAL : sourceRegion);
        // Determine the target account ID: 'aws' for AWS managed policies, otherwise targetAccountId if provided, else sourceAccountId.
        const accountId = resourceType === AWS_IAM_AWS_MANAGED_POLICY ? AWS : (targetAccountId ?? sourceAccountId);

        // Find the target resource's ID using its ARN, resource ID, or resource name.
        const findId = arn ?? (resourceId == null ?
            resourceIdentifierToIdMap.get(createResourceNameKey({resourceType, resourceName, accountId, awsRegion})) :
            resourceIdentifierToIdMap.get(createResourceIdKey({resourceType, resourceId, accountId, awsRegion})));
        // Get the target resource object from the resources map, defaulting to UNKNOWN if not found.
        const {id: target} = resourcesMap.get(findId) ?? {id: UNKNOWN};

        return {
            source, // The ID of the source resource.
            target, // The ID of the target resource.
            label: relationshipName.trim().toUpperCase().replace(/ /g, '_') // Normalized relationship label.
        }
    });
});

/**
 * Compares newly discovered links with existing database links to identify additions and deletions.
 * @param {Map<string, object>} configLinks - A map of newly discovered links (composite key to link object).
 * @param {Map<string, object>} dbLinks - A map of existing database links (composite key to link object).
 * @returns {object} An object containing:
 *   - `linksToAdd`: An array of link objects that are new.
 *   - `linksToDelete`: An array of IDs of links that no longer exist.
 */
function getLinkChanges(configLinks, dbLinks) {
    // Identify links that are in the new configuration but not in the database.
    const linksToAdd = iterate(configLinks.values())
        .filter(({source, label, target}) => target !== UNKNOWN && !dbLinks.has(`${source}_${label}_${target}`))
        .toArray();

    // Identify links that are in the database but not in the new configuration.
    const linksToDelete  = iterate(dbLinks.values())
        .filter(({source, label, target}) => target !== UNKNOWN && !configLinks.has(`${source}_${label}_${target}`))
        .map(x => x.id) // Return only the ID for deletion.
        .toArray();

    return {linksToAdd, linksToDelete};
}

/**
 * Creates an update object for a resource, including only the properties that have changed
 * compared to the existing resource in the database.
 * @param {Map<string, object>} dbResourcesMap - A map of existing database resources.
 * @returns {function(object): object} A function that takes a new resource and returns an update object.
 */
function createUpdate(dbResourcesMap) {
    return ({id, md5Hash, properties}) => {
        const {properties: dbProperties} = dbResourcesMap.get(id); // Get existing properties from DB.
        return {
            id,
            md5Hash,
            // Only include properties that have different values compared to the database.
            properties: Object.entries(properties).reduce((acc, [k, v]) => {
                if(dbProperties[k] !== v) acc[k] = v;
                return acc;
            }, {})
        }
    }
}

/**
 * Creates a store object for a new resource, formatting it for persistence.
 * @param {object} resource - The new resource object.
 * @returns {object} A store object with `id`, `md5Hash`, `label`, and `properties`.
 */
function createStore({id, resourceType, md5Hash, properties}) {
    return {
        id,
        md5Hash,
        label: resourceType.replace(/::/g, "_"), // Normalize resource type to a label (e.g., 'AWS_EC2_Instance').
        properties
    }
}

/**
 * Compares newly discovered resources with existing database resources to identify
 * resources to add, update, or delete.
 * @param {Map<string, object>} resourcesMap - A map of newly discovered resources.
 * @param {Map<string, object>} dbResourcesMap - A map of existing database resources.
 * @returns {object} An object containing:
 *   - `resourcesToStore`: An array of new resource objects to be stored.
 *   - `resourceIdsToDelete`: An array of IDs of resources that no longer exist.
 *   - `resourcesToUpdate`: An array of resource update objects.
 */
function getResourceChanges(resourcesMap, dbResourcesMap) {
    const resources = Array.from(resourcesMap.values()); // Convert new resources map to array.
    const dbResources = Array.from(dbResourcesMap.values()); // Convert existing DB resources map to array.

    // Identify resources that are new (not in the database).
    const resourcesToStore = iterate(resources)
        .filter(x => !dbResourcesMap.has(x.id))
        .map(createStore)
        .toArray();

    // Identify resources that exist in both but have changed.
    const resourcesToUpdate = iterate(resources)
        .filter(resource => {
            const {id} = resource;
            if(!dbResourcesMap.has(id)) return false; // Skip if resource is new (handled by `resourcesToStore`).

            const dbResource = dbResourcesMap.get(id);
            // For specific resource types, compare MD5 hashes for changes.
            if(resourceTypesToHash.has(resource.resourceType)) {
                return resource.md5Hash !== dbResource.md5Hash;
            }

            // If `supplementaryConfiguration` was previously null but is now present, consider it a change.
            // This handles cases where older ingested data might be missing this field.
            if(dbResource.properties.supplementaryConfiguration == null && resource.properties.supplementaryConfiguration != null) {
                return true;
            }

            // For other resource types, compare `configurationItemCaptureTime` (unless it's a tag).
            return resource.resourceType !== AWS_TAGS_TAG && resource.properties.configurationItemCaptureTime !== dbResource.properties.configurationItemCaptureTime;
        })
        .map(createUpdate(dbResourcesMap)) // Create update objects for changed resources.
        .toArray();

    // Identify resources that are in the database but no longer discovered (to be deleted).
    const resourceIdsToDelete = iterate(dbResources)
        .filter(x => !resourcesMap.has(x.id))
        .map(x => x.id) // Return only the ID for deletion.
        .toArray();

    return {
        resourcesToStore,
        resourceIdsToDelete,
        resourcesToUpdate
    }
}

/**
 * Calculates the complete set of resource and relationship deltas.
 * This is the main function of this module, orchestrating the comparison
 * between discovered data and existing database data.
 * @param {Map<string, object>} dbResourcesMap - A map of existing database resources.
 * @param {Map<string, object>} dbLinksMap - A map of existing database links.
 * @param {Array<object>} resources - An array of newly discovered resource objects.
 * @returns {object} An object containing all the calculated deltas:
 *   - `resourceIdsToDelete`: IDs of resources to delete.
 *   - `resourcesToStore`: New resources to add.
 *   - `resourcesToUpdate`: Resources to update.
 *   - `linksToAdd`: New links to add.
 *   - `linksToDelete`: IDs of links to delete.
 */
function createResourceAndRelationshipDeltas(dbResourcesMap, dbLinksMap, resources) {
    // Create lookup maps from the newly discovered resources for efficient processing.
    const {resourceIdentifierToIdMap, resourcesMap} = createLookUpMaps(resources);

    // Transform resource relationships into standardized link objects.
    const links = resources.flatMap(createLinksFromRelationships(resourceIdentifierToIdMap, resourcesMap));
    // Create a map of the newly discovered links for efficient comparison.
    const configLinksMap = new Map(links.map(x => [`${x.source}_${x.label}_${x.target}`, x]));

    // Calculate changes for links (additions and deletions).
    const {linksToAdd, linksToDelete} = getLinkChanges(configLinksMap, dbLinksMap);

    // Calculate changes for resources (additions, deletions, and updates).
    const {resourceIdsToDelete, resourcesToStore, resourcesToUpdate} = getResourceChanges(resourcesMap, dbResourcesMap);

    return {
        resourceIdsToDelete, resourcesToStore, resourcesToUpdate,
        linksToAdd, linksToDelete
    }
}

// Exports the main function as a curried function for easier composition.
export default R.curry(createResourceAndRelationshipDeltas);
