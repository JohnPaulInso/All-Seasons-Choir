// ==========================================================================
// FAIORA SERVICE WORKER — FCM Background Push + Local Notifications
// ==========================================================================
// This service worker handles:
//   1. FCM background push messages (when app is closed)
//   2. Local notification display (when app is open)
//   3. Notification click → open/focus the app
//   4. Notification dismiss action
//
// LABEL: SW-FCM — Firebase Cloud Messaging integration
// LABEL: SW-LOCAL — Local notification scheduling
// LABEL: SW-CLICK — Notification click handling
// ==========================================================================

// --------------------------------------------------------------------------
// SECTION: SW-FCM — Import Firebase Messaging for background push
// --------------------------------------------------------------------------
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Initialize Firebase in the service worker
// NOTE: This must match the config in index.html
firebase.initializeApp({
    apiKey: "AIzaSyDktbyVgI7AAwaY2u-KsWBRwLZawy0949s",
    authDomain: "faiora-24f4a.firebaseapp.com",
    projectId: "faiora-24f4a",
    storageBucket: "faiora-24f4a.firebasestorage.app",
    messagingSenderId: "752265363994",
    appId: "1:752265363994:web:78795bfad67d2d541e07a3",
    measurementId: "G-B0DWSL1JMV"
});

// Get Firebase Messaging instance for background message handling
const messaging = firebase.messaging();

// --------------------------------------------------------------------------
// SECTION: SW-FCM — Handle background push messages from Cloud Functions
// --------------------------------------------------------------------------
// This fires when a push message arrives and the app is NOT in the foreground.
// The notification is automatically shown by Firebase SDK if a 'notification'
// payload is present. This handler is for data-only messages or custom logic.
messaging.onBackgroundMessage((payload) => {
    console.log('🔥 [SW] Background message received:', payload);

    // If there's no notification payload, build one from data
    if (payload.data && !payload.notification) {
        const title = payload.data.title || '🔥 Faiora Reminder';
        const body = payload.data.body || 'You have a task due!';

        return self.registration.showNotification(title, {
            body: body,
            icon: 'logo.png',
            badge: 'logo.png',
            tag: 'faiora-' + (payload.data.taskId || Date.now()),
            renotify: true,
            vibrate: [200, 100, 200],
            requireInteraction: true,
            actions: [
                { action: 'open', title: 'Open App' },
                { action: 'dismiss', title: 'Dismiss' }
            ],
            data: {
                url: self.location.origin,
                taskId: payload.data.taskId
            }
        });
    }
});

// --------------------------------------------------------------------------
// SECTION: SW-LOCAL — Handle local notification messages from main app
// --------------------------------------------------------------------------
// The main app sends messages via postMessage() for client-side scheduling
// (works as a fallback when the app is open)
self.addEventListener('message', (event) => {
    const data = event.data;

    // LABEL: SW-LOCAL-SCHEDULE — Schedule a local notification
    if (data && data.type === 'SCHEDULE_NOTIFICATION') {
        const { title, body, tag, timestamp } = data;
        const delay = timestamp - Date.now();

        if (delay <= 0) {
            showLocalNotification(title, body, tag);
        } else {
            setTimeout(() => {
                showLocalNotification(title, body, tag);
            }, delay);
        }
    }

    // LABEL: SW-LOCAL-CANCEL — Cancel/close a notification
    if (data && data.type === 'CANCEL_NOTIFICATION') {
        self.registration.getNotifications({ tag: data.tag }).then(notifications => {
            notifications.forEach(n => n.close());
        });
    }
});

// --------------------------------------------------------------------------
// SECTION: SW-LOCAL — Show a local notification
// --------------------------------------------------------------------------
function showLocalNotification(title, body, tag) {
    self.registration.showNotification(title, {
        body: body,
        icon: 'logo.png',
        badge: 'logo.png',
        tag: tag,
        renotify: true,
        vibrate: [200, 100, 200],
        requireInteraction: true,
        actions: [
            { action: 'open', title: 'Open App' },
            { action: 'dismiss', title: 'Dismiss' }
        ],
        data: {
            url: self.location.origin
        }
    });
}

// --------------------------------------------------------------------------
// SECTION: SW-CLICK — Handle notification tap/click
// --------------------------------------------------------------------------
// When user taps the notification:
//   - "Open App" action or tap body → opens/focuses the app
//   - "Dismiss" action → just closes the notification
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    // If user clicked "Dismiss", do nothing
    if (event.action === 'dismiss') return;

    // Otherwise, open or focus the app
    const targetUrl = event.notification.data?.url || self.location.origin;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // If the app is already open in a tab, focus it
            for (const client of clientList) {
                if ((client.url.includes('index.html') || client.url.includes('Faiora')) && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise, open a new browser tab/window
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

// --------------------------------------------------------------------------
// SECTION: SW-LIFECYCLE — Install & Activate
// --------------------------------------------------------------------------
// Skip waiting and claim clients immediately so the SW takes effect right away
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});
