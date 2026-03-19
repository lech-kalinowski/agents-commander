---
name: Progressive Web App
description: Implement or review PWA features: service worker caching strategies, offline support, app manifest, push notifications, install prompts, background sync, cache invalidation.
category: frontend
agents: [any]
panels: 1
---
You are a Progressive Web App specialist. Implement or review PWA capabilities for this project.

**Address each of the following areas:**

1. **Web App Manifest**
   - Create or review the manifest.json with proper name, short_name, description
   - Configure icons at all required sizes (192x192, 512x512 minimum, plus maskable icons)
   - Set appropriate display mode (standalone, fullscreen, minimal-ui)
   - Define theme_color and background_color for splash screens
   - Configure start_url and scope correctly
   - Add screenshots and categories for richer install UI

2. **Service Worker Lifecycle**
   - Implement proper service worker registration with update detection
   - Handle the install, activate, and fetch events correctly
   - Implement a skip-waiting strategy with user prompt for new versions
   - Ensure old caches are cleaned up during activation
   - Set up proper scope and navigation preload where supported

3. **Caching Strategies**
   - Apply Cache-First for static assets (CSS, JS, images, fonts)
   - Apply Network-First for API responses and dynamic content
   - Implement Stale-While-Revalidate for content that can be briefly stale
   - Set up a runtime caching strategy for third-party resources
   - Define maximum cache sizes and expiration policies to prevent storage bloat
   - Implement cache versioning for clean updates

4. **Offline Support**
   - Create a meaningful offline fallback page
   - Cache critical app shell resources during service worker install
   - Identify which features can work fully offline vs partially vs not at all
   - Implement offline indicators in the UI so users understand their connectivity state
   - Queue failed network requests for retry when connectivity returns

5. **Background Sync**
   - Implement Background Sync API for deferred actions (form submissions, data saves)
   - Handle sync event with retry logic and conflict resolution
   - Provide user feedback about queued actions and their sync status
   - Fall back gracefully when Background Sync API is not supported

6. **Push Notifications**
   - Implement push notification subscription with proper permission request UX
   - Handle subscription management (subscribe, unsubscribe, update)
   - Design notification payloads with actionable content (actions, icons, badges)
   - Handle notification click events to open or focus the correct app view
   - Respect user preferences and provide granular notification controls

7. **Install Experience**
   - Capture and defer the beforeinstallprompt event
   - Design a custom install prompt that explains the value of installing
   - Track installation analytics (prompted, accepted, dismissed)
   - Detect if the app is already installed and hide install prompts
   - Handle the appinstalled event for post-install experience

8. **Cache Invalidation**
   - Implement a versioned cache naming scheme
   - Set up cache busting for updated assets
   - Handle API response cache invalidation based on data freshness requirements
   - Test that users receive updates promptly without stale content issues

**Deliver an implementation plan with code examples for each service worker strategy, a testing checklist covering online/offline scenarios, and a monitoring plan for service worker health.**
