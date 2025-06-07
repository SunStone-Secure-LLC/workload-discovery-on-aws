// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This file serves as the entry point for the discovery process.
 * It orchestrates the discovery of AWS resources by initializing necessary clients,
 * invoking the resource discovery logic, and handling potential errors.
 */

import logger from './lib/logger.mjs'; // Imports the logging utility for structured logging.
import * as config from './lib/config.mjs'; // Imports configuration settings for the discovery process.
import {DISCOVERY_PROCESS_RUNNING, AWS_ORGANIZATIONS} from './lib/constants.mjs'; // Imports constants related to discovery status and AWS Organizations.
import {createAwsClient} from './lib/awsClient.mjs'; // Imports the function to create an AWS SDK client.
import appSync from './lib/apiClient/appSync.mjs'; // Imports the AppSync client for interacting with the GraphQL API.
import {discoverResources} from './lib/index.mjs'; // Imports the core function responsible for resource discovery.
import {AggregatorNotFoundError, OrgAggregatorValidationError} from './lib/errors.mjs'; // Imports custom error types for specific error handling.

// Initializes the AWS SDK client, which will be used to interact with various AWS services.
const awsClient = createAwsClient();

/**
 * Initiates the resource discovery process.
 * This asynchronous function logs the start and completion of the discovery,
 * and handles specific errors that might occur during the process.
 */
const discover = async () => {
  logger.profile('Discovery of resources complete.'); // Marks the start of a performance profile for the discovery process.

  await discoverResources(appSync, awsClient, config) // Calls the main discovery function with AppSync client, AWS client, and configuration.
      .catch(err => {
          // If the discovery process is already running, log an info message and suppress the error.
          // Otherwise, re-throw the error to be handled by the outer catch block.
          if([DISCOVERY_PROCESS_RUNNING].includes(err.message)) {
              logger.info(err.message);
          } else {
              throw err;
          }
      });

  logger.profile('Discovery of resources complete.'); // Marks the end of the performance profile.
};

// Executes the discover function and handles any unhandled exceptions.
discover().catch(err => {
    // This block catches and handles errors that propagate up from the discovery process.
    // It provides specific error messages based on the type of error encountered.
    if(err instanceof AggregatorNotFoundError) {
        // Logs an error if the specified aggregator is not found, guiding the user to check the aggregator name.
        logger.error(`${err.message}. Ensure the name of the supplied aggregator is correct.`);
    } else if(err instanceof OrgAggregatorValidationError) {
        // Logs an error if there's a validation issue with the organization aggregator,
        // especially when cross-account discovery is set to AWS Organizations.
        logger.error(`${err.message}. You cannot use an individual accounts aggregator when cross account discovery is set to ${AWS_ORGANIZATIONS}.`, {
            aggregator: err.aggregator
        });
    } else {
        // Logs a generic error for any other unexpected issues during the discovery process,
        // including the error message and stack trace for debugging.
        logger.error('Unexpected error in Discovery process.', {
            msg: err.message,
            stack: err.stack
        });
    }
    // Exits the process with a non-zero status code to indicate an error occurred.
    process.exit(1);
});
