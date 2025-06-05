// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module provides utilities for registering and unregistering a service worker.
 * Service workers enable web applications to work offline, load faster on subsequent visits,
 * and provide a more app-like experience by caching assets.
 * This code is based on the Create React App service worker setup.
 */

// This optional code is used to register a service worker.
// register() is not called by default.

// This lets the app load faster on subsequent visits in production, and gives
// it offline capabilities. However, it also means that developers (and users)
// will only see deployed updates on subsequent visits to a page, after all the
// existing tabs open on the page have been closed, since previously cached
// resources are updated in the background.

// To learn more about the benefits of this model and instructions on how to
// opt-in, read https://bit.ly/CRA-PWA

/**
 * Determines if the application is running on a localhost environment.
 * This is used to apply different service worker behaviors for development vs. production.
 */
const isLocalhost = Boolean(
    window.location.hostname === 'localhost' ||
        // [::1] is the IPv6 localhost address.
        window.location.hostname === '[::1]' ||
        // 127.0.0.1/8 is considered localhost for IPv4.
        window.location.hostname.match(
            /^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/ // Regex to match 127.x.x.x
        )
);

/**
 * Registers a service worker if the application is running in production mode
 * and the browser supports service workers.
 * It handles different registration flows for localhost and non-localhost environments.
 * @param {object} [config] - Optional configuration object with `onUpdate` and `onSuccess` callbacks.
 */
export function register(config) {
    // Check if in production environment and service workers are supported by the browser.
    if (
        import.meta.env.NODE_ENV === 'production' &&
        'serviceWorker' in navigator
    ) {
        // The URL constructor is available in all browsers that support SW.
        const publicUrl = new URL('/', window.location.href);
        // Ensure the service worker URL is on the same origin as the page.
        if (publicUrl.origin !== window.location.origin) {
            // Our service worker won't work if PUBLIC_URL is on a different origin
            // from what our page is served on. This might happen if a CDN is used to
            // serve assets; see https://github.com/facebook/create-react-app/issues/2374
            return;
        }

        window.addEventListener('load', () => {
            const swUrl = `./service-worker.js`; // Path to the service worker file.

            if (isLocalhost) {
                // This is running on localhost. Let's check if a service worker still exists or not.
                checkValidServiceWorker(swUrl, config);

                // Add some additional logging to localhost, pointing developers to the
                // service worker/PWA documentation.
                navigator.serviceWorker.ready.then(() => {
                    console.log(
                        'This web app is being served cache-first by a service ' +
                            'worker. To learn more, visit https://bit.ly/CRA-PWA'
                    );
                });
            } else {
                // Is not localhost. Just register service worker
                registerValidSW(swUrl, config);
            }
        });
    }
}

/**
 * Registers the service worker with the browser.
 * It sets up listeners for service worker state changes (e.g., 'installed')
 * and triggers callbacks for content updates or initial caching success.
 * @param {string} swUrl - The URL of the service worker script.
 * @param {object} [config] - Optional configuration object with `onUpdate` and `onSuccess` callbacks.
 */
function registerValidSW(swUrl, config) {
    navigator.serviceWorker
        .register(swUrl)
        .then(registration => {
            registration.onupdatefound = () => {
                const installingWorker = registration.installing;
                if (installingWorker == null) {
                    return;
                }
                installingWorker.onstatechange = () => {
                    if (installingWorker.state === 'installed') {
                        if (navigator.serviceWorker.controller) {
                            // At this point, the updated precached content has been fetched,
                            // but the previous service worker will still serve the older
                            // content until all client tabs are closed.
                            console.log(
                                'New content is available and will be used when all ' +
                                    'tabs for this page are closed. See https://bit.ly/CRA-PWA.'
                            );

                            // Execute callback if provided.
                            checkConfigUpdate(config, registration);
                        } else {
                            // At this point, everything has been precached.
                            // It's the perfect time to display a
                            // "Content is cached for offline use." message.
                            console.log('Content is cached for offline use.');

                            // Execute callback if provided.
                            checkConfigSuccess(config, registration);
                        }
                    }
                };
            };
        })
        .catch(error => {
            console.error('Error during service worker registration:', error);
        });
}

/**
 * Checks if a service worker file can be found at the given URL.
 * If not found (404 or incorrect content type), it unregisters any existing
 * service worker and reloads the page.
 * @param {string} swUrl - The URL of the service worker script.
 * @param {object} [config] - Optional configuration object.
 */
function checkValidServiceWorker(swUrl, config) {
    // Check if the service worker can be found. If it can't reload the page.
    fetch(swUrl)
        .then(response => {
            // Ensure service worker exists, and that we really are getting a JS file.
            const contentType = response.headers.get('content-type');
            if (
                response.status === 404 ||
                (contentType != null &&
                    contentType.indexOf('javascript') === -1)
            ) {
                // No service worker found. Probably a different app. Reload the page.
                navigator.serviceWorker.ready.then(registration => {
                    registration.unregister().then(() => {
                        window.location.reload();
                    });
                });
            } else {
                // Service worker found. Proceed as normal.
                registerValidSW(swUrl, config);
            }
        })
        .catch(() => {
            console.log(
                'No internet connection found. App is running in offline mode.'
            );
        });
}

/**
 * Executes the `onUpdate` callback from the config object if it exists.
 * @param {object} [config] - The configuration object.
 * @param {ServiceWorkerRegistration} registration - The service worker registration object.
 */
function checkConfigUpdate(config, registration) {
    if (config?.onUpdate) {
        config.onUpdate(registration);
    }
}

/**
 * Executes the `onSuccess` callback from the config object if it exists.
 * @param {object} [config] - The configuration object.
 * @param {ServiceWorkerRegistration} registration - The service worker registration object.
 */
function checkConfigSuccess(config, registration) {
    if (config?.onSuccess) {
        config.onSuccess(registration);
    }
}

/**
 * Unregisters any active service worker.
 * This function is typically called when offline capabilities are not desired.
 */
export function unregister() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => {
            registration.unregister();
        });
    }
}
