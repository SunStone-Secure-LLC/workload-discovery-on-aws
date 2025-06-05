// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import ResourcesSplitPanel from './components/Explore/Resources/Utils/ResourcesSplitPanel'; // Split panel content for the Resources page.
import React from 'react'; // Imports React for JSX syntax.
import DrawingSplitPanel from './components/Diagrams/Draw/Utils/DrawingSplitPanel'; // Split panel content for drawing diagrams.
import {OPEN_DIAGRAM, RESOURCES, VIEWS} from './routes'; // Imports route path constants.

/**
 * Defines the configuration for the application's split panel.
 * Each object in the array maps a specific URL path to a corresponding split panel content component.
 * The `PolarisLayout` component uses this array to dynamically render the appropriate split panel.
 * Properties:
 * - `title`: The title to display for the split panel.
 * - `path`: The URL path(s) that this split panel content is relevant for.
 * - `component`: The React component that renders the split panel content.
 */
const splitPanels = [
    {
        title: 'Draw', // Split panel content for drawing diagrams (when opening an existing diagram).
        path: OPEN_DIAGRAM,
        component: <DrawingSplitPanel />,
    },
    {
        title: 'Resources', // Split panel content for the Resources page.
        path: RESOURCES,
        component: <ResourcesSplitPanel />,
    },
    {
        title: 'Views', // Split panel content for the Views page.
        path: VIEWS,
        component: <ResourcesSplitPanel />, // Reuses ResourcesSplitPanel as it likely displays similar resource details.
    },
];

export default splitPanels;
