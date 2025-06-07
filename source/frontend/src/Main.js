// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react'; // Imports the React library for building user interfaces.
import {ResourceProvider} from './components/Contexts/ResourceContext'; // Imports the ResourceContext provider for managing application resources.
import {resourceReducer} from './components/Contexts/Reducers/ResourceReducer'; // Imports the reducer for the ResourceContext.
import {QueryClient, QueryClientProvider} from 'react-query'; // Imports QueryClient and QueryClientProvider from react-query for data fetching and caching.
import PolarisLayout from './PolarisLayout'; // Imports the main layout component of the application.
import {BrowserRouter as Router} from 'react-router-dom'; // Imports BrowserRouter for client-side routing.
import {NotificationProvider} from './components/Contexts/NotificationContext'; // Imports the NotificationContext provider for managing application notifications.
import {DiagramSettingsProvider} from './components/Contexts/DiagramSettingsContext'; // Imports the DiagramSettingsContext provider for managing diagram-specific settings.
import {diagramSettingsReducer} from './components/Contexts/Reducers/DiagramSettingsReducer'; // Imports the reducer for the DiagramSettingsContext.
import localizedFormat from 'dayjs/plugin/localizedFormat'; // Day.js plugin for localized date formats.
import dayjs from 'dayjs'; // Imports Day.js for date manipulation.

dayjs.extend(localizedFormat); // Extends Day.js with the localizedFormat plugin.

// Initializes a new QueryClient for react-query.
// Configures default options for all queries:
// - refetchInterval: Data will be refetched every 60 seconds (60000 ms).
// - refetchOnWindowFocus: Disables refetching data when the window regains focus.
// - retry: Queries will retry once on failure.
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchInterval: 60000,
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
});

/**
 * The Main component serves as the central wrapper for all application context providers
 * and the main routing mechanism. It sets up global state management for resources,
 * diagram settings, notifications, and data fetching.
 */
const Main = () => {
    // Defines the initial state for the ResourceContext.
    const initialResourceState = {
        graphResources: [], // Resources specifically for graph visualization.
        resources: [], // General list of resources.
    };

    // Defines the initial state for the DiagramSettingsContext.
    const initialDiagramSettingsState = {
        canvas: null, // Reference to the diagram canvas.
        selectedResources: null, // Currently selected resources on the diagram.
        resources: [], // Resources displayed on the diagram.
    };

    return (
        // Provides the QueryClient to all components that use react-query for data fetching.
        <QueryClientProvider client={queryClient}>
            {/* Provides notification-related state and functions to its children. */}
            <NotificationProvider>
                {/* Provides diagram-specific settings and state management. */}
                <DiagramSettingsProvider
                    initialState={initialDiagramSettingsState}
                    reducer={diagramSettingsReducer}
                >
                    {/* Provides resource-related state and functions to its children. */}
                    <ResourceProvider
                        initialState={initialResourceState}
                        reducer={resourceReducer}
                    >
                        {/* Sets up client-side routing for the application. */}
                        <Router>
                            {/* The main layout component, which contains the application's UI and routes. */}
                            <PolarisLayout />
                        </Router>
                    </ResourceProvider>
                </DiagramSettingsProvider>
            </NotificationProvider>
        </QueryClientProvider>
    );
};

export default Main;
