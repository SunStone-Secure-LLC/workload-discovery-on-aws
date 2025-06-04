// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import logger from './logger.mjs';
import pThrottle from 'p-throttle';
import {ConfiguredRetryStrategy} from '@smithy/util-retry';
import {customUserAgent} from './config.mjs';
import {
    ServiceCatalogAppRegistry,
    ServiceCatalogAppRegistryClient,
    paginateListApplications
} from '@aws-sdk/client-service-catalog-appregistry';
import {
    Organizations,
    OrganizationsClient,
    paginateListAccounts,
    paginateListAccountsForParent,
    paginateListOrganizationalUnitsForParent
} from "@aws-sdk/client-organizations";
import {APIGateway, APIGatewayClient, paginateGetResources} from '@aws-sdk/client-api-gateway';
import {AppSync} from '@aws-sdk/client-appsync';
import {LambdaClient, paginateListFunctions, paginateListEventSourceMappings} from '@aws-sdk/client-lambda';
import {
    ECSClient,
    ECS,
    paginateListContainerInstances,
    paginateListTasks
} from "@aws-sdk/client-ecs";
import {EKSClient, EKS, paginateListNodegroups} from '@aws-sdk/client-eks';
import {
    EC2,
    EC2Client,
    paginateDescribeSpotInstanceRequests,
    paginateDescribeSpotFleetRequests,
    paginateDescribeTransitGatewayAttachments
} from '@aws-sdk/client-ec2'
import * as R from "ramda";
import {ElasticLoadBalancing} from '@aws-sdk/client-elastic-load-balancing';
import {
    ElasticLoadBalancingV2,
    ElasticLoadBalancingV2Client,
    paginateDescribeTargetGroups
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {IAMClient, paginateListPolicies} from '@aws-sdk/client-iam';
import {STS} from "@aws-sdk/client-sts";
import {fromNodeProviderChain} from '@aws-sdk/credential-providers';
import {AWS, OPENSEARCH, GLOBAL} from './constants.mjs';
import {
    ConfigServiceClient,
    ConfigService,
    paginateListAggregateDiscoveredResources,
    paginateSelectAggregateResourceConfig,
} from '@aws-sdk/client-config-service';
import {
    MediaConnectClient, paginateListFlows
} from '@aws-sdk/client-mediaconnect';
import {
    OpenSearch
} from '@aws-sdk/client-opensearch';
import {
    DynamoDBStreams
} from '@aws-sdk/client-dynamodb-streams'
import {SNSClient, paginateListSubscriptions} from '@aws-sdk/client-sns';
import {memoize} from './utils.mjs';

const RETRY_EXPONENTIAL_RATE = 2;

//
// Throttling logic - ensures that API calls are rate-limited across all clients sharing the same configuration.
// Memoize ensures one throttler instance per unique parameter set.
//

// We want to share throttling limits across instances of clients so we memoize this
// function that each factory function calls to create its throttlers during
// instantiation.
// Memoization ensures that the same throttler is reused for the same parameters, avoiding duplicate throttle limits.
const createThrottler = memoize((name, credentials, region, throttleParams) => {
    return pThrottle(throttleParams);
});

//
// Utility to create a throttled async paginator.
// This wraps an async iterator (paginator) with a throttler to avoid API rate limits.
//

export function throttledPaginator(throttler, paginator) {
    // Wraps an async paginator with a throttler, ensuring rate limits are not exceeded.
    const getPage = throttler(async () => paginator.next());

    return (async function* () {
        while(true) {
            const {done, value} = await getPage();
            if(done) return {done};
            yield value;
        }
    })();
}

//
// ServiceCatalog AppRegistry client factory
// Provides throttled paginator and throttled getApplication.
//

export function createServiceCatalogAppRegistryClient(credentials, region) {
    // Factory for AWS Service Catalog AppRegistry client with built-in throttling and pagination.
    const appRegistryClient = new ServiceCatalogAppRegistry({customUserAgent, region, credentials});

    const paginatorConfig = {
        pageSize: 20,
        client: new ServiceCatalogAppRegistryClient({customUserAgent, region, credentials})
    };

    const listApplicationsPaginatorThrottler = createThrottler('listApplicationsPaginated', credentials, region, {
        limit: 5,
        interval: 1000
    });

    const getApplicationThrottler = createThrottler('getApplication', credentials, region, {
        limit: 5,
        interval: 1000
    });

    // The getApplication function is throttled to avoid hitting API rate limits.
    const getApplication = getApplicationThrottler((application) => {
        return appRegistryClient.getApplication({application});
    });

    const listApplicationsPaginator = paginateListApplications(paginatorConfig, {});

    return {
        async getAllApplications() {
            // Retrieves all applications, using throttling to avoid API rate limits.
            const applications = [];

            for await (const result of throttledPaginator(listApplicationsPaginatorThrottler, listApplicationsPaginator)) {
                for(const {name} of result.applications) {
                    const application = await getApplication(name);
                    applications.push(application)
                }
            }

            return applications;
        }
    }
}

//
// Organizations client factory
// Includes methods to list all accounts, recursively list accounts under an OU, and list only active accounts.
//

export function createOrganizationsClient(credentials, region) {
    // Factory to create Organizations client with throttled paginators for listing accounts and OUs.
    const organizationsClient = new Organizations({customUserAgent, region, credentials});

    const paginatorConfig = {
        pageSize: 20,
        client: new OrganizationsClient({customUserAgent, region, credentials})
    };

    const getAllAccountsThrottler = createThrottler('getAllAccounts', credentials, region, {
        limit: 1,
        interval: 1000
    });

    const getAllFromParentThrottler = createThrottler('getAllFromParent', credentials, region, {
        limit: 1,
        interval: 1000
    });

    async function getAllAccounts() {
        // Uses throttled paginator to gather all accounts in the org.
        const listAccountsPaginator = paginateListAccounts(paginatorConfig, {});

        const accounts = []

        for await (const {Accounts} of throttledPaginator(getAllAccountsThrottler, listAccountsPaginator)) {
            accounts.push(...Accounts);
        }

        return accounts;
    }

    async function getAllAccountsFromParent(ouId) {
        // Recursively gathers all accounts from a given parent OU and its children.
        const ouIds = [ouId];

        // we will do these serially so as not to encounter rate limiting
        for(const id of ouIds) {
            const paginator =
                throttledPaginator(getAllFromParentThrottler, paginateListOrganizationalUnitsForParent(paginatorConfig, {ParentId: id}));
            for await (const {OrganizationalUnits} of paginator) {
                ouIds.push(...OrganizationalUnits.map(x => x.Id));
            }
        }

        const accounts = [];

        for(const id of ouIds) {
            const paginator =
                throttledPaginator(getAllFromParentThrottler, paginateListAccountsForParent(paginatorConfig, {ParentId: id}));
            for await (const {Accounts} of paginator) {
                accounts.push(...Accounts);
            }
        }

        return accounts;
    }

    return {
        async getAllActiveAccountsFromParent(ouId) {
            // Retrieves all ACTIVE accounts (status filter) from a given OU or the org root.
            const [{Roots}, {Organization}] = await Promise.all([
                organizationsClient.listRoots({}),
                organizationsClient.describeOrganization({})
            ]);
            const {Id: rootId} = Roots[0];
            const {MasterAccountId: managementAccountId} = Organization;

            const accounts = await (ouId === rootId ? getAllAccounts() : getAllAccountsFromParent(ouId));

            const activeAccounts = accounts
                .filter(account => account.Status === 'ACTIVE')
                .map(account => {
                    if(account.Id === managementAccountId) {
                        account.isManagementAccount = true;
                    }
                    return account;
                });

            logger.info(`All active accounts from organization unit ${ouId} retrieved, ${activeAccounts.length} retrieved.`);

            return activeAccounts;
        }
    };
}

//
// OpenSearch client factory
// Provides throttled retrieval and description of OpenSearch domains.
//

export function createOpenSearchClient(credentials, region) {
    // Factory for AWS OpenSearch client with throttled describeDomains calls.
    const OpenSearchClient = new OpenSearch({customUserAgent, region, credentials});

    return {
        async getAllOpenSearchDomains() {
            // List all OpenSearch domains (requests for describing them are batched and sent serially to avoid rate limiting).
            const {DomainNames} = await OpenSearchClient.listDomainNames({EngineType: OPENSEARCH});

            const domains = [];

            // The describeDomain API can only handle 5 domain names per request. Also, we send these
            // requests serially to reduce the chance of any rate limiting.
            for(const batch of R.splitEvery(5, DomainNames)) {
                const {DomainStatusList} = await OpenSearchClient.describeDomains({DomainNames: batch.map(x => x.DomainName)})
                domains.push(...DomainStatusList);
            }

            return domains;
        }
    };
}

//
// API Gateway client factory
// Handles throttling for API Gateway resource and method queries.
//

export function createApiGatewayClient(credentials, region) {
    // Factory for API Gateway client with global throttling for resource/method calls.
    const apiGatewayClient = new APIGateway({customUserAgent, region, credentials});

    const apiGatewayPaginatorConfig = {
        pageSize: 100,
        client: new APIGatewayClient({customUserAgent, region, credentials})
    }

    // The API Gateway rate limits are _per account_ so we set the region to global
    const getResourcesThrottler = createThrottler('apiGatewayGetResources', credentials, GLOBAL, {
        limit: 5,
        interval: 2000
    });

    const totalOperationsThrottler = createThrottler('apiGatewayTotalOperations', credentials, GLOBAL, {
        limit: 10,
        interval: 1000
    });

    return {
        getResources: totalOperationsThrottler(getResourcesThrottler(async restApiId => {
            // Paginates and retrieves all resources for a given REST API.
            const getResourcesPaginator = paginateGetResources(apiGatewayPaginatorConfig, {restApiId});

            const apiResources = [];
            for await (const {items} of getResourcesPaginator) {
                apiResources.push(...items);
            }
            return apiResources;
        })),
        getMethod: totalOperationsThrottler(async (httpMethod, resourceId, restApiId) => {
            // Fetches details for a single HTTP method on a resource.
            return apiGatewayClient.getMethod({
                httpMethod, resourceId, restApiId
            });
        }),
        getAuthorizers: totalOperationsThrottler(async restApiId => {
            // Retrieves authorizers for a REST API.
            return apiGatewayClient.getAuthorizers({restApiId})
                .then(R.prop('items'))
        })
    };
}

//
// AppSync client factory
// Handles throttling for listing data sources and resolvers.
//

export function createAppSyncClient(credentials, region) {
    // Factory for AppSync client with throttled listDataSources and listResolvers.
    const appSyncClient = new AppSync({customUserAgent, credentials, region});
    const appSyncListThrottler = createThrottler('appSyncList', credentials, region, {
        limit: 5,
        interval: 1000
    });

    const throttledListDataSources = appSyncListThrottler(({apiId, nextToken}) => appSyncClient.listDataSources({apiId, nextToken}));
    const throttledListResolvers = appSyncListThrottler(({apiId, typeName, nextToken}) => appSyncClient.listResolvers({apiId, typeName, nextToken}));

    return {
        async listDataSources(apiId) {
            // Lists all data sources for a given AppSync API, paginated and throttled.
            const results = [];

            let nextToken = null;
            do {
                const {dataSources, nextToken: nt} = await throttledListDataSources({apiId, nextToken})
                results.push(...dataSources)
                nextToken = nt
            } while (nextToken != null)

            return results
        },

        async listResolvers(apiId, typeName){
            // Lists all resolvers for a given type in an AppSync API, paginated and throttled.
            const results = [];

            let nextToken = null;
            do {
                const {resolvers, nextToken: nt} = await throttledListResolvers({apiId, typeName, nextToken})
                results.push(...resolvers)
                nextToken = nt
            } while (nextToken != null)

            return results
        },
    }
}

//
// Config Service client factory
// Handles complex paginated and throttled queries, including advanced resource queries.
//

export function createConfigServiceClient(credentials, region) {
    // Factory for Config Service client with advanced throttling and retry logic for aggregator queries.
    const configClient = new ConfigService({customUserAgent, credentials, region});

    const paginatorConfig = {
        client: new ConfigServiceClient({customUserAgent, credentials, region}),
        pageSize: 100
    };

    const selectAggregateResourceConfigThrottler = createThrottler(
        'selectAggregateResourceConfig', credentials, region, {
            limit: 8,
            interval: 1000
        }
    );

    const batchGetAggregateResourceConfigThrottler = createThrottler(
        'batchGetAggregateResourceConfig', credentials, region, {
            limit: 15,
            interval: 1000
        }
    );

    const batchGetAggregateResourceConfig = batchGetAggregateResourceConfigThrottler((ConfigurationAggregatorName, ResourceIdentifiers) => {
        // Batch gets config items for a list of resource identifiers.
        return configClient.batchGetAggregateResourceConfig({ConfigurationAggregatorName, ResourceIdentifiers})
    })

    return {
        async getConfigAggregator(aggregatorName) {
            // Retrieves configuration aggregator by name.
            const {ConfigurationAggregators} = await configClient.describeConfigurationAggregators({
                ConfigurationAggregatorNames: [aggregatorName]
            });
            return ConfigurationAggregators[0];
        },
        async getAllAggregatorResources(aggregatorName, {excludes: {resourceTypes: excludedResourceTypes = []}}) {
            // Retrieves all resources for a config aggregator, optionally excluding resource types (using advanced query).
            logger.info('Getting resources with advanced query');
            const excludedResourceTypesSqlList = excludedResourceTypes.map(rt => `'${rt}'`).join(',');
            const excludesResourceTypesWhere = R.isEmpty(excludedResourceTypes) ?
                '' : `WHERE resourceType NOT IN (${excludedResourceTypesSqlList})`;

            const Expression = `SELECT
              *,
              configuration,
              configurationItemStatus,
              relationships,
              supplementaryConfiguration,
              tags
              ${excludesResourceTypesWhere}
            `
            const MAX_RETRIES = 5;

            const paginator = paginateSelectAggregateResourceConfig({
                client: new ConfigServiceClient({
                    customUserAgent,
                    credentials,
                    region,
                    // this code is a critical path so we use a lengthy exponential retry
                    // rate to give it as much chance to succeed in the face of any
                    // throttling errors: 0s -> 2s -> 6s -> 14s -> 30s -> Failure
                    retryStrategy: new ConfiguredRetryStrategy(
                        MAX_RETRIES,
                        attempt => 2000 * (RETRY_EXPONENTIAL_RATE ** attempt)
                    )
                }),
                pageSize: 100
            }, {
                ConfigurationAggregatorName: aggregatorName, Expression
            });

            const resources = []

            for await (const page of throttledPaginator(selectAggregateResourceConfigThrottler, paginator)) {
                resources.push(...R.map(JSON.parse, page.Results));
            }

            logger.info(`${resources.length} resources downloaded from Config advanced query`);
            return resources;
        },
        async getAggregatorResources(aggregatorName, resourceType) {
            // Retrieves resources of a specific type from a config aggregator.
            const resources = [];

            const paginator = paginateListAggregateDiscoveredResources(paginatorConfig,{
                ConfigurationAggregatorName: aggregatorName,
                ResourceType: resourceType
            });

            for await (const {ResourceIdentifiers} of paginator) {
                if(!R.isEmpty(ResourceIdentifiers)) {
                    const {BaseConfigurationItems} = await batchGetAggregateResourceConfig(aggregatorName, ResourceIdentifiers);
                    resources.push(...BaseConfigurationItems);
                }
            }

            return resources;
        },
        async isConfigEnabled() {
            // Checks if AWS Config is enabled for the account (both recorders and delivery channels present).
            const [{ConfigurationRecorders}, {DeliveryChannels}] = await Promise.all([
                configClient.describeConfigurationRecorders(),
                configClient.describeDeliveryChannels()
            ]);

            return !R.isEmpty(ConfigurationRecorders) && !R.isEmpty(DeliveryChannels);
        }
    };
}

//
// Lambda client factory
// Provides methods for listing all Lambda functions and event source mappings.
//

export function createLambdaClient(credentials, region) {
    // Factory for Lambda client with paginated and throttled accessors.
    const lambdaPaginatorConfig = {
        client: new LambdaClient({customUserAgent, region, credentials}),
        pageSize: 100
    };

    return {
        async getAllFunctions() {
            // Gather all Lambda functions for the account/region.
            const functions = [];
            const listFunctions = paginateListFunctions(lambdaPaginatorConfig, {});

            for await (const {Functions} of listFunctions) {
                functions.push(...Functions);
            }
            return functions;
        },
        async listEventSourceMappings(arn) {
            // Retrieves all event source mappings for a given Lambda function ARN.
            const mappings = [];
            const listEventSourceMappingsPaginator = paginateListEventSourceMappings(lambdaPaginatorConfig, {
                FunctionName: arn
            });

            for await (const {EventSourceMappings} of listEventSourceMappingsPaginator) {
                mappings.push(...EventSourceMappings)
            }
            return mappings;
        }
    };
}

//
// EC2 client factory
// Provides access to EC2 regional data, NAT gateways, Spot/Fleet requests, and TGW attachments.
//

export function createEc2Client(credentials, region) {
    // Factory for EC2 client with paginated and throttled accessors.
    const ec2Client = new EC2({customUserAgent, credentials, region});

    const ec2PaginatorConfig = {
        client: new EC2Client({customUserAgent, region, credentials}),
        pageSize: 100
    };

    return {
        async getAllRegions() {
            // Lists all regions available to the account (for multi-region inventory).
            const { Regions } = await ec2Client.describeRegions({});
            return Regions.map(x => ({name: x.RegionName}));
        },
        async getNatGateways(vpcId) {
            // Fetches all NAT Gateways attached to a specific VPC.
            const {NatGateways} = await ec2Client.describeNatGateways({
                    Filter: [
                        {
                            Name: 'vpc-id',
                            Values: [vpcId],
                        },
                    ],
                },
            );
            return NatGateways;
        },
        async getAllSpotInstanceRequests() {
            // Retrieves all EC2 spot instance requests.
            const siPaginator = paginateDescribeSpotInstanceRequests(ec2PaginatorConfig, {});

            const spotInstanceRequests = [];
            for await (const {SpotInstanceRequests} of siPaginator) {
                spotInstanceRequests.push(...SpotInstanceRequests);
            }
            return spotInstanceRequests;
        },
        async getAllSpotFleetRequests() {
            // Retrieves all EC2 spot fleet requests.
            const sfPaginator = paginateDescribeSpotFleetRequests(ec2PaginatorConfig, {});

            const spotFleetRequests = [];

            for await (const {SpotFleetRequestConfigs} of sfPaginator) {
                spotFleetRequests.push(...SpotFleetRequestConfigs);
            }
            return spotFleetRequests;
        },
        async getAllTransitGatewayAttachments(Filters) {
            // Retrieves all Transit Gateway Attachments for the account/region.
            const paginator = paginateDescribeTransitGatewayAttachments(ec2PaginatorConfig, {Filters});
            const attachments = [];
            for await (const {TransitGatewayAttachments} of paginator) {
                attachments.push(...TransitGatewayAttachments);
            }
            return attachments;
        }
    }
}

//
// ECS client factory
// Handles throttling for cluster resource reads. Provides instance and task details.
//

export function createEcsClient(credentials, region) {
    // Factory for ECS client with paginated and throttled accessors.
    const ecsClient = new ECS({customUserAgent, region, credentials});

    const ecsPaginatorConfig = {
        client: new ECSClient({customUserAgent, region, credentials}),
        pageSize: 100
    };

    // describeContainerInstances, describeTasks and listTasks share the same throttling bucket
    const ecsClusterResourceReadThrottler = createThrottler('ecsClusterResourceReadThrottler', credentials, region, {
        limit: 20,
        interval: 1000
    });

    const describeContainerInstances = ecsClusterResourceReadThrottler((cluster, containerInstances) => {
        // Describes ECS container instances in a cluster (throttled).
        return ecsClient.describeContainerInstances({cluster, containerInstances});
    })

    const describeTasks = ecsClusterResourceReadThrottler((cluster, tasks) => {
        // Describes ECS tasks in a cluster (throttled, includes tags).
        return ecsClient.describeTasks({cluster, tasks, include: ['TAGS']});
    })

    return {
        async getAllClusterInstances(clusterArn) {
            // Lists all EC2 instance IDs for container instances in a given ECS cluster.
            const listContainerInstancesPaginator = paginateListContainerInstances(ecsPaginatorConfig, {
                cluster: clusterArn
            });

            const instances = [];

            for await (const {containerInstanceArns} of throttledPaginator(ecsClusterResourceReadThrottler, listContainerInstancesPaginator)) {
                if(!R.isEmpty(containerInstanceArns)) {
                    const {containerInstances} = await describeContainerInstances(clusterArn, containerInstanceArns);
                    instances.push(...containerInstances.map(x => x.ec2InstanceId))
                }
            }
            return instances;
        },
        async getAllServiceTasks(cluster, serviceName) {
            // Lists all ECS tasks for a given service in a cluster.
            const serviceTasks = []
            const listTaskPaginator = paginateListTasks(ecsPaginatorConfig, {
                cluster, serviceName
            });

            for await (const {taskArns} of throttledPaginator(ecsClusterResourceReadThrottler, listTaskPaginator)) {
                if(!R.isEmpty(taskArns)) {
                    const {tasks} = await describeTasks(cluster, taskArns);
                    serviceTasks.push(...tasks);
                }
            }

            return serviceTasks;
        },
        async getAllClusterTasks(cluster) {
            // Lists all ECS tasks in a cluster (includes tags).
            const clusterTasks = []
            const listTaskPaginator = paginateListTasks(ecsPaginatorConfig, {
                cluster, include: ['TAGS']
            });

            for await (const {taskArns} of throttledPaginator(ecsClusterResourceReadThrottler, listTaskPaginator)) {
                if(!R.isEmpty(taskArns)) {
                    const {tasks} = await describeTasks(cluster, taskArns);
                    clusterTasks.push(...tasks);
                }
            }

            return clusterTasks;
        }
    };
}

//
// EKS client factory
// Handles throttling for nodegroup description. Provides full nodegroup inventory.
//

export function createEksClient(credentials, region) {
    // Factory for EKS client with paginated and throttled nodegroup listing and description.
    const eksClient = new EKS({customUserAgent, region, credentials});

    const eksPaginatorConfig = {
        client: new EKSClient({customUserAgent, region, credentials}),
        pageSize: 100
    };
    // this API only has a TPS of 10 so we set it artificially low to avoid rate limiting
    const describeNodegroupThrottler = createThrottler('eksDescribeNodegroup', credentials, region, {
        limit: 5,
        interval: 1000
    });

    return {
        async listNodeGroups(clusterName) {
            // Lists all nodegroups for a given EKS cluster, then describes each nodegroup.
            const ngs = [];
            const listNodegroupsPaginator = paginateListNodegroups(eksPaginatorConfig, {
                clusterName
            });

            for await (const {nodegroups} of listNodegroupsPaginator) {
                const result = await Promise.all(nodegroups.map(describeNodegroupThrottler(async nodegroupName => {
                    const {nodegroup} = await eksClient.describeNodegroup({
                        nodegroupName, clusterName
                    });
                    return nodegroup;
                })));
                ngs.push(...result);
            }

            return ngs;
        }
    }
}

//
// ELB (Classic) client factory
// Handles throttling for describeLoadBalancers.
//

export function createElbClient(credentials, region) {
    // Factory for Classic Elastic Load Balancer client with throttled describeLoadBalancers calls.
    const elbClient = new ElasticLoadBalancing({customUserAgent, credentials, region});

    // ELB rate limits for describe* calls are shared amongst all LB types
    const elbDescribeThrottler = createThrottler('elbDescribe', credentials, region, {
        limit: 10,
        interval: 1000
    });

    return {
        getLoadBalancerInstances: elbDescribeThrottler(async resourceId => {
            // Retrieves all EC2 instance IDs for a given Load Balancer.
            const lb = await elbClient.describeLoadBalancers({
                LoadBalancerNames: [resourceId],
            });

            const instances = lb.LoadBalancerDescriptions[0]?.Instances ?? [];

            return instances.map(x => x.InstanceId);
        })
    };
}

//
// ELBv2 client factory
// Handles throttling for describing target health and listing target groups.
//

export function createElbV2Client(credentials, region) {
    // Factory for ALB/NLB client with paginated and throttled accessors.
    const elbClientV2 = new ElasticLoadBalancingV2({customUserAgent, credentials, region});
    const elbV2PaginatorConfig = {
        client: new ElasticLoadBalancingV2Client({customUserAgent, region, credentials}),
        pageSize: 100
    };

    // ELB rate limits for describe* calls are shared amongst all LB types
    const elbDescribeThrottler = createThrottler('elbDescribe', credentials, region, {
        limit: 10,
        interval: 1000
    });

    return {
        describeTargetHealth: elbDescribeThrottler(async arn => {
            // Retrieves target health for a given Target Group ARN.
            const {TargetHealthDescriptions = []} = await elbClientV2.describeTargetHealth({
                TargetGroupArn: arn
            });
            return TargetHealthDescriptions;
        }),
        getAllTargetGroups: elbDescribeThrottler(async () => {
            // Lists all target groups (ALB/NLB) in the account/region.
            const tgPaginator = paginateDescribeTargetGroups(elbV2PaginatorConfig, {});

            const targetGroups = [];
            for await (const {TargetGroups} of tgPaginator) {
                targetGroups.push(...TargetGroups);
            }

            return targetGroups;
        }),
    };
}

//
// IAM client factory
// Provides paginated and throttled method for listing all attached AWS managed policies.
//

export function createIamClient(credentials, region) {
    // Factory for IAM client with paginated and throttled method for listing policies.
    const iamPaginatorConfig = {
        client: new IAMClient({customUserAgent, region, credentials}),
        pageSize: 100
    };

    return {
        async getAllAttachedAwsManagedPolices() {
            // Lists all attached AWS managed IAM policies.
            const listPoliciesPaginator = paginateListPolicies(iamPaginatorConfig, {
                Scope: AWS.toUpperCase(), OnlyAttached: true});

            const managedPolices = [];
            for await (const {Policies} of listPoliciesPaginator) {
                managedPolices.push(...Policies);
            }

            return managedPolices;
        }
    };
}

//
// MediaConnect client factory
// Provides paginated and throttled method for listing flows.
//

export function createMediaConnectClient(credentials, region) {
    // Factory for MediaConnect client with throttled paginator for flows.
    const listFlowsPaginatorConfig = {
        client: new MediaConnectClient({customUserAgent, credentials, region}),
        pageSize: 20
    }

    const listFlowsPaginatorThrottler = createThrottler('mediaConnectListThrottler', credentials, region, {
        limit: 5,
        interval: 1000
    });

    return {
        async getAllFlows() {
            // Lists all MediaConnect flows in the account/region.
            const listFlowsPaginator = paginateListFlows(listFlowsPaginatorConfig, {});

            const flows = [];

            for await (const {Flows} of throttledPaginator(listFlowsPaginatorThrottler, listFlowsPaginator)) {
                flows.push(...Flows);
            }

            return flows;
        }
    };
}

//
// SNS client factory
// Provides paginated and throttled method for listing all subscriptions.
//

export function createSnsClient(credentials, region) {
    // Factory for SNS client with paginated and throttled method for listing subscriptions.
    const snsPaginatorConfig = {
        client: new SNSClient({customUserAgent, credentials, region}),
        pageSize: 100
    }

    return {
        async getAllSubscriptions() {
            // Lists all SNS subscriptions in the account/region.
            const listSubscriptionsPaginator = paginateListSubscriptions(snsPaginatorConfig, {});

            const subscriptions = [];
            for await (const {Subscriptions} of listSubscriptionsPaginator) {
                subscriptions.push(...Subscriptions);
            }

            return subscriptions;
        }
    }
}

//
// STS client factory
// Provides methods to assume role and get credentials using the default provider chain.
//

export function createStsClient(credentials, region) {
    // Factory for STS client with methods for assuming a role and getting current credentials.
    const params = (credentials == null && region == null) ? {} : {credentials, region}
    const sts = new STS({...params, customUserAgent});

    const CredentialsProvider = fromNodeProviderChain();

    return {
        async getCredentials(RoleArn) {
            // Assumes the given role and returns temporary credentials.
            const {Credentials} = await sts.assumeRole({
                    RoleArn,
                    RoleSessionName: 'discovery'
                }
            );

            return {accessKeyId: Credentials.AccessKeyId, secretAccessKey: Credentials.SecretAccessKey, sessionToken: Credentials.SessionToken};
        },
        async getCurrentCredentials() {
            // Retrieves credentials from the default provider chain.
            return CredentialsProvider();
        }
    };
}

//
// DynamoDB Streams client factory
// Handles throttling for describeStream API.
//

export function createDynamoDBStreamsClient(credentials, region) {
    // Factory for DynamoDB Streams client with throttled describeStream calls.
    const dynamoDBStreamsClient = new DynamoDBStreams({customUserAgent, region, credentials});

    // this API only has a TPS of 10 so we set it artificially low to avoid rate limiting
    const describeStreamThrottler = createThrottler('dynamoDbDescribeStream', credentials, region, {
        limit: 8,
        interval: 1000
    });

    const describeStream = describeStreamThrottler(streamArn => dynamoDBStreamsClient.describeStream({StreamArn: streamArn}));

    return {
        async describeStream(streamArn) {
            // Describes a DynamoDB stream by ARN, throttled.
            const {StreamDescription} = await describeStream(streamArn);
            return StreamDescription;
        }
    }
}

//
// Aggregator factory: returns all client creators above as properties.
//

export function createAwsClient() {
    // Returns an object with all AWS client creation functions for use in discovery processes.
    return {
        createServiceCatalogAppRegistryClient,
        createOrganizationsClient,
        createApiGatewayClient,
        createAppSyncClient,
        createConfigServiceClient,
        createDynamoDBStreamsClient,
        createEc2Client,
        createEcsClient,
        createEksClient,
        createLambdaClient,
        createElbClient,
        createElbV2Client,
        createIamClient,
        createMediaConnectClient,
        createStsClient,
        createOpenSearchClient,
        createSnsClient
    }
};
