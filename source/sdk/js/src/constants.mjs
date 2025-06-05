// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module defines constants used specifically by the Workload Discovery SDK.
 * These constants include common error messages encountered during API interactions
 * and predefined values for cross-account discovery methods.
 */

// Error message indicating that the connection was closed prematurely, often a transient network issue.
export const CONNECTION_CLOSED_PREMATURELY = 'Connection closed prematurely';

// Error type indicating that a Lambda function's response payload size exceeded the maximum allowed limit.
export const FUNCTION_RESPONSE_SIZE_TOO_LARGE = 'Function.ResponseSizeTooLarge';

// Value for the cross-account discovery method, indicating that AWS Organizations is used.
export const AWS_ORGANIZATIONS = 'AWS_ORGANIZATIONS';

// Value for the cross-account discovery method, indicating that accounts are self-managed (not via Organizations).
export const SELF_MANAGED = 'SELF_MANAGED';

// An array of allowed values for the `crossAccountDiscovery` configuration parameter.
export const ALLOWED_CROSS_ACCOUNT_DISCOVERY_VALUES = [AWS_ORGANIZATIONS, SELF_MANAGED];
