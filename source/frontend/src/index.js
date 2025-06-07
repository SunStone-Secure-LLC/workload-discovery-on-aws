// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react'; // Imports the React library for building user interfaces.
import {createRoot} from 'react-dom/client'; // Imports `createRoot` from React DOM client for concurrent mode rendering.
import './index.css'; // Imports the global CSS styles for the application.
import App from './App'; // Imports the main App component of the application.
import * as serviceWorker from './serviceWorker'; // Imports the service worker registration utilities.
import {Amplify} from 'aws-amplify'; // Imports the Amplify library for AWS cloud services integration.

// Configures AWS Amplify using the global `window.amplify` object,
// which is typically populated by the Amplify CLI or a build process.
Amplify.configure(window.amplify);

// Gets the root DOM element where the React application will be mounted.
const root = createRoot(document.getElementById('root'));
// Renders the main App component into the root DOM element.
root.render(<App />);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
// Unregisters the service worker. This means the app will not work offline
// and will always fetch resources from the network.
serviceWorker.unregister();
