// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react'; // Imports the React library for building user interfaces.
import {
    Authenticator, // Amplify UI component for authentication flows.
    Heading, // Amplify UI component for headings.
    Image, // Amplify UI component for displaying images.
    ThemeProvider, // Amplify UI component for applying custom themes.
    Button, // Amplify UI component for buttons.
} from '@aws-amplify/ui-react'; // Imports components from the Amplify UI React library.
import {Auth} from 'aws-amplify'; // Imports the Auth module from AWS Amplify for authentication operations.
import '@cloudscape-design/global-styles/index.css'; // Imports global styles from Cloudscape Design System.
import '@aws-amplify/ui-react/styles.css'; // Imports default styles for Amplify UI components.
import Main from './Main'; // Imports the Main component, which is the core application content.
import {Box, SpaceBetween} from '@cloudscape-design/components'; // Imports layout components from Cloudscape Design System.
import * as awsui from '@cloudscape-design/design-tokens'; // Imports design tokens from Cloudscape for consistent styling.

/**
 * Defines custom UI components to be used within the Amplify Authenticator.
 * This allows for branding and custom layout within the authentication flow.
 */
const components = {
    /**
     * Custom Header component for the Authenticator.
     * Displays the application icon and title.
     */
    Header() {
        return (
            <Box
                margin={{vertical: 'm', horizontal: 'xl'}}
                textAlign={'center'}
            >
                <SpaceBetween size={'xl'}>
                    <Image
                        alt="Workload Discovery on AWS icon"
                        src="/icons/AWS-Zoom_light-bg.svg"
                        objectFit="initial"
                        objectPosition="50% 50%"
                        backgroundColor="initial"
                        height="120px"
                        width="120px"
                        opacity="100%"
                    />
                    <Heading level={3}>Workload Discovery on AWS</Heading>
                </SpaceBetween>
            </Box>
        );
    },
    /**
     * Custom Footer component for the Authenticator.
     * Displays a "Sign in via Federated Identity Provider" button if a federated IdP is configured.
     */
    Footer() {
        // Renders the button only if a federated identity provider resource is configured in window.amplify.Auth.
        return window.amplify.Auth?.federatedIdpResource != null ? (
            <SpaceBetween size={'xs'}>
                <Box margin={{vertical: 'm'}} textAlign={'center'}>
                    <Button
                        align="center"
                        variation="primary"
                        onClick={() =>
                            // Triggers federated sign-in using the custom provider.
                            Auth.federatedSignIn({
                                customProvider:
                                    window.amplify.Auth.federatedIdpResource,
                            })
                        }
                    >
                        {' '}
                        Sign in via Federated Identity Provider
                    </Button>
                </Box>
            </SpaceBetween>
        ) : null; // Renders nothing if no federated IdP is configured.
    },
};

/**
 * The main application component.
 * It sets up the global theme using Amplify's ThemeProvider and wraps the core
 * application content (`Main` component) within Amplify's Authenticator.
 * This ensures that the entire application is protected by the authentication flow.
 */
export const App = () => {
    // Defines a custom theme for Amplify UI components, primarily adjusting brand colors
    // and font family to align with Cloudscape Design System tokens.
    const theme = {
        name: 'theme',
        tokens: {
            fonts: {
                default: {
                    variable: {value: awsui.fontFamilyBase}, // Uses Cloudscape's base font family for variable fonts.
                    static: {value: awsui.fontFamilyBase}, // Uses Cloudscape's base font family for static fonts.
                },
            },
            colors: {
                brand: {
                    primary: {
                        10: {value: awsui.colorBackgroundButtonPrimaryDisabled}, // Disabled primary button background.
                        80: {value: awsui.colorBackgroundButtonPrimaryDefault}, // Default primary button background.
                        90: {value: awsui.colorBackgroundButtonPrimaryHover}, // Primary button background on hover.
                        100: {value: awsui.colorBackgroundButtonPrimaryActive}, // Primary button background when active.
                    },
                },
            },
        },
    };

    return (
        // Applies the custom theme to all Amplify UI components within its scope.
        <ThemeProvider theme={theme}>
            {/* Authenticator component wraps the main application content.
                It uses custom Header and Footer components and hides the sign-up option. */}
            <Authenticator components={components} hideSignUp={true}>
                {/* The main content of the application, rendered only after successful authentication. */}
                <Main />
            </Authenticator>
        </ThemeProvider>
    );
};

export default App;
