// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import ResourcesHelper from './components/Explore/Resources/Utils/ResourcesHelper'; // Help content for the Resources page.
import ImportRegionHelper from './components/RegionManagement/SinglePageImport/ImportRegionHelper'; // Help content for the Import page.
import React from 'react'; // Imports React for JSX syntax.
import ViewFormHelper from './components/Explore/Views/ViewForm/ViewFormHelper'; // Help content for View creation/editing forms.
import ViewExplorerHelper from './components/Explore/Views/ViewExplorerHelper'; // Help content for the View Explorer page.
import DiscoverableAccountsAndRegionsHelper from './components/RegionManagement/DiscoverableRegions/DiscoverableAccountsAndRegionsHelper'; // Help content for the Discoverable Accounts page.
import OpenDiagramHelper from './components/Diagrams/Draw/DrawDiagram/OpenDiagram/OpenDiagramHelper'; // Help content for opening diagrams.
import CreateDiagramHelper from './components/Diagrams/Draw/DrawDiagram/CreateDiagram/CreateDiagramHelper'; // Help content for creating diagrams.
import {
    ACCOUNTS, // Route path for accounts.
    COST_REPORT, // Route path for cost reports.
    COSTS, // Route path for costs.
    CREATE_DIAGRAM, // Route path for creating diagrams.
    CREATE_VIEW, // Route path for creating views.
    DIAGRAM_MANAGEMENT, // Route path for diagram management.
    EDIT_VIEW, // Route path for editing views.
    IMPORT, // Route path for import.
    OPEN_DIAGRAM, // Route path for opening diagrams.
    RESOURCES, // Route path for resources.
    VIEW, // Route path for a specific view.
    VIEWS, // Route path for views.
} from './routes'; // Imports route path constants.
import DiagramExplorerHelper from './components/Diagrams/Management/DiagramExplorerHelper'; // Help content for the Diagram Explorer.
import CostReportHelper from './components/Costs/Report/CostReportHelper'; // Help content for cost reports.
import CostExplorerHelper from './components/Costs/QueryBuilder/CostExplorerHelper'; // Help content for the Cost Explorer.

/**
 * Defines the configuration for the application's help panel.
 * Each object in the array maps a specific URL path to a corresponding help content component.
 * The `PolarisLayout` component uses this array to dynamically render the appropriate help panel.
 * Properties:
 * - `title`: The title to display for the help panel.
 * - `path`: The URL path(s) that this help panel content is relevant for.
 * - `component`: The React component that renders the help content.
 */
const panels = [
    {
        title: 'Resources', // Help content for the Resources page.
        path: RESOURCES,
        component: <ResourcesHelper />,
    },
    {
        title: 'Edit a View', // Help content for editing a view.
        path: EDIT_VIEW,
        component: <ViewFormHelper />,
    },
    {
        title: 'Create a View', // Help content for creating a view.
        path: CREATE_VIEW,
        component: <ViewFormHelper />,
    },
    {
        title: 'Explore Views', // Help content for the Views explorer page.
        path: VIEWS,
        component: <ViewExplorerHelper />,
    },
    {
        title: 'Explore View', // Help content for a specific view in the explorer.
        path: VIEW,
        component: <ViewExplorerHelper />,
    },
    {
        title: 'Import', // Help content for the Import page.
        path: IMPORT,
        component: <ImportRegionHelper />,
    },
    {
        title: 'Accounts', // Help content for the Accounts page.
        path: ACCOUNTS,
        component: <DiscoverableAccountsAndRegionsHelper />,
    },
    {
        title: 'Draw Diagram', // Help content for the Draw Diagram page (when opening an existing diagram).
        path: OPEN_DIAGRAM,
        component: <OpenDiagramHelper />,
    },
    {
        title: 'Create Diagram', // Help content for the Create Diagram page.
        path: CREATE_DIAGRAM,
        component: <CreateDiagramHelper />,
    },
    {
        title: 'Diagram Management', // Help content for the Diagram Management page.
        path: DIAGRAM_MANAGEMENT,
        component: <DiagramExplorerHelper />,
    },
    {
        title: 'Cost Report', // Help content for the Cost Report page.
        path: COST_REPORT,
        component: <CostReportHelper />,
    },
    {
        title: 'Cost Explorer', // Help content for the Cost Explorer (Query Builder) page.
        path: COSTS,
        component: <CostExplorerHelper />,
    },
];

export default panels;
