// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module centralizes the application's configuration by
 * loading various settings from environment variables. These configurations
 * are crucial for the discovery process, defining how the application
 * interacts with AWS services and its operational parameters.
 */

import { AWS_ORGANIZATIONS } from "./constants.mjs"; // Imports the AWS_ORGANIZATIONS constant for comparison with CROSS_ACCOUNT_DISCOVERY.

// The name of the cluster where the application is deployed.
export const cluster = process.env.CLUSTER;
// The name of the AWS Config aggregator used for cross-account resource discovery.
export const configAggregator = process.env.CONFIG_AGGREGATOR;
// Specifies the method for cross-account discovery (e.g., 'AWS_ORGANIZATIONS' or individual accounts).
export const crossAccountDiscovery = process.env.CROSS_ACCOUNT_DISCOVERY;
// A custom user agent string to be used in AWS SDK calls for identification.
export const customUserAgent = process.env.CUSTOM_USER_AGENT;
// The URL of the GraphQL API endpoint for interacting with the backend.
export const graphgQlUrl = process.env.GRAPHQL_API_URL;
// A boolean flag indicating whether AWS Organizations is being used for cross-account discovery.
export const isUsingOrganizations = process.env.CROSS_ACCOUNT_DISCOVERY === AWS_ORGANIZATIONS;
// The ID of the Organizational Unit (OU) to scope discovery within AWS Organizations.
export const organizationUnitId = process.env.ORGANIZATION_UNIT_ID;
// The AWS region where the application is deployed and operates.
export const region = process.env.AWS_REGION;
// The AWS account ID of the root account from which discovery is initiated.
export const rootAccountId = process.env.AWS_ACCOUNT_ID;
// The IAM role assumed in the root account for performing discovery operations.
export const rootAccountRole = process.env.DISCOVERY_ROLE;
// The ID of the VPC where certain resources might be deployed or accessed.
export const vpcId = process.env.VPC_ID;
