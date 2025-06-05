/* eslint-disable */
// this is an auto generated file. This will be overwritten

/**
 * @file This module exports GraphQL mutation strings used by the SDK client
 * to perform write operations on resources, relationships, and accounts
 * in the backend database (AppSync). These mutations are typically auto-generated
 * from the GraphQL schema.
 */

// GraphQL mutation to add new accounts to the database.
export const addAccounts = /* GraphQL */ `
  mutation AddAccounts($accounts: [AccountInput]!) {
    addAccounts(accounts: $accounts) {
      unprocessedAccounts # Returns a list of accounts that could not be processed.
    }
  }
`;

// GraphQL mutation to delete relationships from the database.
export const deleteRelationships = /* GraphQL */ `
  mutation DeleteRelationships($relationshipIds: [String]!) {
    deleteRelationships(relationshipIds: $relationshipIds) # Returns a boolean indicating success.
  }
`;

// GraphQL mutation to delete resources from the database.
export const deleteResources = /* GraphQL */ `
  mutation DeleteResources($resourceIds: [String]!) {
    deleteResources(resourceIds: $resourceIds) # Returns a boolean indicating success.
  }
`;

// GraphQL mutation to update an existing account's details in the database.
export const updateAccount = /* GraphQL */ `
  mutation UpdateAccount(
    $accountId: String!
    $lastCrawled: AWSDateTime
    $name: String
    $isIamRoleDeployed: Boolean
  ) {
    updateAccount(
      accountId: $accountId
      lastCrawled: $lastCrawled
      name: $name
      isIamRoleDeployed: $isIamRoleDeployed
    ) {
      accountId # Returns the updated account's ID.
      name # Returns the updated account's name.
      lastCrawled # Returns the updated last crawled timestamp.
    }
  }
`;

// GraphQL mutation to update regions associated with an account.
export const updateRegions = /* GraphQL */ `
  mutation UpdateRegions($accountId: String!, $regions: [RegionInput]!) {
    updateRegions(accountId: $accountId, regions: $regions) {
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

// GraphQL mutation to add new regions to an account.
export const addRegions = /* GraphQL */ `
  mutation AddRegions($accountId: String!, $regions: [RegionInput]!) {
    addRegions(accountId: $accountId, regions: $regions) {
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

// GraphQL mutation to add new relationships to the database.
export const addRelationships = /* GraphQL */ `
  mutation AddRelationships($relationships: [RelationshipInput]!) {
    addRelationships(relationships: $relationships) {
      id # Returns the ID of the added relationship.
      label # Returns the label of the added relationship.
      source {
        id # Returns the ID of the source resource.
        label # Returns the label of the source resource.
      }
      target {
        id # Returns the ID of the target resource.
        label # Returns the label of the target resource.
      }
    }
  }
`;

// GraphQL mutation to add new resources to the database.
export const addResources = /* GraphQL */ `
  mutation AddResources($resources: [ResourceInput]!) {
    addResources(resources: $resources) {
      id # Returns the ID of the added resource.
      label # Returns the label of the added resource.
    }
  }
`;

// GraphQL mutation to index resources in OpenSearch.
export const indexResources = /* GraphQL */ `
  mutation IndexResources($resources: [ResourceInput]!) {
    indexResources(resources: $resources) {
      unprocessedResources # Returns a list of resources that could not be indexed.
    }
  }
`;

// GraphQL mutation to delete indexed resources from OpenSearch.
export const deleteIndexedResources = /* GraphQL */ `
  mutation DeleteIndexedResources($resourceIds: [String]!) {
    deleteIndexedResources(resourceIds: $resourceIds) {
      unprocessedResources # Returns a list of resource IDs that could not be deleted from the index.
    }
  }
`;

// GraphQL mutation to update existing resources in the database.
export const updateResources = /* GraphQL */ `
  mutation UpdateResources($resources: [ResourceInput]!) {
    updateResources(resources: $resources) {
      id # Returns the ID of the updated resource.
      label # Returns the label of the updated resource.
    }
  }
`;

// GraphQL mutation to update indexed resources in OpenSearch.
export const updateIndexedResources = /* GraphQL */ `
  mutation UpdateIndexedResources($resources: [ResourceInput]!) {
    updateIndexedResources(resources: $resources) {
      unprocessedResources # Returns a list of resources that could not be updated in the index.
    }
  }
`;

// GraphQL mutation to delete regions associated with an account.
export const deleteRegions = /* GraphQL */ `
  mutation DeleteRegions($accountId: String!, $regions: [RegionInput]!) {
    deleteRegions(accountId: $accountId, regions: $regions) {
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

// GraphQL mutation to delete accounts from the database.
export const deleteAccounts = /* GraphQL */ `
  mutation DeleteAccounts($accountIds: [String]!) {
    deleteAccounts(accountIds: $accountIds) {
      unprocessedAccounts # Returns a list of account IDs that could not be deleted.
    }
  }
`;
