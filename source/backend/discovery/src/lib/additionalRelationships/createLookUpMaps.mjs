import * as R from 'ramda'; // Imports the Ramda utility library for functional programming.
import {
    AWS_AUTOSCALING_AUTOSCALING_GROUP,
    AWS_ELASTICSEARCH_DOMAIN,
    AWS_OPENSEARCH_DOMAIN,
    AWS_ELASTIC_LOAD_BALANCING_LOADBALANCER,
    AWS_ELASTIC_LOAD_BALANCING_V2_LOADBALANCER,
    AWS_EVENT_RULE,
    AWS_RDS_DB_CLUSTER,
    EVENTS,
    EVENT_BUS
} from '../constants.mjs'; // Imports various constants, including AWS resource types and service identifiers.
import {createResourceNameKey, createResourceIdKey, createArn} from '../utils.mjs'; // Imports utility functions for creating resource keys and ARNs.

/**
 * Extracts an endpoint string from a resource's configuration.
 * It checks for common endpoint property names like `endpoint` or `Endpoint`
 * and then extracts the value or address.
 * @param {object} configuration - The configuration object of a resource.
 * @returns {string|null} The extracted endpoint string, or null if not found.
 */
function getEndpoint(configuration) {
    const endpoint = configuration.endpoint ?? configuration.Endpoint;
    return endpoint?.value ?? endpoint?.address ?? endpoint;
}

/**
 * Creates various lookup maps specific to certain AWS resource types.
 * These maps facilitate efficient lookup of related resources during relationship inference.
 * @param {Array<object>} resources - An array of discovered resource objects.
 * @returns {object} An object containing the created lookup maps:
 *   - `targetGroupToAsgMap`: Maps Target Group ARNs to ASG info (ARN, instances).
 *   - `endpointToIdMap`: Maps endpoint strings (e.g., OpenSearch, Elasticsearch) to resource IDs.
 *   - `elbDnsToResourceIdMap`: Maps ELB/ALB DNS names to resource IDs, types, and regions.
 *   - `asgResourceNameToResourceIdMap`: Maps ASG resource names to resource IDs.
 *   - `eventBusRuleMap`: Maps Event Bus ARNs to an array of associated Rule IDs.
 */
function createResourceTypeLookUpMaps(resources) {
    const targetGroupToAsgMap = new Map(); // Maps Target Group ARNs to Auto Scaling Group information.
    const endpointToIdMap = new Map(); // Maps various service endpoints (e.g., OpenSearch) to resource IDs.
    const elbDnsToResourceIdMap = new Map(); // Maps ELB/ALB DNS names to their resource IDs, types, and regions.
    const asgResourceNameToResourceIdMap = new Map(); // Maps Auto Scaling Group resource names to their resource IDs.
    const eventBusRuleMap = new Map(); // Maps Event Bus ARNs to an array of associated Event Rule IDs.

    // Handlers for specific resource types to populate the lookup maps.
    const handlers = {
        /**
         * Handler for AWS::AutoScaling::AutoScalingGroup resources.
         * Populates `targetGroupToAsgMap` and `asgResourceNameToResourceIdMap`.
         * @param {object} resource - The Auto Scaling Group resource.
         */
        [AWS_AUTOSCALING_AUTOSCALING_GROUP]: resource => {
            const {resourceId, resourceName, accountId, awsRegion, arn, configuration} = resource;
            // Map each associated Target Group ARN to this ASG's ARN and its instances.
            configuration.targetGroupARNs.forEach(tg =>
                targetGroupToAsgMap.set(tg, {
                    arn,
                    instances: new Set(configuration.instances.map(R.prop('instanceId')))
                }));
            // Map the ASG's resource name to its resource ID for quick lookup.
            asgResourceNameToResourceIdMap.set(
                createResourceNameKey(
                    {resourceName, accountId, awsRegion}),
                resourceId);
        },
        /**
         * Handler for AWS::Elasticsearch::Domain resources.
         * Populates `endpointToIdMap` with Elasticsearch domain endpoints.
         * @param {object} resource - The Elasticsearch Domain resource.
         */
        [AWS_ELASTICSEARCH_DOMAIN]: ({id, configuration: {endpoints = []}}) => {
            // Map each endpoint to the domain's ID.
            Object.values(endpoints).forEach(endpoint => endpointToIdMap.set(endpoint, id));
        },
        /**
         * Handler for AWS::OpenSearch::Domain resources.
         * Populates `endpointToIdMap` with OpenSearch domain endpoints.
         * @param {object} resource - The OpenSearch Domain resource.
         */
        [AWS_OPENSEARCH_DOMAIN]: ({id, configuration: {Endpoints = []}}) => {
            // Map each endpoint to the domain's ID.
            Object.values(Endpoints).forEach(endpoint => endpointToIdMap.set(endpoint, id));
        },
        /**
         * Handler for AWS::ElasticLoadBalancing::LoadBalancer (Classic ELB) resources.
         * Populates `elbDnsToResourceIdMap` with ELB DNS names.
         * @param {object} resource - The Classic ELB resource.
         */
        [AWS_ELASTIC_LOAD_BALANCING_LOADBALANCER]: ({resourceId, resourceType, awsRegion, configuration}) => {
            // Map the ELB's DNS name to its resource ID, type, and region.
            elbDnsToResourceIdMap.set(configuration.dnsname, {resourceId, resourceType, awsRegion});
        },
        /**
         * Handler for AWS::ElasticLoadBalancingV2::LoadBalancer (ALB/NLB) resources.
         * Populates `elbDnsToResourceIdMap` with ELBv2 DNS names.
         * @param {object} resource - The ELBv2 Load Balancer resource.
         */
        [AWS_ELASTIC_LOAD_BALANCING_V2_LOADBALANCER]: ({resourceId, resourceType, awsRegion, configuration}) => {
            // Map the ELBv2's DNS name to its resource ID, type, and region.
            elbDnsToResourceIdMap.set(configuration.dNSName, {resourceId, resourceType, awsRegion});
        },
        /**
         * Handler for AWS::Events::Rule resources.
         * Populates `eventBusRuleMap` by mapping Event Bus ARNs to associated Rule IDs.
         * @param {object} resource - The EventBridge Rule resource.
         */
        [AWS_EVENT_RULE]: ({id, accountId, awsRegion, configuration: {EventBusName}}) => {
            // Construct the Event Bus ARN, handling cases where it might not be a full ARN.
            const eventBusArn = EventBusName.startsWith('arn:')
                ? EventBusName : createArn({
                    service: EVENTS, accountId, region: awsRegion, resource: `${EVENT_BUS}/${EventBusName}`,
                });
            // Initialize array for the Event Bus if not already present.
            if(!eventBusRuleMap.has(eventBusArn)) eventBusRuleMap.set(eventBusArn, []);
            // Push the current rule's ID to the list for its Event Bus.
            eventBusRuleMap.get(eventBusArn).push(id);
        },
        /**
         * Handler for AWS::RDS::DBCluster resources.
         * Populates `endpointToIdMap` with RDS DB Cluster reader endpoints.
         * @param {object} resource - The RDS DB Cluster resource.
         */
        [AWS_RDS_DB_CLUSTER]: ({id, configuration: {readerEndpoint}}) => {
            // Map the reader endpoint to the DB Cluster's ID.
            if(readerEndpoint != null) endpointToIdMap.set(readerEndpoint, id);
        }
    };

    // Iterate through all resources and apply relevant handlers and general endpoint mapping.
    for(let resource of resources) {
        const {id, resourceType, configuration} = resource;
        const endpoint = getEndpoint(configuration);

        // Map any general endpoint found in the resource's configuration to its ID.
        if(endpoint != null) {
            endpointToIdMap.set(endpoint, id);
        }

        // Apply the specific handler for the resource's type if one exists.
        const handler = handlers[resourceType];
        if(handler != null) handler(resource);
    }

    return {
        endpointToIdMap,
        targetGroupToAsgMap,
        elbDnsToResourceIdMap,
        asgResourceNameToResourceIdMap,
        eventBusRuleMap
    }
}

/**
 * Creates a comprehensive set of lookup maps from a list of discovered resources.
 * These maps are essential for efficiently inferring and adding relationships between resources.
 * It includes general resource identifier maps and resource-type-specific maps.
 * @param {Array<object>} resources - An array of discovered resource objects.
 * @returns {object} An object containing all the created lookup maps:
 *   - `resourceIdentifierToIdMap`: Maps composite keys (resource ID/name + type + account + region) to resource ARNs/IDs.
 *   - `envVarResourceIdentifierToIdMap`: Similar to above, but specifically for environment variable resolution (does not include resourceType in key).
 *   - Plus all maps created by `createResourceTypeLookUpMaps`.
 */
function createLookUpMaps(resources) {
    const resourceIdentifierToIdMap = new Map(); // Maps a composite key (resource ID/name + type + account + region) to resource ARN/ID.
    // This map is similar to `resourceIdentifierToIdMap` but does not include `resourceType` in the key.
    // It's used specifically for resolving environment variable values where the target resource type is unknown.
    const envVarResourceIdentifierToIdMap = new Map();

    // Populate the general resource identifier maps.
    for(let resource of resources) {
        const {id, resourceType, resourceId, resourceName, accountId, awsRegion} = resource;

        if(resourceName != null) {
            // Map by resource name for environment variable lookup.
            envVarResourceIdentifierToIdMap.set(createResourceNameKey({resourceName, accountId, awsRegion}), id);
            // Map by resource name and type for general lookup.
            resourceIdentifierToIdMap.set(
                createResourceNameKey({resourceName, resourceType, accountId, awsRegion}),
                id);
        }

        // Map by resource ID and type for general lookup.
        resourceIdentifierToIdMap.set(
            createResourceIdKey({resourceId, resourceType, accountId, awsRegion}),
            id);
        // Map by resource ID for environment variable lookup.
        envVarResourceIdentifierToIdMap.set(createResourceIdKey({resourceId, accountId, awsRegion}), id);
    }

    // Combine all maps and return.
    return {
        resourceIdentifierToIdMap,
        envVarResourceIdentifierToIdMap,
        ...createResourceTypeLookUpMaps(resources) // Include resource-type-specific maps.
    }
}

export default createLookUpMaps;
