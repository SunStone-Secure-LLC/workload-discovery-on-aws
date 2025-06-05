// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file Vitest configuration file for the metrics Lambda function.
 * This file defines how Vitest should run tests and generate coverage reports
 * for the TypeScript source code within this module.
 */

import {defineConfig} from 'vitest/config'; // Imports `defineConfig` helper from Vitest, which provides type-checking and autocompletion for the configuration object.

export default defineConfig({
    // Configuration for Vitest's test runner.
    test: {
        // Configuration for code coverage reporting.
        coverage: {
            provider: 'v8', // Specifies 'v8' as the coverage provider, which uses Node.js's built-in V8 engine for coverage.
            reporter: [ // Defines the output formats for the coverage report.
                // Generates an LCOV report, typically used by CI/CD tools for coverage analysis.
                // `projectRoot` is set to ensure correct paths in the LCOV report relative to the monorepo root.
                ['lcov', {projectRoot: '../../../..'}],
                // Generates an HTML report, which is a human-readable web page for browsing coverage.
                ['html'],
                // Generates a plain text report, suitable for console output.
                ['text'],
                // Generates a JSON report, useful for programmatic consumption of coverage data.
                ['json'],
            ],
        },
    },
});
