// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, {useEffect, useLayoutEffect, useRef, useState} from 'react'; // Imports React hooks for component lifecycle and state management.
import PropTypes from 'prop-types'; // Imports PropTypes for type-checking component props.
import {
    matchPath, // Utility to match a URL pathname against a route path.
    Route, // Renders UI when its path matches the current URL.
    Switch, // Renders the first <Route> that matches the location.
    useHistory, // Hook to access the history instance.
    useLocation, // Hook to access the current location object.
} from 'react-router-dom'; // Imports components and hooks from React Router for navigation.
import {
    AppLayout, // Cloudscape Design System component for overall application layout.
    Box, // Cloudscape Design System component for layout and spacing.
    Button, // Cloudscape Design System component for buttons.
    SideNavigation, // Cloudscape Design System component for side navigation.
    SpaceBetween, // Cloudscape Design System component for consistent spacing.
} from '@cloudscape-design/components'; // Imports components from Cloudscape Design System.
import routes, {
    ACCOUNTS, // Route path for accounts page.
    COSTS, // Route path for costs page.
    CREATE_DIAGRAM, // Route path for creating a new diagram.
    DRAW, // Route path for managing diagrams.
    HOMEPAGE_PATH, // Route path for the application homepage.
    OPEN_DIAGRAM, // Route path for opening an existing diagram.
    RESOURCES, // Route path for resources page.
    VIEWS, // Route path for views page.
} from './routes'; // Imports application routes and their paths.
import panels from './help-panel'; // Imports definitions for the help panel content.
import splitPanels from './split-panel'; // Imports definitions for the split panel content.
import {useSplitPanel} from './components/SplitPanel/SplitPanelConfig'; // Custom hook for managing split panel state.
import PlaceholderHelp from './Utils/HelpPanel/PlaceholderHelp'; // Placeholder component for help panel.
import {ErrorBoundary} from 'react-error-boundary'; // Component for catching and handling React errors.
import * as R from 'ramda'; // Imports Ramda for functional programming utilities.
import ErrorFallback from './components/Errors/ErrorFallback'; // Fallback UI for error boundaries.
import {useAuthenticator} from '@aws-amplify/ui-react'; // Hook to access Amplify Authenticator context (user, signOut).
import {useFirstMountState, useLocalStorage} from 'react-use'; // Custom hooks for checking first mount and local storage.
import {useNotificationDispatch} from './components/Contexts/NotificationContext'; // Hook to access notification dispatch function.
import Notifications from './Utils/Notifications'; // Component for displaying notifications.
import {useResourceState} from './components/Contexts/ResourceContext'; // Hook to access resource state and dispatch.
import {useDiagramSettingsState} from './components/Contexts/DiagramSettingsContext'; // Hook to access diagram settings state and dispatch.

/**
 * Renders the side navigation component of the application.
 * It displays navigation links, handles routing, and provides user authentication status.
 * @param {object} props - Component props.
 * @param {function} props.onNavigate - Callback function for navigation events.
 */
const Navigation = ({onNavigate}) => {
    const history = useHistory(); // Accesses the React Router history object.
    const location = useLocation(); // Accesses the current location object.
    const {user, signOut} = useAuthenticator(); // Accesses user info and signOut function from Amplify Authenticator.

    // Listens for history changes and calls onNavigate.
    history.listen(onNavigate);

    // Calls onNavigate on layout effect (after DOM mutations).
    useLayoutEffect(() => {
        onNavigate(location);
    });

    // Header configuration for the side navigation.
    const navHeader = {
        text: `Workload Discovery on AWS`,
        href: HOMEPAGE_PATH,
    };

    // Defines the structure and content of the side navigation items.
    const navItems = [
        {
            type: 'section',
            text: 'Explore',
            items: [
                {
                    type: 'link',
                    text: 'Resources',
                    href: RESOURCES,
                },
                {
                    type: 'link',
                    text: 'Views',
                    href: VIEWS,
                },
                {
                    type: 'link',
                    text: 'Costs',
                    href: COSTS,
                },
            ],
        },
        {type: 'divider'}, // Separator.
        {
            type: 'section',
            text: 'Diagrams',
            items: [
                {
                    type: 'link',
                    text: 'Manage',
                    href: DRAW,
                },
            ],
        },
        {type: 'divider'}, // Separator.
        {
            type: 'section',
            text: 'Configure',
            items: [
                {
                    type: 'link',
                    text: 'Accounts',
                    href: ACCOUNTS,
                },
            ],
        },
        {type: 'divider'}, // Separator.
        {
            type: 'link',
            text: 'Feature request',
            href: 'https://github.com/awslabs/aws-perspective/issues/new?assignees=&labels=enhancement&template=feature_request.md&title=',
            external: true, // Indicates an external link.
        },
        {
            type: 'link',
            text: 'Raise an issue',
            href: 'https://github.com/awslabs/aws-perspective/issues/new?assignees=&labels=bug&template=bug_report.md&title=',
            external: true, // Indicates an external link.
        },
        {type: 'divider'}, // Separator.
    ];

    return (
        <>
            <SideNavigation
                items={navItems}
                header={navHeader}
                activeHref={location.pathname} // Sets the active navigation item based on current path.
                onFollow={e => {
                    // Handles navigation clicks: external links open in new tab, internal links use history.push.
                    if (e.detail.external) {
                        window.open(e.detail.href, '_blank', 'rel=noreferrer');
                    } else {
                        e.preventDefault();
                        history.push(e.detail.href);
                    }
                }}
            />
            {/* Displays application version, logged-in user, and sign-out button. */}
            <Box padding={{left: 'xl'}}>
                <SpaceBetween size={'m'}>
                    <Box>
                        Version:{' '}
                        <strong>{window.perspectiveMetadata.version}</strong>
                    </Box>
                    <Box>
                        Logged in as: <strong>{user.username}</strong>
                    </Box>
                    <Box>
                        <Button onClick={signOut} iconName={'external'}>
                            Sign out
                        </Button>
                    </Box>
                </SpaceBetween>
            </Box>
        </>
    );
};

Navigation.propTypes = {
    onNavigate: PropTypes.func.isRequired,
};

/**
 * Renders the help panel content based on the current route.
 * It dynamically loads the appropriate help component from the `panels` configuration.
 * @param {object} props - Component props.
 * @param {function} props.onNavigate - Callback function for navigation events (used by internal hooks).
 */
const ToolPanel = ({onNavigate}) => {
    const history = useHistory();
    const location = useLocation();
    history.listen(onNavigate);

    useLayoutEffect(() => {
        onNavigate(location);
    });

    // Finds the matching help panel component based on the current pathname.
    return R.pathOr(
        <PlaceholderHelp />, // Default placeholder if no matching panel is found.
        ['component'],
        R.find(
            e =>
                matchPath(location.pathname, {
                    path: e.path,
                    exact: true,
                }),
            panels
        )
    );
};

ToolPanel.propTypes = {
    onNavigate: PropTypes.func.isRequired,
};

/**
 * Dynamically loads and renders the split panel content based on the current route.
 * @param {object} props - Component props.
 * @param {function} props.onNavigate - Callback function for navigation events (used by internal hooks).
 */
const SplitPanelLoader = ({onNavigate}) => {
    const history = useHistory();
    const location = useLocation();
    history.listen(onNavigate);

    useLayoutEffect(() => {
        onNavigate(location);
    });
    // Finds the matching split panel component based on the current pathname.
    return R.pathOr(
        null, // Returns null if no matching split panel is found.
        ['component'],
        R.find(
            e =>
                matchPath(location.pathname, {
                    path: e.path,
                    exact: true,
                }),
            splitPanels
        )
    );
};

SplitPanelLoader.propTypes = {
    onNavigate: PropTypes.func.isRequired,
};

/**
 * Renders the main content area of the application by mapping routes to their respective components.
 * @param {object} props - Props passed to the route components.
 */
const Pages = props => (
    <div id="content-root">
        <Switch>
            {/* Iterates through defined routes and renders a Route for each. */}
            {routes.map(({component: Component, ...rest}) => (
                <Route {...rest} key={rest.title}>
                    <Component {...props} />
                </Route>
            ))}
        </Switch>
    </div>
);

/**
 * Checks if the current pathname corresponds to an "open diagram" route.
 * @param {string} pathname - The current URL pathname.
 * @returns {boolean} True if it's an open diagram route, false otherwise.
 */
function isOpenDiagram(pathname) {
    return (
        matchPath(pathname, {
            path: OPEN_DIAGRAM,
            exact: true,
            strict: false,
        }) != null
    );
}

/**
 * The main layout component for the application, utilizing Cloudscape's AppLayout.
 * It manages side navigation, tools panel, split panel, and integrates with global state contexts.
 */
export function PolarisLayout() {
    const history = useHistory(); // Accesses the React Router history object.
    const location = useLocation(); // Accesses the current location object.
    const isFirstMount = useFirstMountState(); // Hook to detect if it's the first render.
    const {clearAllNotifications} = useNotificationDispatch(); // Accesses notification dispatch.
    const [isFirstVisit, setIsFirstVisit] = useLocalStorage('firstVisit', true); // Manages 'first visit' state in local storage.
    const [navigationOpen, setNavigationOpen] = useState(
        location.pathname !== '/' // Navigation is open by default unless on homepage.
    );
    const [toolsOpen, setToolsOpen] = useState(false); // State for tools panel open/closed.
    const [currentPath, setCurrentPath] = useState(); // State to track the current path for layout adjustments.
    const [schema, setSchema] = useState(); // State for schema data (e.g., for diagramming).
    const [, dispatch] = useResourceState(); // Accesses resource state dispatch.
    const [, dispatchCanvas] = useDiagramSettingsState(); // Accesses diagram settings dispatch.
    const pathRef = useRef(location.pathname); // Ref to keep track of the previous pathname.

    // Effect hook to listen for history changes and reset application state.
    useEffect(() => {
        return history.listen(({pathname}) => {
            // Always open navigation if navigating from the homepage.
            if (pathRef.current === '/') setNavigationOpen(true);

            pathRef.current = pathname; // Update path reference.

            // If navigating to create or open a diagram, do not clear state.
            if (pathname === CREATE_DIAGRAM || isOpenDiagram(pathname)) return;

            // Clear notifications and reset resource/diagram settings state on route change.
            clearAllNotifications();
            dispatch({
                type: 'select',
                resources: {},
            });
            dispatch({
                type: 'updateGraphResources',
                graphResources: [],
            });
            dispatchCanvas({
                type: 'setCanvas',
                canvas: null,
            });
            dispatchCanvas({
                type: 'setResources',
                resources: [],
            });
        });
    }, [clearAllNotifications, dispatch, dispatchCanvas, history]);

    // Effect hook for initial visit redirection.
    useEffect(() => {
        if (isFirstVisit) {
            setIsFirstVisit(false); // Mark as not first visit.
        } else if (location.pathname === '/' && isFirstMount) {
            // If it's not the first visit and on homepage on first mount, redirect to resources.
            history.push(RESOURCES);
        }
    }, [
        history,
        isFirstMount,
        isFirstVisit,
        location.pathname,
        setIsFirstVisit,
    ]);

    // Integrates with the custom `useSplitPanel` hook for managing split panel state.
    const {
        splitPanelOpen,
        onSplitPanelToggle,
        splitPanelSize,
        onSplitPanelResize,
        splitPanelPreferences,
        onSplitPanelPreferencesChange,
    } = useSplitPanel(false); // `false` indicates split panel is initially closed.

    /**
     * Handles navigation events, updating the `currentPath` state.
     * @param {object} e - The navigation event object (from `history.listen`).
     */
    const handleNavigation = e => {
        if (e.pathname !== location.pathname) setCurrentPath(e.pathname);
    };

    return (
        // ErrorBoundary to catch and display errors in the UI, with a reset action.
        <ErrorBoundary
            FallbackComponent={ErrorFallback}
            onReset={() => {
                history.push('/'); // On reset, navigate back to the homepage.
            }}
        >
            {/* Main application layout provided by Cloudscape's AppLayout. */}
            <AppLayout
                content={<Pages schema={schema} setSchema={setSchema} />} // Main content area.
                disableContentPaddings={currentPath === '/'} // Disable content paddings on the homepage.
                navigation={
                    <Navigation onNavigate={handleNavigation} activeHref="/" /> // Side navigation component.
                }
                navigationOpen={navigationOpen} // Controls navigation panel visibility.
                toolsOpen={toolsOpen} // Controls tools panel visibility.
                tools={
                    <ToolPanel onNavigate={handleNavigation} activeHref="/" /> // Tools panel content.
                }
                notifications={<Notifications maxNotifications={1} />} // Notification display.
                toolsHide={location.pathname === '/'} // Hides tools panel on homepage.
                onNavigationChange={e => setNavigationOpen(e.detail.open)} // Callback for navigation toggle.
                onToolsChange={e => setToolsOpen(e.detail.open)} // Callback for tools panel toggle.
                splitPanelOpen={splitPanelOpen} // Controls split panel visibility.
                onSplitPanelToggle={onSplitPanelToggle} // Callback for split panel toggle.
                splitPanelSize={splitPanelSize} // Current size of the split panel.
                onSplitPanelResize={onSplitPanelResize} // Callback for split panel resize.
                splitPanelPreferences={splitPanelPreferences} // User preferences for split panel.
                onSplitPanelPreferencesChange={onSplitPanelPreferencesChange} // Callback for split panel preferences change.
                splitPanel={
                    <SplitPanelLoader
                        onNavigate={e => setCurrentPath(e.pathname)} // Callback for split panel navigation.
                        activeHref="/"
                    />
                }
            />
        </ErrorBoundary>
    );
}

export default PolarisLayout;
