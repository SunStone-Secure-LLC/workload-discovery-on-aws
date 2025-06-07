import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import {iterate} from 'iterare'; // Imports `iterare` for iterable-based operations.
import addBatchedRelationships from './addBatchedRelationships.mjs'; // Imports function to add relationships in batches.
import addIndividualRelationships from './addIndividualRelationships.mjs'; // Imports function to add individual relationships.
import createLookUpMaps from './createLookUpMaps.mjs'; // Imports function to create lookup maps for resources.
import {
    EC2,
    AWS_EC2_SUBNET,
    AWS_TAGS_TAG,
    AWS_CLOUDFORMATION_STACK,
    AWS_CONFIG_RESOURCE_COMPLIANCE,
    AWS_EC2_VPC,
    VPC,
    CONTAINS
} from '../constants.mjs'; // Imports various constants, including AWS resource types and relationship names.
import {
    createArn,
    createContainedInVpcRelationship,
    resourceTypesToNormalizeSet,
    isQualifiedRelationshipName
} from '../utils.mjs'; // Imports utility functions for ARN creation, VPC relationship, and relationship name qualification.

/**
 * Extracts VPC ID and aggregated availability zones from a list of subnet IDs.
 * It looks up each subnet in the `resourceMap` to get its configuration details.
 * @param {Map<string, object>} resourceMap - A map of resource ARNs to resource objects.
 * @param {string} accountId - The AWS account ID of the subnets.
 * @param {string} awsRegion - The AWS region of the subnets.
 * @param {Array<string>} subnetIds - An array of subnet IDs.
 * @returns {object} An object containing the `vpcId` and a sorted array of `availabilityZones`.
 */
function getSubnetInfo(resourceMap, accountId, awsRegion, subnetIds) {
    const {availabilityZones, vpcId} = subnetIds.reduce((acc, subnetId) => {
        // Construct the ARN for the subnet to look it up in the resource map.
        const subnetArn = createArn({service: EC2, accountId, region: awsRegion, resource: `subnet/${subnetId}`});

        // Check if the subnet has been ingested into the resource map.
        if(resourceMap.has(subnetArn)) {
            const {configuration: {vpcId}, availabilityZone} = resourceMap.get(subnetArn);
            // Set VPC ID if not already set (assuming all subnets in a list belong to the same VPC).
            if(acc.vpcId == null) acc.vpcId = vpcId;
            acc.availabilityZones.add(availabilityZone); // Add availability zone to a Set to ensure uniqueness.
        }

        return acc;
    }, {availabilityZones: new Set()}); // Initialize accumulator with an empty Set for availability zones.

    return {vpcId, availabilityZones: Array.from(availabilityZones).sort()} // Convert Set to sorted Array.
}

/**
 * Determines if a relationship's name should be normalized.
 * A relationship name is normalized if its `resourceType` is in `resourceTypesToNormalizeSet`
 * and its `relationshipName` is not already qualified (e.g., 'Is contained in Subnet').
 * @param {object} rel - The relationship object.
 * @returns {boolean} True if the relationship name should be normalized, false otherwise.
 */
function shouldNormaliseRelationship(rel) {
    return  resourceTypesToNormalizeSet.has(rel.resourceType) && !isQualifiedRelationshipName(rel.relationshipName);
}

/**
 * Normalizes relationship names to ensure consistency across all resource types.
 * AWS Config sometimes qualifies relationship names (e.g., `Is contained in Subnet` for EC2 instances),
 * but not always (e.g., `Is contained in ` for Lambda functions). This function
 * appends the resource type suffix (e.g., 'Subnet', 'VPC') to unqualified relationship names
 * for specific resource types, making them consistent.
 * @param {object} resource - The resource object whose relationships are to be normalized.
 * @returns {object} The resource object with normalized relationship names.
 */
function normaliseRelationshipNames(resource) {
    // Skip normalization for AWS::Tags::Tag and AWS::Config::ResourceCompliance resource types.
    if (![AWS_TAGS_TAG, AWS_CONFIG_RESOURCE_COMPLIANCE].includes(resource.resourceType)) {
        const {relationships} = resource;

        // Iterate through relationships and filter for those that need normalization.
        iterate(relationships)
            .filter(shouldNormaliseRelationship)
            .forEach(rel => {
                const {resourceType, relationshipName} = rel;

                // Extract the suffix from the resource type (e.g., 'VPC', 'Subnet').
                const [,, relSuffix] = resourceType.split('::');
                // Check if the relationship name already contains the suffix (case-insensitive).
                // If not, append the suffix. Special handling for VPC as it's camelCase.
                if(!relationshipName.toLowerCase().includes(relSuffix.toLowerCase())) {
                    rel.relationshipName = relationshipName + (resourceType === AWS_EC2_VPC ? VPC : relSuffix);
                }
            });
    }

    return resource;
}

/**
 * Adds VPC ID, subnet ID, and availability zone information to a resource based on its relationships.
 * It looks for existing VPC and Subnet relationships and enriches the resource's properties.
 * If a resource is in a subnet but doesn't have a VPC relationship, it infers and adds one.
 * @param {Map<string, object>} resourceMap - A map of resource ARNs to resource objects.
 * @param {object} resource - The resource object to enrich.
 * @returns {object} The enriched resource object.
 */
const addVpcInfo = R.curry((resourceMap, resource) => {
    // Skip for specific resource types that don't typically have VPC info.
    if (![AWS_TAGS_TAG, AWS_CONFIG_RESOURCE_COMPLIANCE, AWS_CLOUDFORMATION_STACK].includes(resource.resourceType)) {
        const {accountId, awsRegion, relationships} = resource;

        // Extract VPC IDs from existing VPC relationships.
        const vpcArray = relationships
            .filter(x => x.resourceType === AWS_EC2_VPC)
            .map(x => x.resourceId);

        // Extract subnet IDs from existing Subnet relationships, excluding 'Contains' relationships.
        const subnetIds = relationships
            .filter(x => x.resourceType === AWS_EC2_SUBNET && !x.relationshipName.includes(CONTAINS))
            .map(x => x.resourceId)
            .sort();

        // If a VPC is found, set the resource's vpcId property.
        if (!R.isEmpty(vpcArray)) {
            resource.vpcId = R.head(vpcArray);
        }

        // If subnet IDs are present, get their VPC and availability zone info.
        if(!R.isEmpty(subnetIds)) {
            const {vpcId, availabilityZones} = getSubnetInfo(resourceMap, accountId, awsRegion, subnetIds);
            // If no VPC relationship exists but a VPC ID is inferred from subnets, add the relationship.
            if(R.isEmpty(vpcArray) && vpcId != null) {
                relationships.push(createContainedInVpcRelationship(vpcId));
                resource.vpcId = vpcId;
            }
            // If availability zones are found, set the resource's availabilityZone property.
            if(!R.isEmpty(availabilityZones)) {
                resource.availabilityZone = availabilityZones.join(',');
            }
        }

        // If only one subnet ID is present, set the resource's subnetId property.
        if (subnetIds.length === 1) {
            resource.subnetId = R.head(subnetIds);
        }
    }

    return resource;
})

/**
 * Main entry point for adding additional relationships and enriching resource data.
 * This function orchestrates the following steps:
 * 1. Creates lookup maps for efficient resource access.
 * 2. Adds batched relationships (e.g., from ENIs to instances).
 * 3. Adds individual relationships (e.g., from Lambda functions to event sources).
 * 4. Normalizes relationship names for consistency.
 * 5. Adds VPC and subnet-related information to resources.
 * Note: For performance reasons, this function mutates the items in the `resources` array directly.
 * @param {Map<string, object>} accountsMap - A map of active account IDs to their details.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {Array<object>} resources - An array of resource objects to be enriched.
 * @returns {Promise<Array<object>>} A promise that resolves to the array of enriched resource objects.
 */
export const addAdditionalRelationships =  R.curry(async (accountsMap, awsClient, resources) =>  {
    // Create a map of resources for quick lookup by ARN/ID.
    const resourceMap = new Map(resources.map(resource => ([resource.id, resource])));

    // Create various lookup maps needed for relationship inference.
    const lookUpMaps = {
        accountsMap,
        ...createLookUpMaps(resources),
        resourceMap
    };

    // Add relationships that can be processed in batches.
    await addBatchedRelationships(lookUpMaps, awsClient);

    // Add relationships that need to be processed individually.
    await addIndividualRelationships(lookUpMaps, awsClient, resources)

    // Apply VPC info and normalize relationship names to each resource.
    return resources
        .map(R.compose(addVpcInfo(resourceMap), normaliseRelationshipNames));
})
