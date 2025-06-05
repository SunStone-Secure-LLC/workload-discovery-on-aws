// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module defines "first-order" AWS SDK handlers. These handlers are functions
 * that enrich existing AWS Config resources with additional, more detailed information
 * by making direct AWS SDK calls. They are considered "first-order" because their data
 * retrieval does not depend on other resources that have already been enriched by SDK calls.
 * Each handler is specific to a particular AWS resource type.
 */

import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import {
    AWS_API_GATEWAY_REST_API,
    APIGATEWAY,
    RESTAPIS,
    RESOURCES,
    AWS_API_GATEWAY_RESOURCE,
    AUTHORIZERS,
    AWS_API_GATEWAY_AUTHORIZER,
    AWS_DYNAMODB_STREAM,
    AWS_DYNAMODB_TABLE,
    AWS_ECS_SERVICE,
    AWS_ECS_TASK,
    AWS_EKS_CLUSTER,
    MULTIPLE_AVAILABILITY_ZONES,
    AWS_EKS_NODE_GROUP,
    AWS_IAM_ROLE,
    AWS_IAM_USER,
    INLINE_POLICY,
    IS_ASSOCIATED_WITH,
    GLOBAL,
    NOT_APPLICABLE,
    AWS_IAM_INLINE_POLICY,
    AWS_APPSYNC_DATASOURCE,
    AWS_APPSYNC_GRAPHQLAPI,
    AWS_APPSYNC_RESOLVER
} from '../constants.mjs'; // Imports various constants, including AWS resource types, service names, and relationship types.
import {
    createArn, createConfigObject, createContainedInRelationship, createAssociatedRelationship, createArnRelationship
} from '../utils.mjs'; // Imports utility functions for ARN creation, config object creation, and relationship creation.

/**
 * Curried function to create a standardized inline IAM policy resource object.
 * It takes a base resource (e.g., IAM Role or User) and a raw policy document,
 * then transforms it into a new resource object representing the inline policy.
 * @param {object} baseResourceInfo - Information about the parent resource (arn, resourceName, accountId, resourceType).
 * @param {object} policy - The raw inline policy object from AWS SDK (e.g., `rolePolicyList` item).
 * @returns {object} A standardized inline IAM policy resource object.
 */
const createInlinePolicy = R.curry(({arn, resourceName, accountId, resourceType}, policy) => {
    // Construct the ARN for the inline policy.
    const policyArn = `${arn}/${INLINE_POLICY}/${policy.policyName}`;
    // Parse the policy document (which is URI-encoded JSON).
    const inlinePolicy = {
        policyName: policy.policyName,
        policyDocument: JSON.parse(decodeURIComponent(policy.policyDocument))
    };

    return createConfigObject({
        arn: policyArn,
        accountId: accountId,
        awsRegion: GLOBAL, // Inline policies are considered global resources.
        availabilityZone: NOT_APPLICABLE,
        resourceType: AWS_IAM_INLINE_POLICY,
        resourceId: policyArn,
        resourceName: policyArn,
        relationships: [
            // Create an 'Is associated with' relationship back to the parent resource (Role/User).
            createAssociatedRelationship(resourceType, {resourceName})
        ]
    }, inlinePolicy);
});

/**
 * Factory function that creates a collection of "first-order" AWS SDK handlers.
 * Each handler is an asynchronous function responsible for fetching additional data
 * for a specific AWS resource type and transforming it into new or enriched resource objects.
 * @param {Map<string, object>} accountsMap - A map of active account IDs to their details (including credentials).
 * @param {object} awsClient - The AWS client factory instance.
 * @returns {object} An object where keys are AWS resource types and values are their corresponding handler functions.
 */
export function createFirstOrderHandlers(accountsMap, awsClient) {
    return {
        /**
         * Handler for AWS::ApiGateway::RestApi resources.
         * Discovers and transforms API Gateway Resources and Authorizers associated with the REST API.
         * @param {object} resource - The API Gateway RestApi resource.
         * @returns {Promise<Array<object>>} A promise that resolves to an array of new resource objects (API Gateway Resources and Authorizers).
         */
        [AWS_API_GATEWAY_REST_API]: async ({awsRegion, accountId, availabilityZone, resourceId, configuration}) => {
            const {id: RestApiId} = configuration;
            const {credentials} = accountsMap.get(accountId); // Get credentials for the account.

            const apiGatewayClient = awsClient.createApiGatewayClient(credentials, awsRegion);

            const apiGatewayResources = []

            // Fetch API Gateway Resources.
            const apiResources = await apiGatewayClient.getResources(RestApiId);
            apiGatewayResources.push(...apiResources.map(item => {
                // Construct ARN for the API Gateway Resource.
                const arn = createArn({
                    service: APIGATEWAY,
                    region: awsRegion,
                    resource: `/${RESTAPIS}/${RestApiId}/${RESOURCES}/${item.id}`
                });
                return createConfigObject({
                    arn,
                    accountId,
                    awsRegion,
                    availabilityZone,
                    resourceType: AWS_API_GATEWAY_RESOURCE,
                    resourceId: arn,
                    resourceName: arn,
                    relationships: [
                        // Create 'Is contained in' relationship to the parent REST API.
                        createContainedInRelationship(AWS_API_GATEWAY_REST_API, {resourceId})
                    ]
                }, {RestApiId, ...item});
            }));

            // Fetch API Gateway Authorizers.
            const authorizers = await apiGatewayClient.getAuthorizers(RestApiId);
            apiGatewayResources.push(...authorizers.map(authorizer => {
                // Construct ARN for the API Gateway Authorizer.
                const arn = createArn({
                    service: APIGATEWAY,
                    region: awsRegion,
                    resource: `/${RESTAPIS}/${RestApiId}/${AUTHORIZERS}/${authorizer.id}`
                });
                return createConfigObject({
                    arn,
                    accountId,
                    awsRegion,
                    availabilityZone,
                    resourceType: AWS_API_GATEWAY_AUTHORIZER,
                    resourceId: arn,
                    resourceName: arn,
                    relationships: [
                        // Create 'Is contained in' relationship to the parent REST API.
                        createContainedInRelationship(AWS_API_GATEWAY_REST_API, {resourceId}),
                        // Create 'Is associated with' relationships to provider ARNs (e.g., Lambda authorizers).
                        ...(authorizer.providerARNs ?? []).map(createArnRelationship(IS_ASSOCIATED_WITH))
                    ]
                }, {RestApiId, ...authorizer});
            }));

            return apiGatewayResources;
        },

        /**
         * Handler for AWS::AppSync::GraphQLApi resources.
         * Discovers and transforms AppSync Data Sources and Resolvers associated with the GraphQL API.
         * @param {object} resource - The AppSync GraphQLApi resource.
         * @returns {Promise<Array<object>>} A promise that resolves to an array of new resource objects (Data Sources and Resolvers).
         */
        [AWS_APPSYNC_GRAPHQLAPI]: async ({accountId, awsRegion, resourceId, resourceName}) => {
            const {credentials} = accountsMap.get(accountId);
            const appSyncClient = awsClient.createAppSyncClient(credentials, awsRegion);

            // Fetch AppSync Data Sources.
            const dataSources = appSyncClient.listDataSources(resourceId).then(data => data.map(dataSource => {
                return createConfigObject({
                    arn: dataSource.dataSourceArn,
                    accountId,
                    awsRegion,
                    availabilityZone: NOT_APPLICABLE,
                    resourceType: AWS_APPSYNC_DATASOURCE,
                    resourceId: dataSource.dataSourceArn,
                    resourceName: dataSource.name,
                    relationships: [] // Relationships will be added by other handlers or inferred later.
                }, {...dataSource, apiId: resourceId});
            }))

            // Fetch AppSync Query Resolvers.
            const queryResolvers = appSyncClient.listResolvers(resourceId, "Query").then(data => data.map(resolver => {
                return createConfigObject({
                    arn: resolver.resolverArn,
                    accountId,
                    awsRegion,
                    availabilityZone: NOT_APPLICABLE,
                    resourceType: AWS_APPSYNC_RESOLVER,
                    resourceId: resolver.resolverArn,
                    resourceName: resolver.fieldName,
                    relationships: [
                        // Create 'Is contained in' relationship to the parent GraphQL API.
                        createContainedInRelationship(AWS_APPSYNC_GRAPHQLAPI, {resourceId}),
                        // Create 'Is associated with' relationship to its Data Source.
                        createAssociatedRelationship(AWS_APPSYNC_DATASOURCE, {resourceName: resolver.dataSourceName})
                    ]
                }, {...resolver, apiId: resourceId});
            }))

            // Fetch AppSync Mutation Resolvers.
            const mutationResolvers = appSyncClient.listResolvers(resourceId, "Mutation").then(data => data.map(resolver => {
                return createConfigObject({
                    arn: resolver.resolverArn,
                    accountId,
                    awsRegion,
                    availabilityZone: NOT_APPLICABLE,
                    resourceType: AWS_APPSYNC_RESOLVER,
                    resourceId: resolver.resolverArn,
                    resourceName: resolver.fieldName,
                    relationships: [
                        // Create 'Is contained in' relationship to the parent GraphQL API.
                        createContainedInRelationship(AWS_APPSYNC_GRAPHQLAPI, {resourceId}),
                        // Create 'Is associated with' relationship to its Data Source.
                        createAssociatedRelationship(AWS_APPSYNC_DATASOURCE, {resourceName: resolver.dataSourceName})
                    ]
                }, {...resolver, apiId: resourceId});
            }))
            // Wait for all promises to settle and flatten the results.
            return Promise.allSettled([dataSources, queryResolvers, mutationResolvers])
                .then(results => results
                    .flatMap(({status, value}) => status === "fulfilled" ? value : [])
                )

        },
        /**
         * Handler for AWS::DynamoDB::Table resources.
         * Discovers and transforms DynamoDB Streams associated with the table.
         * @param {object} resource - The DynamoDB Table resource.
         * @returns {Promise<Array<object>>} A promise that resolves to an array containing the DynamoDB Stream resource object (if any).
         */
        [AWS_DYNAMODB_TABLE]: async ({awsRegion, accountId, configuration}) => {
            // Only proceed if the table has a stream enabled.
            if (configuration.latestStreamArn == null) {
                return []
            }

            const {credentials} = accountsMap.get(accountId);
            const dynamoDBStreamsClient = awsClient.createDynamoDBStreamsClient(credentials, awsRegion);

            // Describe the DynamoDB Stream.
            const stream = await dynamoDBStreamsClient.describeStream(configuration.latestStreamArn);

            return [createConfigObject({
                arn: stream.StreamArn,
                accountId,
                awsRegion,
                availabilityZone: NOT_APPLICABLE, // Streams are not AZ-specific.
                resourceType: AWS_DYNAMODB_STREAM,
                resourceId: stream.StreamArn,
                resourceName: stream.StreamArn,
                relationships: [] // Relationships will be added by other handlers.
            }, stream)];
        },
        /**
         * Handler for AWS::ECS::Service resources.
         * Discovers and transforms ECS Tasks associated with the service.
         * @param {object} resource - The ECS Service resource.
         * @returns {Promise<Array<object>>} A promise that resolves to an array of ECS Task resource objects.
         */
        [AWS_ECS_SERVICE]: async ({awsRegion, resourceId, resourceName, accountId, configuration: {Cluster}}) => {
            const {credentials} = accountsMap.get(accountId);
            const ecsClient = awsClient.createEcsClient(credentials, awsRegion);

            // Fetch all tasks for the given service within the cluster.
            const tasks = await ecsClient.getAllServiceTasks(Cluster, resourceName);

            return tasks.map(task => {
                return createConfigObject({
                    arn: task.taskArn,
                    accountId,
                    awsRegion,
                    availabilityZone: task.availabilityZone,
                    resourceType: AWS_ECS_TASK,
                    resourceId: task.taskArn,
                    resourceName: task.taskArn,
                    relationships: [
                        // Create 'Is associated with' relationship to the parent ECS Service.
                        createAssociatedRelationship(AWS_ECS_SERVICE, {resourceId})
                    ]
                }, task);
            });
        },
        /**
         * Handler for AWS::EKS::Cluster resources.
         * Discovers and transforms EKS Nodegroups associated with the cluster.
         * @param {object} resource - The EKS Cluster resource.
         * @returns {Promise<Array<object>>} A promise that resolves to an array of EKS Nodegroup resource objects.
         */
        [AWS_EKS_CLUSTER]: async ({accountId, awsRegion, resourceId, resourceName}) => {
            const {credentials} = accountsMap.get(accountId);

            const eksClient = awsClient.createEksClient(credentials, awsRegion);

            // Fetch all nodegroups for the given EKS cluster.
            const nodeGroups = await eksClient.listNodeGroups(resourceName);

            return nodeGroups.map(nodeGroup => {
                return createConfigObject({
                    arn: nodeGroup.nodegroupArn,
                    accountId,
                    awsRegion,
                    availabilityZone: MULTIPLE_AVAILABILITY_ZONES, // Nodegroups can span multiple AZs.
                    resourceType: AWS_EKS_NODE_GROUP,
                    resourceId: nodeGroup.nodegroupArn,
                    resourceName: nodeGroup.nodegroupName,
                    relationships: [
                        // Create 'Is contained in' relationship to the parent EKS Cluster.
                        createContainedInRelationship(AWS_EKS_CLUSTER, {resourceId})
                    ]
                }, nodeGroup);
            });
        },
        /**
         * Handler for AWS::IAM::Role resources.
         * Discovers and transforms inline IAM policies attached to the role.
         * @param {object} resource - The IAM Role resource.
         * @returns {Array<object>} An array of new inline IAM policy resource objects.
         */
        [AWS_IAM_ROLE]: async ({arn, resourceName, accountId, resourceType, configuration: {rolePolicyList = []}}) => {
            return rolePolicyList.map(createInlinePolicy({arn, resourceName, resourceType, accountId}));
        },
        /**
         * Handler for AWS::IAM::User resources.
         * Discovers and transforms inline IAM policies attached to the user.
         * @param {object} resource - The IAM User resource.
         * @returns {Array<object>} An array of new inline IAM policy resource objects.
         */
        [AWS_IAM_USER]: ({arn, resourceName, resourceType, accountId, configuration: {userPolicyList = []}}) => {
            return userPolicyList.map(createInlinePolicy({arn, resourceName, accountId, resourceType}));
        }
    }
}
