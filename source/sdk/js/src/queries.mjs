/* eslint-disable */
// this is an auto generated file. This will be overwritten

/**
 * @file This module exports GraphQL query strings used by the SDK client
 * to retrieve various types of data from the backend database (AppSync).
 * These queries are typically auto-generated from the GraphQL schema.
 */

// GraphQL query to fetch resources from the database with optional pagination, resource types, and account filters.
export const getResources = /* GraphQL */ `
  query GetResources(
    $pagination: Pagination # Pagination input (start, end).
    $resourceTypes: [String] # Optional list of resource types to filter by.
    $accounts: [AccountInput] # Optional list of accounts to filter by.
  ) {
    getResources(
      pagination: $pagination
      resourceTypes: $resourceTypes
      accounts: $accounts
    ) {
      id # Unique identifier of the resource.
      label # Label of the resource (e.g., resource type).
      md5Hash # MD5 hash of the resource's properties for change detection.
      properties { # Various properties of the resource.
        accountId
        arn
        availabilityZone
        awsRegion
        configuration # Raw AWS Config configuration.
        configurationItemCaptureTime
        configurationItemStatus
        configurationStateId
        resourceCreationTime
        resourceId
        resourceName
        resourceType
        supplementaryConfiguration # Additional configuration details.
        tags # Resource tags.
        version
        vpcId
        subnetId
        subnetIds
        resourceValue
        state
        private # Indicates if a resource is private (e.g., subnet).
        loggedInURL # URL to the AWS console for a logged-in user.
        loginURL # URL to the AWS console for login.
        title # Display title of the resource.
        dBInstanceStatus
        statement
        instanceType
      }
    }
  }
`;

// GraphQL query to fetch relationships from the database with pagination.
export const getRelationships = /* GraphQL */ `
  query GetRelationships($pagination: Pagination) {
    getRelationships(pagination: $pagination) {
      id # Unique identifier of the relationship.
      label # Label of the relationship (e.g., 'CONTAINS').
      source { # Source resource of the relationship.
        id
        label
      }
      target { # Target resource of the relationship.
        id
        label
      }
    }
  }
`;

// GraphQL query to fetch a subgraph (nodes and edges) based on a list of resource IDs.
export const getResourceGraph = /* GraphQL */ `
  query GetResourceGraph($ids: [String]!, $pagination: Pagination) {
    getResourceGraph(ids: $ids, pagination: $pagination) {
      nodes { # List of nodes (resources) in the graph.
        id
        label
        md5Hash
        properties { # Properties of the node.
          accountId
          arn
          availabilityZone
          awsRegion
          configuration
          configurationItemCaptureTime
          configurationItemStatus
          configurationStateId
          resourceCreationTime
          resourceId
          resourceName
          resourceType
          supplementaryConfiguration
          tags
          version
          vpcId
          subnetId
          subnetIds
          resourceValue
          state
          private
          loggedInURL
          loginURL
          title
          dBInstanceStatus
          statement
          instanceType
        }
      }
      edges { # List of edges (relationships) in the graph.
        id
        label
        source {
          id
          label
        }
        target {
          id
          label
        }
      }
    }
  }
`;

// GraphQL query to fetch the hierarchical structure of linked nodes for a given resource.
export const getLinkedNodesHierarchy = /* GraphQL */ `
  query GetLinkedNodesHierarchy($id: String!) {
    getLinkedNodesHierarchy(id: $id) {
      id # ID of the root node in the hierarchy.
      label # Label of the root node.
      type # Type of the root node.
      data { # Data associated with the root node.
        id
        label
        md5Hash
        properties { # Properties of the root node.
          accountId
          arn
          availabilityZone
          awsRegion
          configuration
          configurationItemCaptureTime
          configurationItemStatus
          configurationStateId
          resourceCreationTime
          resourceId
          resourceName
          resourceType
          supplementaryConfiguration
          tags
          version
          vpcId
          subnetId
          subnetIds
          resourceValue
          state
          private
          loggedInURL
          loginURL
          title
          dBInstanceStatus
          statement
          instanceType
        }
      }
      md5Hash
      properties { # Properties of the root node (duplicated for some reason in schema).
        accountId
        arn
        availabilityZone
        awsRegion
        configuration
        configurationItemCaptureTime
        configurationItemStatus
        configurationStateId
        resourceCreationTime
        resourceId
        resourceName
        resourceType
        supplementaryConfiguration
        tags
        version
        vpcId
        subnetId
        subnetIds
        resourceValue
        state
        private
        loggedInURL
        loginURL
        title
        dBInstanceStatus
        statement
        instanceType
      }
      children { # List of child nodes in the hierarchy.
        id
        label
        type
        data {
          id
          label
          md5Hash
        }
        md5Hash
        properties { # Properties of the child node.
          accountId
          arn
          availabilityZone
          awsRegion
          configuration
          configurationItemCaptureTime
          configurationItemStatus
          configurationStateId
          resourceCreationTime
          resourceId
          resourceName
          resourceType
          supplementaryConfiguration
          tags
          version
          vpcId
          subnetId
          subnetIds
          resourceValue
          state
          private
          loggedInURL
          loginURL
          title
          dBInstanceStatus
          statement
          instanceType
        }
        children { # Nested children (recursive hierarchy).
          id
          label
          type
          md5Hash
          parent
        }
        parent # Parent ID of the child node.
      }
      parent # Parent ID of the root node.
    }
  }
`;

// GraphQL query to fetch hierarchical structures for multiple linked nodes in a batch.
export const batchGetLinkedNodesHierarchy = /* GraphQL */ `
  query BatchGetLinkedNodesHierarchy($ids: [String]!) {
    batchGetLinkedNodesHierarchy(ids: $ids) {
      hierarchies { # List of hierarchical structures.
        parentId
        hierarchy { # The hierarchical structure for a given parent.
          id
          label
          type
          md5Hash
          parent
        }
      }
      notFound # List of IDs for which hierarchy was not found.
      unprocessedResources # List of IDs that could not be processed.
    }
  }
`;

// GraphQL query to fetch overall metadata about discovered resources.
export const getResourcesMetadata = /* GraphQL */ `
  query GetResourcesMetadata {
    getResourcesMetadata {
      count # Total count of resources.
      accounts { # Metadata per account.
        accountId
        name
        organizationId
        isIamRoleDeployed
        isManagementAccount
        regions {
          name
          lastCrawled
        }
        lastCrawled
      }
      resourceTypes { # Metadata per resource type.
        count
        type
      }
    }
  }
`;

// GraphQL query to fetch resource metadata aggregated by account.
export const getResourcesAccountMetadata = /* GraphQL */ `
  query GetResourcesAccountMetadata($accounts: [AccountInput]) {
    getResourcesAccountMetadata(accounts: $accounts) {
      accountId
      count # Total resource count for the account.
      resourceTypes { # Breakdown of resource counts by type within the account.
        count
        type
      }
    }
  }
`;

// GraphQL query to fetch resource metadata aggregated by region within accounts.
export const getResourcesRegionMetadata = /* GraphQL */ `
  query GetResourcesRegionMetadata($accounts: [AccountInput]) {
    getResourcesRegionMetadata(accounts: $accounts) {
      accountId
      count # Total resource count for the account.
      regions { # Breakdown of resource counts by region within the account.
        count
        name
        resourceTypes { # Breakdown of resource counts by type within each region.
          count
          type
        }
      }
    }
  }
`;

// GraphQL query to fetch details for a single account.
export const getAccount = /* GraphQL */ `
  query GetAccount($accountId: String!) {
    getAccount(accountId: $accountId) {
      accountId
      name
      organizationId
      isIamRoleDeployed
      isManagementAccount
      regions {
        name
        lastCrawled
      }
      lastCrawled
    }
  }
`;

// GraphQL query to fetch details for all accounts.
export const getAccounts = /* GraphQL */ `
  query GetAccounts {
    getAccounts {
      accountId
      name
      organizationId
      isIamRoleDeployed
      isManagementAccount
      regions {
        name
        lastCrawled
      }
      lastCrawled
    }
  }
`;

// GraphQL query to read cost results directly from an S3 bucket.
export const readResultsFromS3 = /* GraphQL */ `
  query ReadResultsFromS3($s3Query: S3Query) {
    readResultsFromS3(s3Query: $s3Query) {
      totalCost # Total cost from the query.
      costItems { # List of individual cost items.
        line_item_resource_id
        product_servicename
        line_item_usage_start_date
        line_item_usage_account_id
        region
        pricing_term
        cost
        line_item_currency_code
      }
      queryDetails { # Details about the cost query execution.
        cost
        s3Bucket
        s3Key
        dataScannedInMB
        pagination {
          start
          end
        }
        resultCount
      }
    }
  }
`;

// GraphQL query to get cost data aggregated by service.
export const getCostForService = /* GraphQL */ `
  query GetCostForService($costForServiceQuery: CostForServiceQuery) {
    getCostForService(costForServiceQuery: $costForServiceQuery) {
      totalCost
      costItems {
        line_item_resource_id
        product_servicename
        line_item_usage_start_date
        line_item_usage_account_id
        region
        pricing_term
        cost
        line_item_currency_code
      }
      queryDetails {
        cost
        s3Bucket
        s3Key
        dataScannedInMB
        pagination {
          start
          end
        }
        resultCount
      }
    }
  }
`;

// GraphQL query to get cost data for a specific resource.
export const getCostForResource = /* GraphQL */ `
  query GetCostForResource($costForResourceQuery: CostForResourceQuery) {
    getCostForResource(costForResourceQuery: $costForResourceQuery) {
      totalCost
      costItems {
        line_item_resource_id
        product_servicename
        line_item_usage_start_date
        line_item_usage_account_id
        region
        pricing_term
        cost
        line_item_currency_code
      }
      queryDetails {
        cost
        s3Bucket
        s3Key
        dataScannedInMB
        pagination {
          start
          end
        }
        resultCount
      }
    }
  }
`;

// GraphQL query to get resources ordered by cost.
export const getResourcesByCost = /* GraphQL */ `
  query GetResourcesByCost($resourcesByCostQuery: ResourcesByCostQuery) {
    getResourcesByCost(resourcesByCostQuery: $resourcesByCostQuery) {
      totalCost
      costItems {
        line_item_resource_id
        product_servicename
        line_item_usage_start_date
        line_item_usage_account_id
        region
        pricing_term
        cost
        line_item_currency_code
      }
      queryDetails {
        cost
        s3Bucket
        s3Key
        dataScannedInMB
        pagination {
          start
          end
        }
        resultCount
      }
    }
  }
`;

// GraphQL query to get resources by cost, broken down by day.
export const getResourcesByCostByDay = /* GraphQL */ `
  query GetResourcesByCostByDay(
    $costForResourceQueryByDay: CostForResourceQueryByDay
  ) {
    getResourcesByCostByDay(
      costForResourceQueryByDay: $costForResourceQueryByDay
    ) {
      totalCost
      costItems {
        line_item_resource_id
        product_servicename
        line_item_usage_start_date
        line_item_usage_account_id
        region
        pricing_term
        cost
        line_item_currency_code
      }
      queryDetails {
        cost
        s3Bucket
        s3Key
        dataScannedInMB
        pagination {
          start
          end
        }
        resultCount
      }
    }
  }
`;

// GraphQL query to retrieve the global CloudFormation template.
export const getGlobalTemplate = /* GraphQL */ `
  query GetGlobalTemplate {
    getGlobalTemplate # Returns the content of the global CloudFormation template.
  }
`;

// GraphQL query to retrieve the regional CloudFormation template.
export const getRegionalTemplate = /* GraphQL */ `
  query GetRegionalTemplate {
    getRegionalTemplate # Returns the content of the regional CloudFormation template.
  }
`;

// GraphQL query to search for resources with optional text, pagination, resource types, and account filters.
export const searchResources = /* GraphQL */ `
  query SearchResources(
    $text: String! # The search text.
    $pagination: Pagination # Pagination input.
    $resourceTypes: [String] # Optional list of resource types to filter by.
    $accounts: [AccountInput] # Optional list of accounts to filter by.
  ) {
    searchResources(
      text: $text
      pagination: $pagination
      resourceTypes: $resourceTypes
      accounts: $accounts
    ) {
      count # Total count of matching resources.
      resources { # List of matching resources.
        id
        label
        md5Hash
        properties { # Properties of the resource.
          accountId
          arn
          availabilityZone
          awsRegion
          configuration
          configurationItemCaptureTime
          configurationItemStatus
          configurationStateId
          resourceCreationTime
          resourceId
          resourceName
          resourceType
          supplementaryConfiguration
          tags
          version
          vpcId
          subnetId
          subnetIds
          resourceValue
          state
          private
          loggedInURL
          loginURL
          title
          dBInstanceStatus
          statement
          instanceType
        }
      }
    }
  }
`;

// GraphQL query to export diagram data to Draw.io format.
export const exportToDrawIo = /* GraphQL */ `
  query ExportToDrawIo($nodes: [drawIoNodeInput], $edges: [drawIoEdgeInput]) {
    exportToDrawIo(nodes: $nodes, edges: $edges) # Returns the Draw.io URL.
  }
`;
