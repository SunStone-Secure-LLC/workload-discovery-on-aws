import Ajv from 'ajv' // Imports Ajv, a JSON Schema validator.
import fs from 'node:fs/promises'; // Node.js file system promises API for reading directories.
import {PromisePool} from '@supercharge/promise-pool'; // Imports PromisePool for concurrent promise execution.
import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import jmesPath from 'jmespath'; // Imports JMESPath for querying JSON data.
import {parse as parseArn} from '@aws-sdk/util-arn-parser'; // Imports ARN parser from AWS SDK utility.
import createEnvironmentVariableRelationships from './createEnvironmentVariableRelationships.mjs'; // Imports function to create relationships from environment variables.
import {
    AWS_API_GATEWAY_METHOD,
    AWS_LAMBDA_FUNCTION,
    AWS_AUTOSCALING_AUTOSCALING_GROUP,
    AWS_CLOUDFRONT_DISTRIBUTION,
    AWS_S3_BUCKET,
    AWS_CLOUDFRONT_STREAMING_DISTRIBUTION,
    AWS_IAM_ROLE,
    AWS_EC2_SECURITY_GROUP,
    AWS_EC2_SUBNET,
    AWS_EC2_ROUTE_TABLE,
    AWS_ECS_CLUSTER,
    AWS_EC2_INSTANCE,
    AWS_ECS_SERVICE,
    AWS_ECS_TASK_DEFINITION,
    AWS_ELASTIC_LOAD_BALANCING_V2_TARGET_GROUP,
    AWS_ECS_TASK,
    SUBNET_ID,
    NETWORK_INTERFACE_ID,
    AWS_EC2_NETWORK_INTERFACE,
    AWS_EFS_ACCESS_POINT,
    AWS_EFS_FILE_SYSTEM,
    AWS_EKS_NODE_GROUP,
    AWS_ELASTIC_LOAD_BALANCING_V2_LISTENER,
    AWS_ELASTIC_LOAD_BALANCING_V2_LOADBALANCER,
    AWS_COGNITO_USER_POOL,
    AWS_IAM_INLINE_POLICY,
    AWS_IAM_USER,
    UNKNOWN,
    AWS_RDS_DB_INSTANCE,
    AWS_EC2_NAT_GATEWAY,
    AWS_EC2_VPC_ENDPOINT,
    AWS_EC2_INTERNET_GATEWAY,
    AWS_EVENT_EVENT_BUS,
    AWS_SERVICE_CATALOG_APP_REGISTRY_APPLICATION,
    ENI_NAT_GATEWAY_INTERFACE_TYPE,
    ENI_ALB_DESCRIPTION_PREFIX,
    ENI_ELB_DESCRIPTION_PREFIX,
    ELASTIC_LOAD_BALANCING,
    LOAD_BALANCER,
    ENI_VPC_ENDPOINT_INTERFACE_TYPE,
    ENI_SEARCH_REQUESTER_ID,
    ENI_SEARCH_DESCRIPTION_PREFIX,
    IS_ATTACHED_TO,
    LAMBDA,
    S3,
    AWS,
    AWS_IAM_AWS_MANAGED_POLICY,
    IS_ASSOCIATED_WITH,
    CONTAINS,
    TAGS,
    TAG,
    APPLICATION_TAG_NAME
} from '../constants.mjs'; // Imports various constants, including AWS resource types, ENI prefixes, and relationship names.
import {
    createAssociatedRelationship,
    createContainedInVpcRelationship,
    createContainedInSubnetRelationship,
    createAssociatedSecurityGroupRelationship,
    createContainedInRelationship,
    createContainsRelationship,
    createAttachedRelationship,
    createArnRelationship,
    createArn,
    createResourceNameKey,
    createResourceIdKey,
    isQualifiedRelationshipName
} from '../utils.mjs'; // Imports utility functions for creating various relationship types, ARNs, and resource keys.
import logger from '../logger.mjs'; // Imports the logging utility.
import schema from '../../schemas/schema.json' with { type: 'json' }; // Imports the main JSON schema for validation.

import { iterate } from "iterare" // Imports `iterate` for iterable-based operations.
const ajv = new Ajv(); // Initializes Ajv validator.
const validate = ajv.compile(schema) // Compiles the main schema for validation.

/**
 * Creates a standardized relationship object based on a descriptor and an identifier.
 * It handles different identifier types (ARN, resource ID, endpoint) and ensures
 * relationship names are consistently qualified (e.g., 'Is contained in Subnet').
 * @param {object} descriptor - An object defining the relationship properties (e.g., `resourceType`, `relationshipName`, `identifierType`).
 * @param {string} id - The identifier of the target resource (ARN, resource ID, or endpoint).
 * @returns {object} A relationship object.
 */
function createRelationship(descriptor, id) {
    const {resourceType} = descriptor
    // To match AWS Config's behavior, relationship names that are not appended with resource types
    // (e.g., `Is contained in (Vpc|Subnet|Role|Etc)`) need precisely one space at the end.
    const relationshipName  = isQualifiedRelationshipName(descriptor.relationshipName)
        ? descriptor.relationshipName : descriptor.relationshipName.trim() + ' ';

    if(descriptor.identifierType === 'arn') {
        return {
            arn: id,
            relationshipName,
        }
    } else {
        return {
            [descriptor.identifierType]: id, // Dynamically sets the identifier property (e.g., `resourceId`).
            relationshipName,
            resourceType
        }
    }
}

/**
 * Maps an endpoint identifier to its corresponding ARN if it exists in the `endpointsToIdMap`.
 * This is used for normalizing relationships where the target is initially identified by an endpoint.
 * @param {Map<string, string>} endpointsToIdMap - A map of endpoint identifiers to ARNs.
 * @param {object} params - An object containing `descriptor` and `result` (the endpoint identifier).
 * @returns {object} An object with the updated `descriptor` (if identifier type changed to 'arn') and `result` (the ARN).
 */
function mapEndpointToId(endpointsToIdMap, {descriptor, result}) {
    if (descriptor.identifierType === 'endpoint') {
        const arn = endpointsToIdMap.get(result);
        return {
            descriptor: {
                ...descriptor,
                identifierType: 'arn', // Change identifier type to 'arn'.
            },
            result: arn, // Update result to the ARN.
        };
    }
    return {descriptor, result};
}

/**
 * Creates a relationship handler function based on a schema definition.
 * This handler extracts relevant data from a resource using JMESPath queries,
 * potentially makes SDK calls, and then generates relationships.
 * @param {object} clientFactories - An object containing AWS SDK client factory functions.
 * @param {object} lookUpMaps - An object containing various lookup maps (e.g., `accountsMap`, `endpointToIdMap`).
 * @param {object} schema - The schema definition for the resource type, including relationship descriptors.
 * @returns {function(object): Promise<void>} An async function that processes a resource and adds relationships.
 */
function createRelationshipHandler(
    clientFactories,
    {accountsMap, endpointToIdMap},
    schema
) {
    return async function (resource) {
        const {descriptors, rootPath = '@.configuration'} =
            schema.relationships; // Extract relationship descriptors and optional root path for JMESPath.

        // Partition descriptors into those requiring SDK calls and standard ones.
        const [sdkDescriptors, standardDescriptors] = R.partition(
            descriptor => descriptor.sdkClient != null,
            descriptors
        );

        // Process SDK-based relationships: make SDK calls and extract results.
        const sdkRels = await Promise.all(
            sdkDescriptors.map(async descriptor => {
                const {sdkClient} = descriptor;
                const {credentials} = accountsMap.get(resource.accountId); // Get credentials for the resource's account.

                // Create the specific SDK client.
                const client = clientFactories[sdkClient.type](
                    credentials,
                    resource.awsRegion
                );
                // Make the SDK call, passing arguments extracted via JMESPath from the resource.
                const sdkResult = await client[sdkClient.method](
                    ...sdkClient.argumentPaths.map(path => {
                        return jmesPath.search(resource, path);
                    })
                );

                // Extract the final result using JMESPath from the SDK response.
                return {
                    result: jmesPath.search(sdkResult, descriptor.path),
                    descriptor,
                };
            })
        );

        // Extract the root object for standard JMESPath queries.
        const root = jmesPath.search(resource, rootPath);
        // Process standard relationships: extract results directly from the resource.
        const standardRels = standardDescriptors.map(descriptor => {
            return {
                result: jmesPath.search(root, descriptor.path),
                descriptor
            };
        });

        // Combine all relationship results, map endpoints to IDs, filter nulls, and create relationship objects.
        const allRels = iterate([...sdkRels, ...standardRels])
        .map(({result, descriptor}) => mapEndpointToId(endpointToIdMap, {result, descriptor}))
        .filter(({result}) => result != null) // Filter out null results.
        .map(({result, descriptor}) => {
            if(result == null) return []; // Return empty array if result is null.

            if(Array.isArray(result)) {
                // Flatten array results to handle arbitrarily nested depths from JMESPath queries.
                return R.flatten(result).filter(x => x != null).map(id => createRelationship(descriptor, id));
            } else {
                return [createRelationship(descriptor, result)]; // Create a single relationship for non-array results.
            }
        }).flatten() // Flatten the array of arrays into a single array of relationships.
        .toArray()

        // Push the newly created relationships into the resource's relationships array (mutates resource).
        resource.relationships.push(...allRels);
    };
}

// Dynamically loads and validates resource type schemas from the 'resourceTypes' directory.
const schemaFiles = await fs
    .readdir('./src/schemas/resourceTypes') // Read all files in the directory.
    .then(
        R.map(fileName =>
            // Dynamically import each schema file as a JSON module.
            import(`../../schemas/resourceTypes/${fileName}`, {
                with: {type: 'json'},
            })
        )
    )
    .then(ps => Promise.all(ps)) // Wait for all schema imports to complete.
    .then(R.map(({default: schema}) => schema)) // Extract the default export (the schema object).
    .then(
        R.filter(schema => {
            // Validate each schema against the main schema.
            if (validate(schema)) {
                return true; // Keep valid schemas.
            } else {
                logger.error(
                    `There was an error validating the ${schema.type} schema.`,
                    {
                        errors: validate.errors,
                    }
                );
                return false; // Filter out invalid schemas.
            }
        })
    );

/**
 * Creates a collection of schema-driven relationship handlers.
 * It maps each valid schema file to a `createRelationshipHandler` function.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {object} lookupMaps - An object containing various lookup maps.
 * @returns {object} An object where keys are resource types and values are their corresponding schema handlers.
 */
function createSchemaHandlers(awsClient, lookupMaps) {
    // Define a mapping from SDK client types in schema to actual client factory functions.
    const clientFactories = {
        ecs: awsClient.createEcsClient,
        elbV1: awsClient.createElbClient,
        elbV2: awsClient.createElbV2Client
    }

    // Reduce schema files into an object of handlers, keyed by resource type.
    return schemaFiles.reduce((acc, schema) => {
        acc[schema.type] = createRelationshipHandler(clientFactories, lookupMaps, schema);
        return acc;
    }, {});
}

/**
 * Creates relationships between ECS tasks and EFS file systems or access points
 * based on ECS volume configurations.
 * @param {Array<object>} volumes - An array of ECS volume configurations.
 * @returns {Array<object>} An array of relationship objects.
 */
function createEcsEfsRelationships(volumes) {
    return volumes.reduce((acc, {EfsVolumeConfiguration}) => {
        if(EfsVolumeConfiguration != null) {
            // If an Access Point ID is specified, create a relationship to the EFS Access Point.
            if(EfsVolumeConfiguration.AuthorizationConfig?.AccessPointId != null) {
                acc.push(createAssociatedRelationship(AWS_EFS_ACCESS_POINT, {resourceId: EfsVolumeConfiguration.AuthorizationConfig.AccessPointId}));
            } else {
                // Otherwise, create a relationship directly to the EFS File System.
                acc.push(createAssociatedRelationship(AWS_EFS_FILE_SYSTEM, {resourceId: EfsVolumeConfiguration.FileSystemId}));
            }
        }
        return acc;
    }, []);
}

/**
 * Infers and creates a relationship for an Elastic Network Interface (ENI) based on its description,
 * interface type, and requester ID. This function handles various ENI types (NAT Gateway, ALB, VPC Endpoint,
 * OpenSearch/Elasticsearch, Lambda) and creates the appropriate 'Is attached to' relationship.
 * @param {object} eniInfo - An object containing ENI details (`description`, `interfaceType`, `requesterId`, `awsRegion`, `accountId`).
 * @returns {object} A relationship object or an object with `resourceId: UNKNOWN` if the type cannot be determined.
 */
function createEniRelationship({description, interfaceType, requesterId, awsRegion, accountId}) {
    if(interfaceType === ENI_NAT_GATEWAY_INTERFACE_TYPE) {
        // For NAT Gateway ENIs, extract the NAT Gateway ID from the description.
        // Example description: "Interface for NAT Gateway nat-0123456789abcdef0"
        const {groups: {resourceId}} = R.match(/(?<resourceId>nat-[0-9a-fA-F]+)/, description);
        return createAttachedRelationship(AWS_EC2_NAT_GATEWAY, {resourceId});
    } else if(description.startsWith(ENI_ALB_DESCRIPTION_PREFIX)) {
        // For ALB ENIs, extract ALB details and construct its ARN.
        // Example description: "ELB app/my-alb/1234567890abcdef"
        const [app, albGroup, linkedAlb] = description.replace(ENI_ELB_DESCRIPTION_PREFIX, '').split('/');
        const albArn = createArn(
            {service: ELASTIC_LOAD_BALANCING, accountId, region: awsRegion, resource: `${LOAD_BALANCER}/${app}/${albGroup}/${linkedAlb}`}
        );
        return createArnRelationship(IS_ATTACHED_TO, albArn);
    } else if(interfaceType === ENI_VPC_ENDPOINT_INTERFACE_TYPE) {
        // For VPC Endpoint ENIs, extract the VPC Endpoint ID from the description.
        // Example description: "VPC Endpoint Interface vpce-0123456789abcdef0"
        const {groups: {resourceId}} = R.match(/(?<resourceId>vpce-[0-9a-fA-F]+)/, description)
        return createAttachedRelationship(AWS_EC2_VPC_ENDPOINT, {resourceId});
    } else if(requesterId === ENI_SEARCH_REQUESTER_ID) {
        // For OpenSearch/Elasticsearch ENIs, extract the domain name.
        // It's not possible to tell whether it's OpenSearch or Elasticsearch from the ENI,
        // so an ARN is used as both use the same format.
        const domainName = description.replace(ENI_SEARCH_DESCRIPTION_PREFIX, '');
        const arn = createArn({
            service: 'es', accountId, region: awsRegion, resource: `domain/${domainName}`
        });
        return createArnRelationship(IS_ATTACHED_TO, arn);
    } else if(interfaceType === LAMBDA) {
        // For Lambda ENIs, extract the Lambda function resource ID.
        // Example description: "AWS Lambda VPC ENI-my-lambda-function-arn-uuid4"
        const resourceId = description
            .replace('AWS Lambda VPC ENI-', '')
            .replace(/-[A-F\d]{8}-[A-F\d]{4}-4[A-F\d]{3}-[89AB][A-F\d]{3}-[A-F\d]{12}$/i, ''); // Remove UUID suffix.
        return createAttachedRelationship(AWS_LAMBDA_FUNCTION, {resourceId});
    } else {
        return {resourceId: UNKNOWN} // Return UNKNOWN if ENI type cannot be determined.
    }
}

/**
 * Creates relationships to AWS managed IAM policies.
 * It filters policies to include only AWS-managed ones and creates an 'Is attached to' relationship.
 * @param {Map<string, object>} resourceMap - A map of resource ARNs to resource objects.
 * @param {Array<object>} policies - An array of policy objects.
 * @returns {Array<object>} An array of relationship objects.
 */
function createManagedPolicyRelationships(resourceMap, policies) {
    return policies.reduce((acc, {policyArn}) => {
        const {accountId} = parseArn(policyArn);
        // Only create relationships for AWS-managed policies (where accountId is 'aws').
        if(accountId === AWS) {
            acc.push(createAttachedRelationship(AWS_IAM_AWS_MANAGED_POLICY, {arn: policyArn}));
        }
        return acc;
    }, []);
}

/**
 * Creates a collection of asynchronous handler functions, each responsible for discovering
 * and adding a specific type of individual relationship for a given resource type.
 * These handlers often involve detailed parsing of resource configurations or specific SDK calls.
 * @param {object} lookUpMaps - An object containing various lookup maps.
 * @param {object} awsClient - The AWS client factory instance.
 * @returns {object} An object where keys are AWS resource types and values are async handler functions.
 */
function createIndividualHandlers(lookUpMaps, awsClient) {

    const {
        accountsMap,
        endpointToIdMap,
        resourceIdentifierToIdMap,
        targetGroupToAsgMap,
        elbDnsToResourceIdMap,
        asgResourceNameToResourceIdMap,
        envVarResourceIdentifierToIdMap,
        eventBusRuleMap,
        resourceMap
    } = lookUpMaps;

    return {
        /**
         * Handles relationships for AWS::ApiGateway::Method.
         * Infers relationships to Lambda functions if the method's integration URI points to one.
         * @param {object} resource - The API Gateway Method resource.
         */
        [AWS_API_GATEWAY_METHOD]: async ({relationships, configuration: {methodIntegration}}) => {
            const methodUri = methodIntegration?.uri ?? '';
            // Extract Lambda ARN from the integration URI using regex.
            const lambdaArn = R.match(/arn.*\/functions\/(?<lambdaArn>.*)\/invocations/, methodUri).groups?.lambdaArn;
            if(lambdaArn != null) { // Not all API Gateways use Lambda integrations.
                relationships.push(createAssociatedRelationship(AWS_LAMBDA_FUNCTION, {arn: lambdaArn}));
            }
        },
        /**
         * Handles relationships for AWS::ServiceCatalogAppRegistry::Application.
         * If the application has an `applicationTag`, it finds the corresponding tag resource
         * and inherits its 'Contains' relationships.
         * @param {object} resource - The AppRegistry Application resource.
         */
        [AWS_SERVICE_CATALOG_APP_REGISTRY_APPLICATION]: async ({accountId, configuration: {applicationTag}, relationships}) => {
            if(applicationTag == null) return; // Skip if no application tag is defined.

            // Construct the resource name and ARN for the application tag.
            const tagResourceName = `${APPLICATION_TAG_NAME}=${applicationTag.awsApplication}`;
            const applicationTagArn = createArn({
                service: TAGS, accountId, resource: `${TAG}/${tagResourceName}`
            });

            const tag = resourceMap.get(applicationTagArn); // Retrieve the tag resource.

            if(tag != null) {
                // Inherit 'Contains' relationships from the tag to the application.
                relationships.push(...tag.relationships.map(rel => {
                    return {
                        ...rel,
                        relationshipName: CONTAINS // Change relationship name to 'Contains'.
                    };
                }));
            }
        },
        /**
         * Handles relationships for AWS::CloudFront::Distribution.
         * Normalizes S3 bucket ARNs in relationships and infers relationships to ELBs/ALBs
         * based on origin domain names.
         * @param {object} resource - The CloudFront Distribution resource.
         */
        [AWS_CLOUDFRONT_DISTRIBUTION]: async ({configuration: {distributionConfig}, relationships}) => {
            relationships.forEach(relationship => {
                const {resourceId, resourceType} = relationship;
                // If an S3 bucket is a target, ensure its ARN is correctly formed.
                if(resourceType === AWS_S3_BUCKET) {
                    relationship.arn = createArn({service: S3, resource: resourceId});
                }
            });

            const items = distributionConfig.origins?.items ?? []; // Get distribution origins.

            // Add relationships to ELBs/ALBs if origin domain names match known load balancers.
            relationships.push(...items.reduce((acc, {domainName}) => {
                if(elbDnsToResourceIdMap.has(domainName)) {
                    const {resourceType, resourceId, awsRegion} = elbDnsToResourceIdMap.get(domainName)
                    acc.push(createAssociatedRelationship(resourceType, {resourceId, awsRegion}));
                }
                return acc;
            }, []));
        },
        /**
         * Handles relationships for AWS::CloudFront::StreamingDistribution.
         * Normalizes S3 bucket ARNs in relationships.
         * @param {object} resource - The CloudFront Streaming Distribution resource.
         */
        [AWS_CLOUDFRONT_STREAMING_DISTRIBUTION]: async ({relationships}) => {
            relationships.forEach(relationship => {
                const {resourceId, resourceType} = relationship;
                // If an S3 bucket is a target, ensure its ARN is correctly formed.
                if(resourceType === AWS_S3_BUCKET) {
                    relationship.arn = createArn({service: S3, resource: resourceId});
                }
            });
        },
        /**
         * Handles relationships for AWS::EC2::SecurityGroup.
         * Infers relationships to other security groups based on ingress/egress rules.
         * @param {object} resource - The EC2 Security Group resource.
         */
        [AWS_EC2_SECURITY_GROUP]: async ({configuration, relationships}) => {
            const {ipPermissions, ipPermissionsEgress} = configuration;
            // Collect unique security group IDs referenced in ingress and egress rules.
            const securityGroups = [...ipPermissions, ...ipPermissionsEgress].reduce((acc, {userIdGroupPairs = []}) => {
                userIdGroupPairs.forEach(({groupId}) => {
                    if(groupId != null) acc.add(groupId);
                });
                return acc;
            }, new Set());

            // Create 'Is associated with SecurityGroup' relationships for each referenced security group.
            relationships.push(...Array.from(securityGroups).map(createAssociatedSecurityGroupRelationship));
        },
        /**
         * Handles relationships and properties for AWS::EC2::Subnet.
         * Sets the `subnetId` property and infers if the subnet is private based on its route table.
         * @param {object} subnet - The EC2 Subnet resource.
         */
        [AWS_EC2_SUBNET]: async subnet => {
            const {relationships, awsRegion, accountId, configuration: {subnetId}} = subnet;

            subnet.subnetId = subnetId; // Set the subnetId property directly.

            // Find the relationship to the route table.
            const routeTableRel = relationships.find(x => x.resourceType === AWS_EC2_ROUTE_TABLE);
            if(routeTableRel != null) {
                const {resourceId, resourceType} = routeTableRel;
                // Get the full route table resource from the resource map.
                const routeTableId = resourceIdentifierToIdMap.get(createResourceIdKey({resourceId, resourceType, accountId, awsRegion}));
                const routes = resourceMap.get(routeTableId)?.configuration?.routes ?? [];
                // A subnet is considered private if it has no NAT Gateway routes.
                const natGateways = routes.filter(x => x.natGatewayId != null);
                subnet.private = natGateways.length === 0;
            }
        },
        /**
         * Handles relationships for AWS::ECS::Task.
         * Adds relationships to ECS Cluster, IAM Roles, EFS, VPC, Subnet, and Network Interfaces.
         * Also processes environment variables for relationships.
         * @param {object} task - The ECS Task resource.
         */
        [AWS_ECS_TASK]: async task => {
            const {accountId, awsRegion, configuration} = task;
            const {clusterArn, overrides, attachments = [], taskDefinitionArn} = configuration;

            // Running tasks can reference deregistered and/or deleted task definitions,
            // so provide fallback values if the definition no longer exists.
            const taskDefinition = resourceMap.get(taskDefinitionArn) ?? {
                configuration: {
                    ContainerDefinitions: [],
                    Volumes: []
                }
            };

            // Add 'Is contained in' relationship to the ECS Cluster.
            task.relationships.push(createContainedInRelationship(AWS_ECS_CLUSTER, {arn: clusterArn}));

            // Add relationships to Task Role and Execution Role.
            const {taskRoleArn, executionRoleArn, containerOverrides = []} = overrides;
            const roleRels = R.reject(R.isNil, [taskRoleArn, executionRoleArn])
                .map(arn => createAssociatedRelationship(AWS_IAM_ROLE, {arn}));

            if (R.isEmpty(roleRels)) {
                const {configuration: {TaskRoleArn, ExecutionRoleArn}} = taskDefinition;
                R.reject(R.isNil, [TaskRoleArn, ExecutionRoleArn])
                    .forEach(arn => {
                        task.relationships.push(createAssociatedRelationship(AWS_IAM_ROLE, {arn}));
                    });
            } else {
                task.relationships.push(...roleRels);
            }

            // Process environment variables from container definitions and overrides.
            const groupedDefinitions = R.groupBy(x => x.Name, taskDefinition.configuration.ContainerDefinitions);
            const groupedOverrides = R.groupBy(x => x.name, containerOverrides);

            const environmentVariables = Object.entries(groupedDefinitions).map(([key, val]) => {
                const Environment = R.head(val)?.Environment ?? [];
                const environment = R.head(groupedOverrides[key] ?? [])?.environment ?? [];

                const envVarObj = Environment.reduce((acc, {Name, Value}) => {
                    acc[Name] = Value;
                    return acc
                }, {});

                const overridesObj = environment.reduce((acc, {name, value}) => {
                    acc[name] = value;
                    return acc
                }, {});

                return {...envVarObj, ...overridesObj};
            }, {});

            // Create relationships from environment variables.
            environmentVariables.forEach( variables => {
                task.relationships.push(...createEnvironmentVariableRelationships(
                    {resourceMap, envVarResourceIdentifierToIdMap, endpointToIdMap},
                    {accountId, awsRegion},
                    variables));
            });

            // Create relationships to EFS file systems/access points from task volumes.
            task.relationships.push(...createEcsEfsRelationships(taskDefinition.configuration.Volumes));

            // Process network interface attachments for VPC and Subnet relationships.
            attachments.forEach(({details}) => {
                return details.forEach(({name, value}) => {
                    if(name === SUBNET_ID) {
                        // Infer VPC ID from subnet and add relationships.
                        const subnetArn = resourceIdentifierToIdMap.get(createResourceIdKey({resourceId: value, resourceType: AWS_EC2_SUBNET, accountId, awsRegion}));
                        const vpcId = resourceMap.get(subnetArn)?.configuration?.vpcId; // Subnet might not have been discovered yet.

                        if(vpcId != null) task.relationships.push(createContainedInVpcRelationship(vpcId));
                        task.relationships.push(createContainedInSubnetRelationship(value));
                    } else if (name === NETWORK_INTERFACE_ID) {
                        // Add relationship from Network Interface to the ECS Task.
                        const networkInterfaceId = resourceIdentifierToIdMap.get(createResourceIdKey({resourceId: value, resourceType: AWS_EC2_NETWORK_INTERFACE, accountId, awsRegion}));
                        // Occasionally network interface information is stale, so perform null checks.
                        resourceMap.get(networkInterfaceId)?.relationships?.push(createAttachedRelationship(AWS_ECS_TASK, {resourceId: task.resourceId}));
                    }
                });
            });
        },
        /**
         * Handles relationships for AWS::ECS::TaskDefinition.
         * Processes environment variables within container definitions to create relationships.
         * @param {object} resource - The ECS Task Definition resource.
         */
        [AWS_ECS_TASK_DEFINITION]: async ({relationships, accountId, awsRegion, configuration}) => {
            configuration.ContainerDefinitions.forEach(({Environment = []}) => {
                const variables = Environment.reduce((acc, {Name, Value}) => {
                    acc[Name] = Value;
                    return acc
                }, {});
                relationships.push(...createEnvironmentVariableRelationships(
                    {resourceMap, envVarResourceIdentifierToIdMap, endpointToIdMap},
                    {accountId, awsRegion},
                    variables));
            });
        },
        /**
         * Handles relationships for AWS::EKS::Nodegroup.
         * Infers relationships to Auto Scaling Groups (ASGs) associated with the nodegroup.
         * @param {object} nodeGroup - The EKS Nodegroup resource.
         */
        [AWS_EKS_NODE_GROUP]: async nodeGroup => {
            const {accountId, awsRegion, relationships, configuration} = nodeGroup;
            const autoScalingGroups = configuration.resources?.autoScalingGroups ?? [];

            relationships.push(
                ...autoScalingGroups.map(({name}) => {
                    // Get the resource ID of the ASG from its name.
                    const rId = asgResourceNameToResourceIdMap.get(createResourceNameKey({
                        resourceName: name,
                        accountId,
                        awsRegion
                    }));
                    return createAssociatedRelationship(AWS_AUTOSCALING_AUTOSCALING_GROUP, {resourceId: rId});
                }),
            );
        },
        /**
         * Handles relationships for AWS::ElasticLoadBalancingV2::Listener (ALB/NLB Listener).
         * Infers relationships to Load Balancers, Target Groups, and Cognito User Pools.
         * @param {object} resource - The ELBv2 Listener resource.
         */
        [AWS_ELASTIC_LOAD_BALANCING_V2_LISTENER]: async ({relationships, configuration: {LoadBalancerArn, DefaultActions}}) => {
            const {targetGroups, cognitoUserPools} = DefaultActions.reduce((acc, {AuthenticateCognitoConfig, TargetGroupArn, ForwardConfig}) => {
                if(AuthenticateCognitoConfig != null) acc.cognitoUserPools.add(AuthenticateCognitoConfig.UserPoolArn);
                if(TargetGroupArn != null) acc.targetGroups.add(TargetGroupArn);
                if(ForwardConfig != null) {
                    const {TargetGroups = []} = ForwardConfig;
                    TargetGroups.forEach(x => acc.targetGroups.add(x.TargetGroupArn))
                }
                return acc;
            }, {cognitoUserPools: new Set(), targetGroups: new Set});

            relationships.push(
                createAssociatedRelationship(AWS_ELASTIC_LOAD_BALANCING_V2_LOADBALANCER, {resourceId: LoadBalancerArn}),
                ...Array.from(targetGroups.values()).map(resourceId => createAssociatedRelationship(AWS_ELASTIC_LOAD_BALANCING_V2_TARGET_GROUP, {resourceId})),
                ...Array.from(cognitoUserPools.values()).map(resourceId => createAssociatedRelationship(AWS_COGNITO_USER_POOL, {resourceId}))
            );
        },
        /**
         * Handles relationships for AWS::ElasticLoadBalancingV2::TargetGroup (ALB/NLB Target Group).
         * Infers relationships to VPCs, EC2 Instances, and Auto Scaling Groups.
         * Also fetches target health to potentially label links (TODO).
         * @param {object} resource - The ELBv2 Target Group resource.
         */
        [AWS_ELASTIC_LOAD_BALANCING_V2_TARGET_GROUP]: async ({accountId, awsRegion, arn, configuration: {VpcId}, relationships}) => {
            const {credentials} = accountsMap.get(accountId);
            const elbClientV2 = awsClient.createElbV2Client(credentials, awsRegion);

            // Get associated ASG instances and ARN if the target group is linked to an ASG.
            const {instances: asgInstances, arn: asgArn} = targetGroupToAsgMap.get(arn) ?? {instances: new Set()};

            const targetHealthDescriptions = await elbClientV2.describeTargetHealth(arn);

            // TODO: use TargetHealth to label the link as to whether it's healthy or not.
            relationships.push(createContainedInVpcRelationship(VpcId),
                ...targetHealthDescriptions.reduce((acc, {Target: {Id}, TargetHealth}) => {
                    // We don't want to include instances from ASGs as the direct link should be to the
                    // ASG not the instances therein.
                    if(Id.startsWith('i-') && !asgInstances.has(Id)) {
                        acc.push(createAssociatedRelationship(AWS_EC2_INSTANCE, {resourceId:Id}));
                    } else if(Id.startsWith('arn:')) {
                        acc.push(createArnRelationship(IS_ASSOCIATED_WITH, Id));
                    }
                    return acc;
                }, []));

            if(asgArn != null) {
                relationships.push(createAssociatedRelationship(AWS_AUTOSCALING_AUTOSCALING_GROUP, {resourceId: asgArn}));
            }
        },
        /**
         * Handles relationships for AWS::Events::EventBus.
         * Infers relationships to EventBridge Rules associated with the event bus.
         * @param {object} resource - The EventBridge Event Bus resource.
         */
        [AWS_EVENT_EVENT_BUS]: async ({arn, relationships}) => {
            // Get rules associated with this event bus from the pre-built map.
            relationships.push(...eventBusRuleMap.get(arn).map(createArnRelationship(IS_ASSOCIATED_WITH)));
        },
        /**
         * Handles relationships for AWS::IAM::Role.
         * Infers relationships to AWS managed IAM policies attached to the role.
         * @param {object} resource - The IAM Role resource.
         */
        [AWS_IAM_ROLE]: async ({configuration: {attachedManagedPolicies}, relationships}) => {
            relationships.push(...createManagedPolicyRelationships(resourceMap, attachedManagedPolicies));
        },
        /**
         * Handles relationships for AWS::IAM::InlinePolicy.
         * Infers relationships to resources specified in the policy document's `Resource` field.
         * @param {object} resource - The IAM Inline Policy resource.
         */
        [AWS_IAM_INLINE_POLICY]: ({configuration: {policyDocument}, relationships}) => {
            // Ensure Statement is an array for consistent processing.
            const statement = Array.isArray(policyDocument.Statement) ?
                policyDocument.Statement : [policyDocument.Statement];

            relationships.push(...statement.flatMap(({Resource = []}) => {
                // The Resource field can be an array or a string.
                const resources = Array.isArray(Resource) ? Resource : [Resource];
                return resources.reduce((acc, resourceArn) => {
                    // Remove trailing '/*' from ARNs to increase the chance of finding a match in the resource map,
                    // especially for S3 buckets. Duplicates will be handled later.
                    const resource = resourceMap.get(resourceArn.replace(/\/?\*$/, ''));
                    if(resource != null) {
                        acc.push(createAttachedRelationship(resource.resourceType, {
                            arn: resource.arn
                        }));
                    }
                    return acc;
                }, []);
            }));
        },
        /**
         * Handles relationships for AWS::IAM::User.
         * Infers relationships to AWS managed IAM policies attached to the user.
         * @param {object} resource - The IAM User resource.
         */
        [AWS_IAM_USER]: ({configuration: {attachedManagedPolicies}, relationships}) => {
            relationships.push(...createManagedPolicyRelationships(resourceMap, attachedManagedPolicies));
        },
        /**
         * Handles relationships for AWS::EC2::NetworkInterface.
         * Infers relationships to various AWS resources based on ENI description and type.
         * @param {object} eni - The EC2 Network Interface resource.
         */
        [AWS_EC2_NETWORK_INTERFACE]: async eni => {
            const {accountId, awsRegion, relationships, configuration} = eni;
            const {interfaceType, description, requesterId} = configuration;

            // Create a relationship based on the ENI's properties.
            const relationship = createEniRelationship({awsRegion, accountId, interfaceType, description, requesterId});
            if(relationship.resourceId !== UNKNOWN) {
                relationships.push(relationship);
            }
        },
        /**
         * Handles relationships for AWS::RDS::DBInstance.
         * Infers relationships to VPCs and Subnets based on DB Subnet Group and Availability Zone.
         * @param {object} db - The RDS DB Instance resource.
         */
        [AWS_RDS_DB_INSTANCE]: async db => {
            const {dBSubnetGroup, availabilityZone} = db.configuration;

            if(dBSubnetGroup != null) {
                // Find the subnet identifier that matches the DB instance's availability zone.
                const {subnetIdentifier} = R.find(({subnetAvailabilityZone}) => subnetAvailabilityZone.name === availabilityZone,
                    dBSubnetGroup.subnets);

                // Add 'Is contained in VPC' and 'Is contained in Subnet' relationships.
                db.relationships.push(...[
                    createContainedInVpcRelationship(dBSubnetGroup.vpcId),
                    createContainedInSubnetRelationship(subnetIdentifier)
                ]);
            }
        },
        /**
         * Handles relationships for AWS::EC2::RouteTable.
         * Infers relationships to NAT Gateways, VPC Endpoints, and Internet Gateways based on routes.
         * @param {object} resource - The EC2 Route Table resource.
         */
        [AWS_EC2_ROUTE_TABLE]: async ({configuration: {routes}, relationships}) => {
            relationships.push(...routes.reduce((acc, {natGatewayId, gatewayId}) => {
                if(natGatewayId != null) {
                    acc.push(createContainsRelationship(AWS_EC2_NAT_GATEWAY, {resourceId: natGatewayId}));
                } else if(R.test(/vpce-[0-9a-fA-F]+/, gatewayId)) {
                    acc.push(createContainsRelationship(AWS_EC2_VPC_ENDPOINT, {resourceId: gatewayId}));
                } else if(R.test(/igw-[0-9a-fA-F]+/, gatewayId)) {
                    acc.push(createContainsRelationship(AWS_EC2_INTERNET_GATEWAY, {resourceId: gatewayId}));
                }
                return acc;
            }, []));
        }
    }
}

/**
 * Orchestrates the addition of individual relationships to resources.
 * It processes resources by applying both schema-driven handlers and hardcoded individual handlers.
 * It uses `PromisePool` for concurrent processing and logs any errors.
 * @param {object} lookUpMaps - An object containing various lookup maps.
 * @param {object} awsClient - The AWS client factory instance.
 * @param {Array<object>} resources - An array of resource objects to be enriched.
 * @returns {Promise<void>} A promise that resolves when all individual relationships have been processed.
 */
async function addIndividualRelationships(lookUpMaps, awsClient, resources) {
    // Create hardcoded individual relationship handlers.
    const handlers = createIndividualHandlers(lookUpMaps, awsClient);
    // Create schema-driven relationship handlers.
    const schemaHandlers = createSchemaHandlers(awsClient, lookUpMaps);

    // Process resources concurrently using PromisePool.
    const {errors} = await PromisePool
        .withConcurrency(30) // Limits concurrency to 30 resources at a time.
        .for(resources)
        .process(async resource => {
            const handler = handlers[resource.resourceType];
            const schemaHandler = schemaHandlers[resource.resourceType];

            // Apply schema-driven handler first if available.
            if(schemaHandler != null) await schemaHandler(resource);
            // Apply hardcoded handler if available.
            if(handler != null) await handler(resource);
        });

    logger.error(`There were ${errors.length} errors when adding additional relationships.`);
    logger.debug('Errors: ', {errors});
}

export default addIndividualRelationships;
