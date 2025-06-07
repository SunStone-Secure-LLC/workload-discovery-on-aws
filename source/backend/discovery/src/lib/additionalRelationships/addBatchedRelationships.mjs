import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import createEnvironmentVariableRelationships from './createEnvironmentVariableRelationships.mjs'; // Imports function to create relationships from environment variables.
import logger from '../logger.mjs'; // Imports the logging utility.
import {
    safeForEach,
    createAssociatedRelationship,
    createArn,
    createAttachedRelationship
} from '../utils.mjs'; // Imports utility functions for safe iteration, relationship creation, and ARN creation.
import {
    VPC,
    EC2,
    TRANSIT_GATEWAY_ATTACHMENT,
    AWS_EC2_TRANSIT_GATEWAY,
    AWS_EC2_VPC,
    AWS_EC2_SUBNET,
    FULFILLED,
    SUBNET
} from '../constants.mjs'; // Imports various constants, including AWS resource types and relationship names.

/**
 * Creates a collection of asynchronous handler functions, each responsible for discovering
 * and adding a specific type of batched relationship across accounts and regions.
 * These handlers leverage AWS SDK clients to fetch data and then create relationships
 * between existing resources in the `resourceMap`.
 * @param {object} lookUpMaps - An object containing various lookup maps (e.g., `resourceMap`, `accountsMap`).
 * @param {object} awsClient - The AWS client factory instance.
 * @returns {object} An object where keys are relationship types and values are async handler functions.
 */
function createBatchedHandlers(lookUpMaps, awsClient) {
    const {
        envVarResourceIdentifierToIdMap, // Map for environment variable resource identifiers to IDs.
        endpointToIdMap, // Map for endpoint identifiers to IDs.
        resourceMap // Map of all discovered resources by ARN/ID.
    } = lookUpMaps;

    return {
        /**
         * Discovers and adds relationships between Lambda functions and their event sources.
         * It fetches all event source mappings and creates an 'Associated with' relationship
         * if both the event source and the Lambda function are present in the `resourceMap`.
         * @param {object} credentials - AWS credentials for the Lambda client.
         * @param {string} accountId - The AWS account ID.
         * @param {string} region - The AWS region.
         * @returns {Promise<object>} An object containing any errors encountered.
         */
        eventSources: async (credentials, accountId, region) => {
            const lambdaClient = awsClient.createLambdaClient(credentials, region);
            const eventSourceMappings = await lambdaClient.listEventSourceMappings();

            return safeForEach(({EventSourceArn, FunctionArn}) => {
                // Ensure both the event source and the Lambda function exist in the resource map.
                if(resourceMap.has(EventSourceArn) && resourceMap.has(FunctionArn)) {
                    const {resourceType} = resourceMap.get(EventSourceArn);
                    const lambda = resourceMap.get(FunctionArn);

                    // Add an 'Is associated with' relationship from the Lambda to its event source.
                    lambda.relationships.push(createAssociatedRelationship(resourceType, {
                        arn: EventSourceArn
                    }));
                }
            }, eventSourceMappings);
        },
        /**
         * Discovers and adds relationships based on Lambda function environment variables.
         * It fetches all Lambda functions and, for each function with environment variables,
         * creates relationships to other resources identified by those variables.
         * @param {object} credentials - AWS credentials for the Lambda client.
         * @param {string} accountId - The AWS account ID.
         * @param {string} region - The AWS region.
         * @returns {Promise<object>} An object containing any errors encountered.
         */
        functions: async (credentials, accountId, region) => {
            const lambdaClient = awsClient.createLambdaClient(credentials, region);

            const lambdas = await lambdaClient.getAllFunctions();

            return safeForEach(({FunctionArn, Environment}) => {
                const lambda = resourceMap.get(FunctionArn);
                // Environment can be null (not undefined) which means default function parameters can't be used.
                const environment = Environment ?? {};
                // A lambda may have been created between the time we got the data from config
                // and made our API request.
                if(lambda != null && !R.isEmpty(environment)) {
                    // The Lambda API returns an error object if there are encrypted environment variables
                    // that the discovery process does not have permissions to decrypt.
                    if(R.isNil(environment.Error)) {
                        // Creates relationships from environment variables to other resources.
                        // TODO: add env var name as a property of the edge
                        lambda.relationships.push(...createEnvironmentVariableRelationships(
                            {resourceMap, envVarResourceIdentifierToIdMap, endpointToIdMap},
                            {accountId, awsRegion: region},
                            environment.Variables));
                    }
                }
            }, lambdas);
        },
        /**
         * Discovers and adds relationships between SNS topics and their subscriptions.
         * It fetches all SNS subscriptions and creates an 'Associated with' relationship
         * if both the SNS topic and the subscription endpoint are present in the `resourceMap`.
         * @param {object} credentials - AWS credentials for the SNS client.
         * @param {string} accountId - The AWS account ID.
         * @param {string} region - The AWS region.
         * @returns {Promise<object>} An object containing any errors encountered.
         */
        snsSubscriptions: async (credentials, accountId, region) => {
            const snsClient = awsClient.createSnsClient(credentials, region);

            const subscriptions = await snsClient.getAllSubscriptions();

            return safeForEach(({Endpoint, TopicArn}) => {
                // An SNS topic or its endpoint may have been created between the time we got the data from config
                // and made our API request, or the endpoint may have been created in a region that has not been imported.
                if(resourceMap.has(TopicArn) && resourceMap.has(Endpoint)) {
                    const snsTopic = resourceMap.get(TopicArn);
                    const {resourceType} = resourceMap.get(Endpoint);
                    // Add an 'Is associated with' relationship from the SNS topic to its endpoint.
                    snsTopic.relationships.push(createAssociatedRelationship(resourceType, {arn: Endpoint}));
                }
            }, subscriptions);
        },
        /**
         * Discovers and adds relationships for Transit Gateway VPC Attachments.
         * AWS Config's `AWS::EC2::TransitGatewayAttachment` resource type often lacks
         * information about the account where the attached VPCs are deployed. This handler
         * supplements that information using the EC2 API and creates detailed relationships.
         * @param {object} credentials - AWS credentials for the EC2 client.
         * @param {string} accountId - The AWS account ID.
         * @param {string} region - The AWS region.
         * @returns {Promise<object>} An object containing any errors encountered.
         */
        transitGatewayVpcAttachments: async (credentials, accountId, region) => {
            const ec2Client = awsClient.createEc2Client(credentials, region);

            // Fetch Transit Gateway attachments, filtering for VPC attachments.
            const tgwAttachments = await ec2Client.getAllTransitGatewayAttachments([
                {Name: 'resource-type', Values: [VPC.toLowerCase()]}
            ]);

            return safeForEach(tgwAttachment => {
                const {
                    TransitGatewayAttachmentId, ResourceOwnerId, TransitGatewayOwnerId, TransitGatewayId
                } = tgwAttachment;
                // Construct the ARN for the Transit Gateway Attachment.
                const tgwAttachmentArn = createArn({
                    service: EC2, region, accountId, resource: `${TRANSIT_GATEWAY_ATTACHMENT}/${TransitGatewayAttachmentId}`}
                );

                // If the Transit Gateway Attachment exists in the resource map (from Config).
                if(resourceMap.has(tgwAttachmentArn)) {
                    const tgwAttachmentFromConfig = resourceMap.get(tgwAttachmentArn);
                    const {relationships, configuration: {SubnetIds, VpcId}} =  tgwAttachmentFromConfig;

                    // Add relationships:
                    // 1. 'Is attached to' the Transit Gateway itself.
                    // 2. 'Is associated with' the attached VPC.
                    // 3. 'Is associated with' each attached Subnet.
                    relationships.push(
                        createAttachedRelationship(AWS_EC2_TRANSIT_GATEWAY, {accountId: TransitGatewayOwnerId, awsRegion: region, resourceId: TransitGatewayId}),
                        createAssociatedRelationship(AWS_EC2_VPC, {relNameSuffix: VPC, accountId: ResourceOwnerId, awsRegion: region, resourceId: VpcId}),
                        ...SubnetIds.map(subnetId => createAssociatedRelationship(AWS_EC2_SUBNET, {relNameSuffix: SUBNET, accountId: ResourceOwnerId, awsRegion: region, resourceId: subnetId}))
                    );
                }
            }, tgwAttachments);
        }
    }
}

/**
 * Logs errors from the results of `Promise.allSettled`.
 * It flattens the errors from fulfilled promises (which contain `safeForEach` errors)
 * and rejected promises, then logs a summary and detailed errors.
 * @param {Array<object>} results - An array of results from `Promise.allSettled`.
 */
function logErrors(results) {
    const errors = results.flatMap(({status, value, reason}) => {
        if(status === FULFILLED) {
            return value.errors; // Extract errors from successfully fulfilled promises.
        } else {
            return [{error: reason}] // Extract reason from rejected promises.
        }
    });

    logger.error(`There were ${errors.length} errors when adding batch additional relationships.`);
    logger.debug('Errors: ', {errors: errors});
}

/**
 * Orchestrates the addition of batched relationships to resources.
 * It iterates through all active accounts and their regions, executing each
 * batched relationship handler for each account/region combination.
 * It uses `Promise.allSettled` to allow all handlers to complete regardless of individual failures.
 * @param {object} lookUpMaps - An object containing various lookup maps, especially `accountsMap`.
 * @param {object} awsClient - The AWS client factory instance.
 * @returns {Promise<void>} A promise that resolves when all batched relationships have been processed.
 */
async function addBatchedRelationships(lookUpMaps, awsClient) {
    // Convert the accounts map into an array of [accountId, accountObject] tuples.
    const credentialsTuples = Array.from(lookUpMaps.accountsMap.entries());

    // Create the collection of batched relationship handler functions.
    const batchedHandlers = createBatchedHandlers(lookUpMaps, awsClient);

    // Execute all batched handlers for all accounts and their regions concurrently.
    // `Promise.allSettled` is used to ensure all promises run to completion,
    // regardless of whether they fulfill or reject, allowing for comprehensive error logging.
    const results = await Promise.allSettled(Object.values(batchedHandlers).flatMap(handler => {
        return credentialsTuples
            .flatMap( ([accountId, {regions, credentials}]) =>
                // For each account and its regions, call the handler.
                regions.map(region => handler(credentials, accountId, region))
            );
    }));

    // Log any errors encountered during the execution of batched handlers.
    logErrors(results);
}

export default addBatchedRelationships;
