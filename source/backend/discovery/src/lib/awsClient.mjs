// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module provides a centralized factory for creating AWS SDK clients.
 * It encapsulates common patterns such as throttling, pagination, and custom user agents
 * to ensure efficient and compliant interaction with various AWS services.
 * Each client factory function returns an object with methods tailored for specific discovery operations.
 */

import logger from './logger.mjs'; // Imports the logging utility.
import pThrottle from 'p-throttle'; // Imports p-throttle for rate-limiting asynchronous functions.
import {ConfiguredRetryStrategy} from '@smithy/util-retry'; // Imports retry strategy for AWS SDK clients.
import {customUserAgent} from './config.mjs'; // Imports custom user agent string from application configuration.
import {
    ServiceCatalogAppRegistry,
    ServiceCatalogAppRegistryClient,
    paginateListApplications
} from '@aws-sdk/client-service-catalog-appregistry'; // AWS SDK clients and paginators for Service Catalog AppRegistry.
import {
    Organizations,
    OrganizationsClient,
    paginateListAccounts,
    paginateListAccountsForParent,
    paginateListOrganizationalUnitsForParent
} from "@aws-sdk/client-organizations"; // AWS SDK clients and paginators for AWS Organizations.
import {APIGateway, APIGatewayClient, paginateGetResources} from '@aws-sdk/client-api-gateway'; // AWS SDK clients and paginators for API Gateway.
import {AppSync} from '@aws-sdk/client-appsync'; // AWS SDK client for AppSync.
import {LambdaClient, paginateListFunctions, paginateListEventSourceMappings} from '@aws-sdk/client-lambda'; // AWS SDK clients and paginators for Lambda.
import {
    ECSClient,
    ECS,
    paginateListContainerInstances,
    paginateListTasks
} from "@aws-sdk/client-ecs"; // AWS SDK clients and paginators for ECS.
import {EKSClient, EKS, paginateListNodegroups} from '@aws-sdk/client-eks'; // AWS SDK clients and paginators for EKS.
import {
    EC2,
    EC2Client,
    paginateDescribeSpotInstanceRequests,
    paginateDescribeSpotFleetRequests,
    paginateDescribeTransitGatewayAttachments
} from '@aws-sdk/client-ec2' // AWS SDK clients and paginators for EC2.
import * as R from "ramda"; // Imports Ramda for functional programming utilities.
import {ElasticLoadBalancing} from '@aws-sdk/client-elastic-load-balancing'; // AWS SDK client for Classic ELB.
import {
    ElasticLoadBalancingV2,
    ElasticLoadBalancingV2Client,
    paginateDescribeTargetGroups
} from "@aws-sdk/client-elastic-load-balancing-v2"; // AWS SDK clients and paginators for ELBv2 (ALB/NLB).
import {IAMClient, paginateListPolicies} from '@aws-sdk/client-iam'; // AWS SDK client and paginator for IAM.
import {STS} from "@aws-sdk/client-sts"; // AWS SDK client for STS (Security Token Service).
import {fromNodeProviderChain} from '@aws-sdk/credential-providers'; // Credential provider for Node.js environments.
import {AWS, OPENSEARCH, GLOBAL} from './constants.mjs'; // Imports constants for AWS service names and global region.
import {
    ConfigServiceClient,
    ConfigService,
    paginateListAggregateDiscoveredResources,
    paginateSelectAggregateResourceConfig,
} from '@aws-sdk/client-config-service'; // AWS SDK clients and paginators for AWS Config.
import {
    MediaConnectClient, paginateListFlows
} from '@aws-sdk/client-mediaconnect'; // AWS SDK client and paginator for MediaConnect.
import {
    OpenSearch
} from '@aws-sdk/client-opensearch'; // AWS SDK client for OpenSearch.
import {
    DynamoDBStreams
} from '@aws-sdk/client-dynamodb-streams' // AWS SDK client for DynamoDB Streams.
import {SNSClient, paginateListSubscriptions} from '@aws-sdk/client-sns'; // AWS SDK client and paginator for SNS.
import {memoize} from './utils.mjs'; // Imports memoization utility.

// Defines the exponential rate for retries in case of API throttling or errors.
const RETRY_EXPONENTIAL_RATE = 2;

/**
 * Creates a memoized throttler instance.
 * This function ensures that a single throttler instance is reused for a given set of parameters
 * (name, credentials, region, throttleParams), preventing the creation of redundant throttlers
 * and ensuring consistent rate limiting across different parts of the application.
 * @param {string} name - A unique name for the throttler.
 * @param {object} credentials - AWS credentials.
 * @param {string} region - AWS region.
 * @param {object} throttleParams - Parameters for p-throttle (limit, interval).
 * @returns {function} A throttler function.
 */
const createThrottler = memoize((name, credentials, region, throttleParams) => {
    return pThrottle(throttleParams);
});

/**
 * Wraps an async paginator with a throttler.
 * This utility function takes a throttler and an async iterator (paginator)
 * and returns a new async iterator that respects the rate limits defined by the throttler.
 * This is crucial for preventing API rate limiting errors when fetching large datasets.
 * @param {function} throttler - The throttler function created by `createThrottler`.
 * @param {AsyncIterator} paginator - The AWS SDK paginator (async iterator) to be throttled.
 * @returns {AsyncGenerator} An async generator that yields pages from the paginator, respecting throttling.
 */
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

/**
 * Factory function for creating an AWS Service Catalog AppRegistry client.
 * Provides methods for listing and retrieving application resources with built-in throttling and pagination.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with Service Catalog AppRegistry.
 */
export function createServiceCatalogAppRegistryClient(credentials, region) {
    // Initializes the Service Catalog AppRegistry client with custom user agent, region, and credentials.
    const appRegistryClient = new ServiceCatalogAppRegistry({customUserAgent, region, credentials});

    // Configuration for the paginator, including page size and the client instance.
    const paginatorConfig = {
        pageSize: 20,
        client: new ServiceCatalogAppRegistryClient({customUserAgent, region, credentials})
    };

    // Creates a throttler specifically for the `listApplications` paginator.
    const listApplicationsPaginatorThrottler = createThrottler('listApplicationsPaginated', credentials, region, {
        limit: 5, // Allows 5 calls per interval.
        interval: 1000 // Interval of 1000ms (1 second).
    });

    // Creates a throttler specifically for the `getApplication` API call.
    const getApplicationThrottler = createThrottler('getApplication', credentials, region, {
        limit: 5, // Allows 5 calls per interval.
        interval: 1000 // Interval of 1000ms (1 second).
    });

    // Wraps the `getApplication` API call with the defined throttler.
    const getApplication = getApplicationThrottler((application) => {
        return appRegistryClient.getApplication({application});
    });

    // Initializes the paginator for listing applications.
    const listApplicationsPaginator = paginateListApplications(paginatorConfig, {});

    return {
        /**
         * Retrieves all applications from Service Catalog AppRegistry.
         * It uses a throttled paginator to iterate through all application pages
         * and then fetches details for each application using a throttled `getApplication` call.
         * @returns {Promise<Array>} A promise that resolves to an array of application objects.
         */
        async getAllApplications() {
            const applications = [];

            // Iterates through pages of applications, applying throttling.
            for await (const result of throttledPaginator(listApplicationsPaginatorThrottler, listApplicationsPaginator)) {
                // For each application name in the result, fetch its full details.
                for(const {name} of result.applications) {
                    const application = await getApplication(name);
                    applications.push(application)
                }
            }

            return applications;
        }
    }
}

/**
 * Factory function for creating an AWS Organizations client.
 * Provides methods to list accounts within an organization, including recursive listing
 * under Organizational Units (OUs) and filtering for active accounts.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with AWS Organizations.
 */
export function createOrganizationsClient(credentials, region) {
    // Initializes the Organizations client with custom user agent, region, and credentials.
    const organizationsClient = new Organizations({customUserAgent, region, credentials});

    // Configuration for the paginator, including page size and the client instance.
    const paginatorConfig = {
        pageSize: 20,
        client: new OrganizationsClient({customUserAgent, region, credentials})
    };

    // Creates a throttler for `listAccounts` paginator.
    const getAllAccountsThrottler = createThrottler('getAllAccounts', credentials, region, {
        limit: 1, // Allows 1 call per interval (Organizations APIs are often heavily throttled).
        interval: 1000
    });

    // Creates a throttler for `listAccountsForParent` and `listOrganizationalUnitsForParent` paginators.
    const getAllFromParentThrottler = createThrottler('getAllFromParent', credentials, region, {
        limit: 1, // Allows 1 call per interval.
        interval: 1000
    });

    /**
     * Retrieves all accounts within the AWS Organization.
     * @returns {Promise<Array>} A promise that resolves to an array of account objects.
     */
    async function getAllAccounts() {
        const listAccountsPaginator = paginateListAccounts(paginatorConfig, {});
        const accounts = []
        for await (const {Accounts} of throttledPaginator(getAllAccountsThrottler, listAccountsPaginator)) {
            accounts.push(...Accounts);
        }
        return accounts;
    }

    /**
     * Recursively retrieves all accounts under a given Organizational Unit (OU) or root.
     * It first lists all OUs under the parent, then lists accounts for each OU.
     * @param {string} ouId - The ID of the Organizational Unit or root to start from.
     * @returns {Promise<Array>} A promise that resolves to an array of account objects.
     */
    async function getAllAccountsFromParent(ouId) {
        const ouIds = [ouId]; // Start with the initial OU ID.

        // Recursively gather all Organizational Unit IDs under the parent.
        // These are processed serially to respect rate limits.
        for(const id of ouIds) {
            const paginator =
                throttledPaginator(getAllFromParentThrottler, paginateListOrganizationalUnitsForParent(paginatorConfig, {ParentId: id}));
            for await (const {OrganizationalUnits} of paginator) {
                ouIds.push(...OrganizationalUnits.map(x => x.Id)); // Add discovered OUs to the list to be processed.
            }
        }

        const accounts = [];

        // For each discovered OU ID, list all accounts within it.
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
        /**
         * Retrieves all active accounts from a specified Organizational Unit (OU) or the organization root.
         * It also identifies the management account if present.
         * @param {string} ouId - The ID of the Organizational Unit or the organization root ID.
         * @returns {Promise<Array>} A promise that resolves to an array of active account objects.
         */
        async getAllActiveAccountsFromParent(ouId) {
            // Fetch organization roots and description to identify the management account.
            const [{Roots}, {Organization}] = await Promise.all([
                organizationsClient.listRoots({}),
                organizationsClient.describeOrganization({})
            ]);
            const {Id: rootId} = Roots[0];
            const {MasterAccountId: managementAccountId} = Organization;

            // Get all accounts, either from the root or a specific OU.
            const accounts = await (ouId === rootId ? getAllAccounts() : getAllAccountsFromParent(ouId));

            // Filter for active accounts and mark the management account.
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

/**
 * Factory function for creating an AWS OpenSearch client.
 * Provides methods for retrieving and describing OpenSearch domains with throttling.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with OpenSearch.
 */
export function createOpenSearchClient(credentials, region) {
    // Initializes the OpenSearch client with custom user agent, region, and credentials.
    const OpenSearchClient = new OpenSearch({customUserAgent, region, credentials});

    return {
        /**
         * Lists all OpenSearch domains and retrieves their detailed status.
         * Requests for describing domains are batched and sent serially to avoid rate limiting.
         * @returns {Promise<Array>} A promise that resolves to an array of OpenSearch domain status objects.
         */
        async getAllOpenSearchDomains() {
            // Lists all domain names of type OpenSearch.
            const {DomainNames} = await OpenSearchClient.listDomainNames({EngineType: OPENSEARCH});

            const domains = [];

            // The describeDomain API can only handle 5 domain names per request.
            // Requests are sent serially to reduce the chance of rate limiting.
            for(const batch of R.splitEvery(5, DomainNames)) {
                // Maps each domain name in the batch to its full domain status.
                const {DomainStatusList} = await OpenSearchClient.describeDomains({DomainNames: batch.map(x => x.DomainName)})
                domains.push(...DomainStatusList);
            }

            return domains;
        }
    };
}

/**
 * Factory function for creating an AWS API Gateway client.
 * Handles throttling for API Gateway resource, method, and authorizer queries.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with API Gateway.
 */
export function createApiGatewayClient(credentials, region) {
    // Initializes the API Gateway client with custom user agent, region, and credentials.
    const apiGatewayClient = new APIGateway({customUserAgent, region, credentials});

    // Configuration for the API Gateway paginator.
    const apiGatewayPaginatorConfig = {
        pageSize: 100,
        client: new APIGatewayClient({customUserAgent, region, credentials})
    }

    // Creates a throttler for `getResources` calls. API Gateway rate limits are per account, so region is set to GLOBAL.
    const getResourcesThrottler = createThrottler('apiGatewayGetResources', credentials, GLOBAL, {
        limit: 5, // Allows 5 calls per interval.
        interval: 2000 // Interval of 2000ms (2 seconds).
    });

    // Creates a throttler for all API Gateway operations to ensure overall rate limits are respected.
    const totalOperationsThrottler = createThrottler('apiGatewayTotalOperations', credentials, GLOBAL, {
        limit: 10, // Allows 10 calls per interval.
        interval: 1000 // Interval of 1000ms (1 second).
    });

    return {
        /**
         * Retrieves all resources for a given REST API.
         * The operation is throttled and paginated.
         * @param {string} restApiId - The ID of the REST API.
         * @returns {Promise<Array>} A promise that resolves to an array of API Gateway resource objects.
         */
        getResources: totalOperationsThrottler(getResourcesThrottler(async restApiId => {
            const getResourcesPaginator = paginateGetResources(apiGatewayPaginatorConfig, {restApiId});
            const apiResources = [];
            for await (const {items} of getResourcesPaginator) {
                apiResources.push(...items);
            }
            return apiResources;
        })),
        /**
         * Fetches details for a single HTTP method on a specific resource within a REST API.
         * The operation is throttled.
         * @param {string} httpMethod - The HTTP method (e.g., 'GET', 'POST').
         * @param {string} resourceId - The ID of the resource.
         * @param {string} restApiId - The ID of the REST API.
         * @returns {Promise<object>} A promise that resolves to the method details.
         */
        getMethod: totalOperationsThrottler(async (httpMethod, resourceId, restApiId) => {
            return apiGatewayClient.getMethod({
                httpMethod, resourceId, restApiId
            });
        }),
        /**
         * Retrieves all authorizers for a given REST API.
         * The operation is throttled.
         * @param {string} restApiId - The ID of the REST API.
         * @returns {Promise<Array>} A promise that resolves to an array of authorizer objects.
         */
        getAuthorizers: totalOperationsThrottler(async restApiId => {
            return apiGatewayClient.getAuthorizers({restApiId})
                .then(R.prop('items')) // Extracts the 'items' property from the response.
        })
    };
}

/**
 * Factory function for creating an AWS AppSync client.
 * Provides throttled methods for listing data sources and resolvers.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with AppSync.
 */
export function createAppSyncClient(credentials, region) {
    // Initializes the AppSync client with custom user agent, credentials, and region.
    const appSyncClient = new AppSync({customUserAgent, credentials, region});
    // Creates a throttler for AppSync list operations.
    const appSyncListThrottler = createThrottler('appSyncList', credentials, region, {
        limit: 5, // Allows 5 calls per interval.
        interval: 1000 // Interval of 1000ms (1 second).
    });

    // Wraps `listDataSources` and `listResolvers` API calls with the defined throttler.
    const throttledListDataSources = appSyncListThrottler(({apiId, nextToken}) => appSyncClient.listDataSources({apiId, nextToken}));
    const throttledListResolvers = appSyncListThrottler(({apiId, typeName, nextToken}) => appSyncClient.listResolvers({apiId, typeName, nextToken}));

    return {
        /**
         * Lists all data sources for a given AppSync API.
         * The operation is paginated and throttled.
         * @param {string} apiId - The ID of the AppSync API.
         * @returns {Promise<Array>} A promise that resolves to an array of AppSync data source objects.
         */
        async listDataSources(apiId) {
            const results = [];
            let nextToken = null;
            do {
                const {dataSources, nextToken: nt} = await throttledListDataSources({apiId, nextToken})
                results.push(...dataSources)
                nextToken = nt
            } while (nextToken != null)
            return results
        },

        /**
         * Lists all resolvers for a given type in an AppSync API.
         * The operation is paginated and throttled.
         * @param {string} apiId - The ID of the AppSync API.
         * @param {string} typeName - The name of the type for which to list resolvers.
         * @returns {Promise<Array>} A promise that resolves to an array of AppSync resolver objects.
         */
        async listResolvers(apiId, typeName){
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

/**
 * Factory function for creating an AWS Config Service client.
 * Provides methods for retrieving configuration aggregators and resources,
 * including advanced queries with custom retry strategies.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with AWS Config.
 */
export function createConfigServiceClient(credentials, region) {
    // Initializes the Config Service client.
    const configClient = new ConfigService({customUserAgent, credentials, region});

    // Configuration for Config Service paginators.
    const paginatorConfig = {
        client: new ConfigServiceClient({customUserAgent, credentials, region}),
        pageSize: 100
    };

    // Creates a throttler for `selectAggregateResourceConfig` API calls.
    const selectAggregateResourceConfigThrottler = createThrottler(
        'selectAggregateResourceConfig', credentials, region, {
            limit: 8, // Allows 8 calls per interval.
            interval: 1000 // Interval of 1000ms (1 second).
        }
    );

    // Creates a throttler for `batchGetAggregateResourceConfig` API calls.
    const batchGetAggregateResourceConfigThrottler = createThrottler(
        'batchGetAggregateResourceConfig', credentials, region, {
            limit: 15, // Allows 15 calls per interval.
            interval: 1000 // Interval of 1000ms (1 second).
        }
    );

    // Wraps `batchGetAggregateResourceConfig` API call with the defined throttler.
    const batchGetAggregateResourceConfig = batchGetAggregateResourceConfigThrottler((ConfigurationAggregatorName, ResourceIdentifiers) => {
        return configClient.batchGetAggregateResourceConfig({ConfigurationAggregatorName, ResourceIdentifiers})
    })

    return {
        /**
         * Retrieves a specific configuration aggregator by its name.
         * @param {string} aggregatorName - The name of the configuration aggregator.
         * @returns {Promise<object>} A promise that resolves to the configuration aggregator object.
         */
        async getConfigAggregator(aggregatorName) {
            const {ConfigurationAggregators} = await configClient.describeConfigurationAggregators({
                ConfigurationAggregatorNames: [aggregatorName]
            });
            return ConfigurationAggregators[0];
        },
        /**
         * Retrieves all resources from a specified configuration aggregator using an advanced query.
         * Optionally excludes certain resource types.
         * Includes a robust exponential retry strategy for critical path operations.
         * @param {string} aggregatorName - The name of the configuration aggregator.
         * @param {object} options - Options object, e.g., `{ excludes: { resourceTypes: ['AWS::EC2::Instance'] } }`.
         * @returns {Promise<Array>} A promise that resolves to an array of resource configuration items.
         */
        async getAllAggregatorResources(aggregatorName, {excludes: {resourceTypes: excludedResourceTypes = []}}) {
            logger.info('Getting resources with advanced query');
            // Constructs the SQL WHERE clause for excluding resource types.
            const excludedResourceTypesSqlList = excludedResourceTypes.map(rt => `'${rt}'`).join(',');
            const excludesResourceTypesWhere = R.isEmpty(excludedResourceTypes) ?
                '' : `WHERE resourceType NOT IN (${excludedResourceTypesSqlList})`;

            // Defines the SQL expression for the advanced query.
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

            // Initializes the paginator for `selectAggregateResourceConfig` with a custom retry strategy.
            const paginator = paginateSelectAggregateResourceConfig({
                client: new ConfigServiceClient({
                    customUserAgent,
                    credentials,
                    region,
                    // This retry strategy is crucial for critical paths, providing exponential backoff
                    // to handle throttling errors gracefully: 0s -> 2s -> 6s -> 14s -> 30s -> Failure.
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

            // Iterates through the paginated results, parsing each JSON result.
            for await (const page of throttledPaginator(selectAggregateResourceConfigThrottler, paginator)) {
                resources.push(...R.map(JSON.parse, page.Results));
            }

            logger.info(`${resources.length} resources downloaded from Config advanced query`);
            return resources;
        },
        /**
         * Retrieves resources of a specific type from a configuration aggregator.
         * Uses `listAggregateDiscoveredResources` and then `batchGetAggregateResourceConfig`.
         * @param {string} aggregatorName - The name of the configuration aggregator.
         * @param {string} resourceType - The type of resource to retrieve (e.g., 'AWS::EC2::Instance').
         * @returns {Promise<Array>} A promise that resolves to an array of resource configuration items.
         */
        async getAggregatorResources(aggregatorName, resourceType) {
            const resources = [];

            // Initializes the paginator for listing discovered resources.
            const paginator = paginateListAggregateDiscoveredResources(paginatorConfig,{
                ConfigurationAggregatorName: aggregatorName,
                ResourceType: resourceType
            });

            // Iterates through resource identifiers and then batch-gets their configurations.
            for await (const {ResourceIdentifiers} of paginator) {
                if(!R.isEmpty(ResourceIdentifiers)) {
                    const {BaseConfigurationItems} = await batchGetAggregateResourceConfig(aggregatorName, ResourceIdentifiers);
                    resources.push(...BaseConfigurationItems);
                }
            }

            return resources;
        },
        /**
         * Checks if AWS Config is enabled in the account.
         * This is determined by checking for the presence of both configuration recorders and delivery channels.
         * @returns {Promise<boolean>} A promise that resolves to true if Config is enabled, false otherwise.
         */
        async isConfigEnabled() {
            const [{ConfigurationRecorders}, {DeliveryChannels}] = await Promise.all([
                configClient.describeConfigurationRecorders(),
                configClient.describeDeliveryChannels()
            ]);

            return !R.isEmpty(ConfigurationRecorders) && !R.isEmpty(DeliveryChannels);
        }
    };
}

/**
 * Factory function for creating an AWS Lambda client.
 * Provides methods for listing all Lambda functions and their event source mappings.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with AWS Lambda.
 */
export function createLambdaClient(credentials, region) {
    // Configuration for Lambda paginators.
    const lambdaPaginatorConfig = {
        client: new LambdaClient({customUserAgent, region, credentials}),
        pageSize: 100
    };

    return {
        /**
         * Retrieves all Lambda functions for the account/region.
         * @returns {Promise<Array>} A promise that resolves to an array of Lambda function objects.
         */
        async getAllFunctions() {
            const functions = [];
            const listFunctions = paginateListFunctions(lambdaPaginatorConfig, {});

            for await (const {Functions} of listFunctions) {
                functions.push(...Functions);
            }
            return functions;
        },
        /**
         * Retrieves all event source mappings for a given Lambda function ARN.
         * @param {string} arn - The ARN of the Lambda function.
         * @returns {Promise<Array>} A promise that resolves to an array of event source mapping objects.
         */
        async listEventSourceMappings(arn) {
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

/**
 * Factory function for creating an AWS EC2 client.
 * Provides methods to retrieve regional data, NAT gateways, Spot/Fleet requests, and Transit Gateway attachments.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with AWS EC2.
 */
export function createEc2Client(credentials, region) {
    // Initializes the EC2 client.
    const ec2Client = new EC2({customUserAgent, credentials, region});

    // Configuration for EC2 paginators.
    const ec2PaginatorConfig = {
        client: new EC2Client({customUserAgent, region, credentials}),
        pageSize: 100
    };

    return {
        /**
         * Lists all AWS regions available to the account.
         * Useful for multi-region inventory and discovery.
         * @returns {Promise<Array>} A promise that resolves to an array of region objects.
         */
        async getAllRegions() {
            const { Regions } = await ec2Client.describeRegions({});
            return Regions.map(x => ({name: x.RegionName}));
        },
        /**
         * Fetches all NAT Gateways attached to a specific VPC.
         * @param {string} vpcId - The ID of the VPC.
         * @returns {Promise<Array>} A promise that resolves to an array of NAT Gateway objects.
         */
        async getNatGateways(vpcId) {
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
        /**
         * Retrieves all EC2 Spot Instance requests in the account/region.
         * @returns {Promise<Array>} A promise that resolves to an array of Spot Instance request objects.
         */
        async getAllSpotInstanceRequests() {
            const siPaginator = paginateDescribeSpotInstanceRequests(ec2PaginatorConfig, {});
            const spotInstanceRequests = [];
            for await (const {SpotInstanceRequests} of siPaginator) {
                spotInstanceRequests.push(...SpotInstanceRequests);
            }
            return spotInstanceRequests;
        },
        /**
         * Retrieves all EC2 Spot Fleet requests in the account/region.
         * @returns {Promise<Array>} A promise that resolves to an array of Spot Fleet request configuration objects.
         */
        async getAllSpotFleetRequests() {
            const sfPaginator = paginateDescribeSpotFleetRequests(ec2PaginatorConfig, {});
            const spotFleetRequests = [];
            for await (const {SpotFleetRequestConfigs} of sfPaginator) {
                spotFleetRequests.push(...SpotFleetRequestConfigs);
            }
            return spotFleetRequests;
        },
        /**
         * Retrieves all Transit Gateway Attachments for the account/region, optionally filtered.
         * @param {Array<object>} Filters - An array of filters to apply to the request.
         * @returns {Promise<Array>} A promise that resolves to an array of Transit Gateway Attachment objects.
         */
        async getAllTransitGatewayAttachments(Filters) {
            const paginator = paginateDescribeTransitGatewayAttachments(ec2PaginatorConfig, {Filters});
            const attachments = [];
            for await (const {TransitGatewayAttachments} of paginator) {
                attachments.push(...TransitGatewayAttachments);
            }
            return attachments;
        }
    }
}

/**
 * Factory function for creating an AWS ECS client.
 * Provides methods for retrieving container instance and task details with throttling.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with AWS ECS.
 */
export function createEcsClient(credentials, region) {
    // Initializes the ECS client.
    const ecsClient = new ECS({customUserAgent, region, credentials});

    // Configuration for ECS paginators.
    const ecsPaginatorConfig = {
        client: new ECSClient({customUserAgent, region, credentials}),
        pageSize: 100
    };

    // Creates a throttler for ECS cluster resource read operations (describeContainerInstances, describeTasks, listTasks).
    // These APIs share the same throttling bucket.
    const ecsClusterResourceReadThrottler = createThrottler('ecsClusterResourceReadThrottler', credentials, region, {
        limit: 20, // Allows 20 calls per interval.
        interval: 1000 // Interval of 1000ms (1 second).
    });

    // Wraps `describeContainerInstances` API call with the defined throttler.
    const describeContainerInstances = ecsClusterResourceReadThrottler((cluster, containerInstances) => {
        return ecsClient.describeContainerInstances({cluster, containerInstances});
    })

    // Wraps `describeTasks` API call with the defined throttler, including tags.
    const describeTasks = ecsClusterResourceReadThrottler((cluster, tasks) => {
        return ecsClient.describeTasks({cluster, tasks, include: ['TAGS']});
    })

    return {
        /**
         * Lists all EC2 instance IDs for container instances within a given ECS cluster.
         * @param {string} clusterArn - The ARN of the ECS cluster.
         * @returns {Promise<Array>} A promise that resolves to an array of EC2 instance IDs.
         */
        async getAllClusterInstances(clusterArn) {
            const listContainerInstancesPaginator = paginateListContainerInstances(ecsPaginatorConfig, {
                cluster: clusterArn
            });

            const instances = [];

            // Iterates through container instance ARNs and describes them to get EC2 instance IDs.
            for await (const {containerInstanceArns} of throttledPaginator(ecsClusterResourceReadThrottler, listContainerInstancesPaginator)) {
                if(!R.isEmpty(containerInstanceArns)) {
                    const {containerInstances} = await describeContainerInstances(clusterArn, containerInstanceArns);
                    instances.push(...containerInstances.map(x => x.ec2InstanceId))
                }
            }
            return instances;
        },
        /**
         * Lists all ECS tasks for a given service within a cluster.
         * Includes task details and tags.
         * @param {string} cluster - The name or ARN of the ECS cluster.
         * @param {string} serviceName - The name of the ECS service.
         * @returns {Promise<Array>} A promise that resolves to an array of ECS task objects.
         */
        async getAllServiceTasks(cluster, serviceName) {
            const serviceTasks = []
            const listTaskPaginator = paginateListTasks(ecsPaginatorConfig, {
                cluster, serviceName
            });

            // Iterates through task ARNs and describes them to get full task details.
            for await (const {taskArns} of throttledPaginator(ecsClusterResourceReadThrottler, listTaskPaginator)) {
                if(!R.isEmpty(taskArns)) {
                    const {tasks} = await describeTasks(cluster, taskArns);
                    serviceTasks.push(...tasks);
                }
            }

            return serviceTasks;
        },
        /**
         * Lists all ECS tasks in a cluster, including their tags.
         * @param {string} cluster - The name or ARN of the ECS cluster.
         * @returns {Promise<Array>} A promise that resolves to an array of ECS task objects.
         */
        async getAllClusterTasks(cluster) {
            const clusterTasks = []
            const listTaskPaginator = paginateListTasks(ecsPaginatorConfig, {
                cluster, include: ['TAGS']
            });

            // Iterates through task ARNs and describes them to get full task details.
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

/**
 * Factory function for creating an AWS EKS client.
 * Provides methods for listing and describing EKS nodegroups with throttling.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with AWS EKS.
 */
export function createEksClient(credentials, region) {
    // Initializes the EKS client.
    const eksClient = new EKS({customUserAgent, region, credentials});

    // Configuration for EKS paginators.
    const eksPaginatorConfig = {
        client: new EKSClient({customUserAgent, region, credentials}),
        pageSize: 100
    };
    // Creates a throttler for `describeNodegroup` API calls.
    // This API has a low TPS (Transactions Per Second) limit, so the throttle limit is set artificially low.
    const describeNodegroupThrottler = createThrottler('eksDescribeNodegroup', credentials, region, {
        limit: 5, // Allows 5 calls per interval.
        interval: 1000 // Interval of 1000ms (1 second).
    });

    return {
        /**
         * Lists all nodegroups for a given EKS cluster and retrieves their detailed descriptions.
         * Each nodegroup description call is throttled.
         * @param {string} clusterName - The name of the EKS cluster.
         * @returns {Promise<Array>} A promise that resolves to an array of EKS nodegroup objects.
         */
        async listNodeGroups(clusterName) {
            const ngs = [];
            const listNodegroupsPaginator = paginateListNodegroups(eksPaginatorConfig, {
                clusterName
            });

            // Iterates through nodegroup names and describes each one in parallel, but throttled.
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

/**
 * Factory function for creating an AWS Classic Elastic Load Balancing (ELB) client.
 * Provides throttled methods for describing load balancers.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with Classic ELB.
 */
export function createElbClient(credentials, region) {
    // Initializes the Classic ELB client.
    const elbClient = new ElasticLoadBalancing({customUserAgent, credentials, region});

    // Creates a throttler for ELB describe* calls. These rate limits are shared across all LB types.
    const elbDescribeThrottler = createThrottler('elbDescribe', credentials, region, {
        limit: 10, // Allows 10 calls per interval.
        interval: 1000 // Interval of 1000ms (1 second).
    });

    return {
        /**
         * Retrieves all EC2 instance IDs associated with a given Classic Load Balancer.
         * The operation is throttled.
         * @param {string} resourceId - The name of the Classic Load Balancer.
         * @returns {Promise<Array>} A promise that resolves to an array of EC2 instance IDs.
         */
        getLoadBalancerInstances: elbDescribeThrottler(async resourceId => {
            const lb = await elbClient.describeLoadBalancers({
                LoadBalancerNames: [resourceId],
            });

            const instances = lb.LoadBalancerDescriptions[0]?.Instances ?? [];

            return instances.map(x => x.InstanceId);
        })
    };
}

/**
 * Factory function for creating an AWS Elastic Load Balancing V2 (ALB/NLB) client.
 * Provides throttled methods for describing target health and listing target groups.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with ELBv2.
 */
export function createElbV2Client(credentials, region) {
    // Initializes the ELBv2 client.
    const elbClientV2 = new ElasticLoadBalancingV2({customUserAgent, credentials, region});
    // Configuration for ELBv2 paginators.
    const elbV2PaginatorConfig = {
        client: new ElasticLoadBalancingV2Client({customUserAgent, region, credentials}),
        pageSize: 100
    };

    // Creates a throttler for ELBv2 describe* calls. These rate limits are shared across all LB types.
    const elbDescribeThrottler = createThrottler('elbDescribe', credentials, region, {
        limit: 10, // Allows 10 calls per interval.
        interval: 1000 // Interval of 1000ms (1 second).
    });

    return {
        /**
         * Retrieves the target health for a given Target Group ARN.
         * The operation is throttled.
         * @param {string} arn - The ARN of the Target Group.
         * @returns {Promise<Array>} A promise that resolves to an array of TargetHealthDescription objects.
         */
        describeTargetHealth: elbDescribeThrottler(async arn => {
            const {TargetHealthDescriptions = []} = await elbClientV2.describeTargetHealth({
                TargetGroupArn: arn
            });
            return TargetHealthDescriptions;
        }),
        /**
         * Lists all target groups (ALB/NLB) in the account/region.
         * The operation is paginated and throttled.
         * @returns {Promise<Array>} A promise that resolves to an array of TargetGroup objects.
         */
        getAllTargetGroups: elbDescribeThrottler(async () => {
            const tgPaginator = paginateDescribeTargetGroups(elbV2PaginatorConfig, {});
            const targetGroups = [];
            for await (const {TargetGroups} of tgPaginator) {
                targetGroups.push(...TargetGroups);
            }
            return targetGroups;
        }),
    };
}

/**
 * Factory function for creating an AWS IAM client.
 * Provides a paginated and throttled method for listing all attached AWS managed policies.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with AWS IAM.
 */
export function createIamClient(credentials, region) {
    // Configuration for IAM paginators.
    const iamPaginatorConfig = {
        client: new IAMClient({customUserAgent, region, credentials}),
        pageSize: 100
    };

    return {
        /**
         * Lists all attached AWS managed IAM policies in the account.
         * @returns {Promise<Array>} A promise that resolves to an array of IAM policy objects.
         */
        async getAllAttachedAwsManagedPolices() {
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

/**
 * Factory function for creating an AWS MediaConnect client.
 * Provides a paginated and throttled method for listing MediaConnect flows.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with AWS MediaConnect.
 */
export function createMediaConnectClient(credentials, region) {
    // Configuration for MediaConnect list flows paginator.
    const listFlowsPaginatorConfig = {
        client: new MediaConnectClient({customUserAgent, credentials, region}),
        pageSize: 20
    }

    // Creates a throttler for MediaConnect list flows operations.
    const listFlowsPaginatorThrottler = createThrottler('mediaConnectListThrottler', credentials, region, {
        limit: 5, // Allows 5 calls per interval.
        interval: 1000 // Interval of 1000ms (1 second).
    });

    return {
        /**
         * Lists all MediaConnect flows in the account/region.
         * The operation is paginated and throttled.
         * @returns {Promise<Array>} A promise that resolves to an array of MediaConnect flow objects.
         */
        async getAllFlows() {
            const listFlowsPaginator = paginateListFlows(listFlowsPaginatorConfig, {});
            const flows = [];
            for await (const {Flows} of throttledPaginator(listFlowsPaginatorThrottler, listFlowsPaginator)) {
                flows.push(...Flows);
            }
            return flows;
        }
    };
}

/**
 * Factory function for creating an AWS SNS client.
 * Provides a paginated and throttled method for listing all SNS subscriptions.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with AWS SNS.
 */
export function createSnsClient(credentials, region) {
    // Configuration for SNS paginators.
    const snsPaginatorConfig = {
        client: new SNSClient({customUserAgent, credentials, region}),
        pageSize: 100
    }

    return {
        /**
         * Lists all SNS subscriptions in the account/region.
         * The operation is paginated.
         * @returns {Promise<Array>} A promise that resolves to an array of SNS subscription objects.
         */
        async getAllSubscriptions() {
            const listSubscriptionsPaginator = paginateListSubscriptions(snsPaginatorConfig, {});
            const subscriptions = [];
            for await (const {Subscriptions} of listSubscriptionsPaginator) {
                subscriptions.push(...Subscriptions);
            }
            return subscriptions;
        }
    }
}

/**
 * Factory function for creating an AWS STS (Security Token Service) client.
 * Provides methods to assume an IAM role and retrieve temporary credentials,
 * or get current credentials using the default provider chain.
 * @param {object} credentials - Optional AWS credentials for the client.
 * @param {string} region - Optional AWS region for the client.
 * @returns {object} An object containing methods to interact with AWS STS.
 */
export function createStsClient(credentials, region) {
    // Determines parameters for STS client initialization.
    const params = (credentials == null && region == null) ? {} : {credentials, region}
    // Initializes the STS client.
    const sts = new STS({...params, customUserAgent});

    // Initializes the Node.js credential provider chain.
    const CredentialsProvider = fromNodeProviderChain();

    return {
        /**
         * Assumes a specified IAM role and returns temporary security credentials.
         * @param {string} RoleArn - The ARN of the IAM role to assume.
         * @returns {Promise<object>} A promise that resolves to an object containing accessKeyId, secretAccessKey, and sessionToken.
         */
        async getCredentials(RoleArn) {
            const {Credentials} = await sts.assumeRole({
                    RoleArn,
                    RoleSessionName: 'discovery' // Session name for the assumed role.
                }
            );

            return {accessKeyId: Credentials.AccessKeyId, secretAccessKey: Credentials.SecretAccessKey, sessionToken: Credentials.SessionToken};
        },
        /**
         * Retrieves the current AWS credentials from the default provider chain.
         * @returns {Promise<object>} A promise that resolves to an object containing current AWS credentials.
         */
        async getCurrentCredentials() {
            return CredentialsProvider();
        }
    };
}

/**
 * Factory function for creating an AWS DynamoDB Streams client.
 * Provides throttled methods for describing DynamoDB streams.
 * @param {object} credentials - AWS credentials for the client.
 * @param {string} region - The AWS region for the client.
 * @returns {object} An object containing methods to interact with DynamoDB Streams.
 */
export function createDynamoDBStreamsClient(credentials, region) {
    // Initializes the DynamoDB Streams client.
    const dynamoDBStreamsClient = new DynamoDBStreams({customUserAgent, region, credentials});

    // Creates a throttler for `describeStream` API calls.
    // This API has a low TPS, so the throttle limit is set artificially low.
    const describeStreamThrottler = createThrottler('dynamoDbDescribeStream', credentials, region, {
        limit: 8, // Allows 8 calls per interval.
        interval: 1000 // Interval of 1000ms (1 second).
    });

    // Wraps `describeStream` API call with the defined throttler.
    const describeStream = describeStreamThrottler(streamArn => dynamoDBStreamsClient.describeStream({StreamArn: streamArn}));

    return {
        /**
         * Describes a DynamoDB stream by its ARN.
         * The operation is throttled.
         * @param {string} streamArn - The ARN of the DynamoDB stream.
         * @returns {Promise<object>} A promise that resolves to the StreamDescription object.
         */
        async describeStream(streamArn) {
            const {StreamDescription} = await describeStream(streamArn);
            return StreamDescription;
        }
    }
}

/**
 * Main factory function that aggregates and returns all individual AWS client creation functions.
 * This provides a single entry point for accessing all configured AWS SDK clients
 * used throughout the workload discovery process.
 * @returns {object} An object where keys are client names and values are their respective factory functions.
 */
export function createAwsClient() {
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
