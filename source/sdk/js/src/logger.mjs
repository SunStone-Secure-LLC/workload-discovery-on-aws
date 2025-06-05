// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module configures and exports a Winston logger instance specifically for the SDK.
 * It provides a centralized logging utility, allowing for structured logging with timestamps
 * and JSON format, and configurable log levels via environment variables.
 */

import {transports, createLogger, format} from 'winston'; // Imports Winston components for logging.

// Determines the logging level based on the 'LOG_LEVEL' environment variable.
// Defaults to 'info' if the environment variable is not set, and converts it to lowercase.
const level = (process.env.LOG_LEVEL ?? 'info').toLowerCase();

// Creates a new Winston logger instance with specified configurations.
const logger  = createLogger({
    // Defines the format of the log messages.
    format: format.combine(
        format.timestamp(), // Adds a timestamp to each log entry.
        format.json() // Formats log entries as JSON objects, useful for structured logging.
    ),
    // Defines the transports (destinations) for the log messages.
    transports: [
        // Configures a console transport, which outputs log messages to the console.
        // The log level for this transport is set dynamically based on the 'level' variable.
        new transports.Console({level})
    ]
});

// Exports the configured logger instance as the default export of this module.
export default logger;
