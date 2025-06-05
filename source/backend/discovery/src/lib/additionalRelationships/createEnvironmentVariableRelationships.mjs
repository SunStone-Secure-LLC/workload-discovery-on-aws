import {createAssociatedRelationship, createResourceIdKey, createResourceNameKey} from '../utils.mjs'; // Imports utility functions for creating relationships and resource keys.
import {AWS_S3_ACCOUNT_PUBLIC_ACCESS_BLOCK} from '../constants.mjs'; // Imports constant for S3 Account Public Access Block resource type.

/**
 * Infers and creates relationships from environment variable values to other discovered resources.
 * This function iterates through the values of environment variables and attempts to match them
 * with existing resources in the `resourceMap` or through various lookup maps.
 * It creates an 'Is associated with' relationship for each successful match.
 * @param {object} lookUpMaps - An object containing various lookup maps:
 *   - `resourceMap`: A map of resource ARNs/IDs to resource objects.
 *   - `envVarResourceIdentifierToIdMap`: A map for environment variable identifiers to resource IDs.
 *   - `endpointToIdMap`: A map for endpoint identifiers to resource IDs.
 * @param {object} accountInfo - An object containing `accountId` and `awsRegion` of the resource owning the environment variables.
 * @param {object} variables - An object where keys are environment variable names and values are their string values.
 * @returns {Array<object>} An array of inferred relationship objects.
 */
function createEnvironmentVariableRelationships(
    {resourceMap, envVarResourceIdentifierToIdMap, endpointToIdMap},
    {accountId, awsRegion},
    variables
) {
    // TODO: add env var name as a property of the edge (relationship).
    return Object.values(variables).reduce((acc, val) => {
        // First, check if the environment variable value directly corresponds to an existing resource ARN.
        if (resourceMap.has(val)) {
            const {resourceType, arn} = resourceMap.get(val);
            acc.push(createAssociatedRelationship(resourceType, {arn}));
        } else {
            // If not a direct ARN, attempt to resolve the value as a resource ID or name.
            // This branch assumes all resources are in the same region for key creation.
            const resourceIdKey = createResourceIdKey({resourceId: val, accountId, awsRegion});
            const resourceNameKey = createResourceNameKey({resourceName: val, accountId, awsRegion});

            // Try to find a matching resource ID using various lookup maps.
            const id = envVarResourceIdentifierToIdMap.get(resourceIdKey)
                ?? envVarResourceIdentifierToIdMap.get(resourceNameKey)
                ?? endpointToIdMap.get(val);

            // If a matching resource is found through lookup maps.
            if(resourceMap.has(id)) {
                const {resourceType, resourceId} = resourceMap.get(id);

                // The resourceId of the AWS::S3::AccountPublicAccessBlock resource type is the accountId where it resides.
                // We need to filter out environment variables that have AWS account IDs because otherwise we will create
                // an erroneous relationship between the resource and the AWS::S3::AccountPublicAccessBlock.
                if(resourceId !== accountId && resourceType !== AWS_S3_ACCOUNT_PUBLIC_ACCESS_BLOCK) {
                    acc.push(createAssociatedRelationship(resourceType, {arn: id}));
                }
            }
        }
        return acc;
    }, []);
}

export default createEnvironmentVariableRelationships;
