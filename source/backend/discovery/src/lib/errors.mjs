// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module defines custom error classes used throughout the application.
 * These custom errors provide more specific context and data for error handling,
 * allowing for more granular error management and user feedback.
 */

/**
 * Custom error class for when some OpenSearch resources fail to be processed.
 * This error includes a list of the specific failures encountered.
 */
export class UnprocessedOpenSearchResourcesError extends Error {
    /**
     * Creates an instance of UnprocessedOpenSearchResourcesError.
     * @param {Array} failures - An array of objects, each detailing a specific failure.
     */
    constructor(failures) {
        super('Error processing resources.'); // Calls the parent Error constructor with a default message.
        this.name = 'UnprocessedOpenSearchResourcesError'; // Sets the name of the error.
        this.failures = failures; // Stores the array of detailed failures.
    }
}

/**
 * Custom error class for when a specified AWS Config aggregator is not found.
 * This error includes the name of the aggregator that was not found.
 */
export class AggregatorNotFoundError extends Error {
    /**
     * Creates an instance of AggregatorNotFoundError.
     * @param {string} aggregatorName - The name of the aggregator that was not found.
     */
    constructor(aggregatorName) {
        super(`Aggregator ${aggregatorName} was not found`); // Sets a specific error message including the aggregator name.
        this.name = 'AggregatorValidationError'; // Sets the name of the error.
        this.aggregatorName = aggregatorName; // Stores the name of the missing aggregator.
    }
}

/**
 * Custom error class for when a Config aggregator is found but is not an organization-wide aggregator,
 * which is required for certain operations.
 * This error includes the aggregator object that caused the validation failure.
 */
export class OrgAggregatorValidationError extends Error {
    /**
     * Creates an instance of OrgAggregatorValidationError.
     * @param {object} aggregator - The aggregator object that failed validation.
     */
    constructor(aggregator) {
        super('Config aggregator is not an organization wide aggregator'); // Sets a generic error message.
        this.name = 'AggregatorValidationError'; // Sets the name of the error.
        this.aggregator = aggregator; // Stores the invalid aggregator object.
    }
}

/**
 * Custom error class for when the application fails to connect to one or more required AWS services,
 * typically due to VPC configuration issues or service timeouts.
 * This error includes a list of the services that timed out.
 */
export class RequiredServicesTimeoutError extends Error {
    /**
     * Creates an instance of RequiredServicesTimeoutError.
     * @param {Array<string>} services - An array of service names that timed out.
     */
    constructor(services) {
        super('Error connecting to one or more required AWS services.'); // Sets a generic error message.
        this.name = 'VpcConfigurationValidationError'; // Sets the name of the error.
        this.services = services; // Stores the list of services that timed out.
    }
}
