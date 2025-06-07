// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import Homepage from './components/Homepage/Homepage'; // Component for the application homepage.
import DiscoverableAccountsPage from './components/RegionManagement/DiscoverableRegions/DiscoverableAccountsPage'; // Component for managing discoverable accounts.
import ImportContent from './components/RegionManagement/SinglePageImport/ImportContent'; // Component for single-page import functionality.
import ViewExplorerPage from './components/Explore/Views/ViewExplorerPage'; // Component for exploring saved views.
import ViewFormPage from './components/Explore/Views/ViewForm/ViewFormPage'; // Component for creating/editing views.
import ResourcesPage from './components/Explore/Resources/ResourcesPage'; // Component for exploring discovered resources.
import CostsPage from './components/Costs/QueryBuilder/CostsPage'; // Component for building cost queries.
import DiagramExplorer from './components/Diagrams/Management/DiagramExplorer'; // Component for managing saved diagrams.
import DrawDiagramPage from './components/Diagrams/Draw/DrawDiagram/DrawDiagramPage'; // Component for drawing new diagrams.
import OpenDiagramPage from './components/Diagrams/Draw/DrawDiagram/OpenDiagram/OpenDiagramPage'; // Component for opening existing diagrams.
import CreateDiagramPage from './components/Diagrams/Draw/DrawDiagram/CreateDiagram/CreateDiagramPage'; // Component for creating new diagrams.
import CostOverview from './components/Costs/Report/CostOverview'; // Component for displaying cost reports.

// --- Route Path Constants ---
// These constants define the URL paths used throughout the application for navigation.
export const HOMEPAGE_PATH = '/';
export const RESOURCES = '/resources';
export const ACCOUNTS = '/accounts';
export const IMPORT = '/import';
export const VIEWS = '/views';
export const VIEW = '/views/:name'; // Dynamic route for a specific view.
export const CREATE_VIEW = '/views/create';
export const EDIT_VIEW = '/views/:name/edit'; // Dynamic route for editing a specific view.
export const DRAW = '/diagrams';
export const CREATE_DIAGRAM = '/diagrams/create';
export const COSTS = '/costs';
export const DIAGRAM_MANAGEMENT = '/diagrams'; // Alias for DRAW, used for clarity in navigation.
export const OPEN_DIAGRAM = '/diagrams/:visibility/:name'; // Dynamic route for opening a diagram with visibility and name.
export const COST_REPORT = '/diagrams/:visibility/:name/cost_report'; // Dynamic route for cost report of a specific diagram.
export const EXPORT = '/diagrams/:visibility/:name/export'; // Dynamic route for exporting a specific diagram.

/**
 * Defines the application's routing configuration.
 * Each object in the array represents a route, mapping a URL path to a React component.
 * Properties:
 * - `title`: A human-readable title for the route, often used in browser tabs or navigation.
 * - `path`: The URL path(s) that this route matches. Can be a string or an array of strings for multiple paths.
 * - `exact`: A boolean indicating if the path must match exactly.
 * - `component`: The React component to render when this route is active.
 */
const routes = [
    {
        title: 'Workload Discovery on AWS', // Homepage route.
        path: HOMEPAGE_PATH,
        exact: true,
        component: Homepage,
    },
    {
        title: 'Accounts', // Accounts management page.
        path: ACCOUNTS,
        exact: true,
        component: DiscoverableAccountsPage,
    },
    {
        title: 'Import', // Import content page.
        path: IMPORT,
        exact: true,
        component: ImportContent,
    },
    {
        title: 'Edit view', // Route for editing an existing view.
        path: EDIT_VIEW,
        exact: true,
        component: ViewFormPage,
    },
    {
        title: 'Create view', // Route for creating a new view.
        path: CREATE_VIEW,
        exact: true,
        component: ViewFormPage,
    },
    {
        title: 'Views', // Route for exploring views (both general and specific view).
        path: [VIEWS, VIEW],
        exact: true,
        component: ViewExplorerPage,
    },
    {
        title: 'Draw', // Route for drawing diagrams (main entry for diagramming).
        path: DRAW,
        exact: true,
        component: DrawDiagramPage,
    },
    {
        title: 'Open diagram', // Route for opening a specific diagram.
        path: OPEN_DIAGRAM,
        exact: true,
        component: OpenDiagramPage,
    },
    {
        title: 'Create diagram', // Route for initiating a new diagram creation.
        path: CREATE_DIAGRAM,
        exact: true,
        component: CreateDiagramPage,
    },
    {
        title: 'Resources', // Route for exploring discovered resources.
        path: RESOURCES,
        exact: true,
        component: ResourcesPage,
    },
    {
        title: 'Costs', // Route for cost query builder.
        path: COSTS,
        exact: true,
        component: CostsPage,
    },
    {
        title: 'Cost report', // Route for displaying a cost report for a diagram.
        path: COST_REPORT,
        exact: true,
        component: CostOverview,
    },
    {
        title: 'Manage diagrams', // Route for managing diagrams (alias for DRAW).
        path: DIAGRAM_MANAGEMENT,
        exact: true,
        component: DiagramExplorer,
    },
];

export default routes;
