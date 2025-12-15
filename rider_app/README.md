# E-Boda Rider App

Production-grade React Native mobile application built with Expo for requesting and tracking rides in real-time using the E-Boda ride-hailing platform.

## App Overview

E-Boda Rider connects users with nearby electric motorcycle drivers through:

- Secure JWT-based authentication with persistent login
- Real-time WebSocket connection for live driver location and status updates
- Interactive map showing user location, nearby drivers, and route polylines
- Complete ride lifecycle from request through completion and rating
- Robust state management with offline persistence and app lifecycle handling

## Tech Stack

- **Framework**: React Native 0.74.5 with Expo 51.0.0
- **State Management**: Zustand 4.4.0 for global state (auth, ride, location)
- **Networking**: Axios 1.6.0 with JWT interceptor; custom WebSocket client
- **Maps**: React Native Maps 1.14.0 with Google Maps API integration
- **Navigation**: React Navigation 6.1.0 (bottom tabs, stack navigation)
- **Location**: Expo Location 17.0.0 with foreground tracking
- **Storage**: Expo SecureStore 13.0.0 (JWT token), AsyncStorage 1.23.1 (ride state)
- **UI**: React Native built-in components with custom styling

## Folder Structure

\`\`\`
rider_app/
├── App.js # Root component, navigation setup
├── screens/
│ ├── LoginScreen.js # Email/password login
│ ├── RegisterScreen.js # New user signup
│ ├── MapScreen.js # Main ride request and tracking
│ └── RideSummaryScreen.js # Post-ride rating and feedback
├── components/
│ ├── MapViewComponent.js # Map rendering with markers and polylines
│ ├── RideStatusCard.js # Ride status UI (finding driver, en route, etc)
│ ├── DestinationSearch.js # Google Places autocomplete
│ ├── CancelRideModal.js # Ride cancellation modal
│ ├── DriverMarker.js # Custom driver marker component
│ └── Toast.js # Toast notification overlay
├── services/
│ ├── api.js # Axios instance, API calls
│ └── websocket.js # WebSocket client, connection lifecycle
├── store/
│ └── useUserStore.js # Zustand store for auth, ride, users
├── .env # Environment variables
├── app.json # Expo config
├── package.json # Dependencies
└── README.md # This file
\`\`\`

## Environment Configuration

Create `.env` file in `rider_app/`:

\`\`\`
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8000
EXPO_PUBLIC_WS_BASE_URL=ws://10.0.2.2:8000/ws/ride
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=YOUR_API_KEY
\`\`\`

Note: `10.0.2.2` is the Android emulator's host IP; replace with actual IP/domain for physical devices or iOS.

## Installation & Setup

### Prerequisites

- Node.js 16+
- Expo CLI: `npm install -g expo-cli`
- Backend running (see backend README)
- Google Maps API key with Directions API enabled

### Local Development

\`\`\`bash

# 1. Install dependencies

npm install

# 2. Create .env file (see above)

cp .env.example .env

# Edit with your backend URL and API keys

# 3. Start the development server

npm start

# 4. Run on emulator/device

npm run android # Android emulator
npm run ios # iOS simulator
npm run web # Web preview (limited features)

# 5. Test login

# Use credentials created in backend

# Email: test@example.com

# Password: password123

\`\`\`

## State Management (Zustand Store)

### useUserStore

\`\`\`javascript
const store = useUserStore()

// Auth state
store.user // { id, full_name, email, phone, role, token }
store.isAuthenticated
store.setUser(user, token)
store.logout()

// Current ride
store.currentRide // { id, status, driver, pickup, dropoff, ... }
store.setCurrentRide(ride)
store.clearRide()

// Nearby drivers
store.nearbyDrivers // [ { id, location, rating, vehicle }, ... ]
store.setNearbyDrivers(drivers)

// Pickup location
store.pickupLocation // { latitude, longitude, address, place_name }
store.setPickupLocation(location)

// Selected destination
store.selectedDestination // { latitude, longitude, address }
store.setSelectedDestination(destination)

// Auto-persist ride state to AsyncStorage for app restarts
\`\`\`

## App Lifecycle & State Recovery

### Cold Start (Kill & Restart)

1. **App Launches** → `initPersistedRide` useEffect runs
2. **Loads AsyncStorage** → Checks for persisted ride
3. **Validates with GET** → Calls `GET /rides/{ride_id}` to verify ride is still active
4. **Hydrates State** → If valid and active status, restores `currentRide` in Zustand
5. **Initiates Polyline** → If pickup/dropoff exist, fetches route via Google Directions API
6. **Connects WebSocket** → After validation succeeds, establishes WS connection
7. **Joins Room** → After WS connection, calls `join_ride` event

**State Recovery**:

- Terminal rides (completed, cancelled) are NOT restored
- Unknown statuses (e.g., 404 error) retry GET request up to 3 times with 1s delays
- If GET times out during startup, keeps local ride state and attempts to rejoin room

### Foreground Resume (Backgrounded → Active)

1. **AppState** listener detects `inactive` → `active`
2. **Connection Health Check** → Verifies WebSocket is still open and responsive
3. **If Unhealthy** → Triggers `_forceReconnect()` with exponential backoff
4. **Upon Reconnect** → Clears `joinedRooms` (server subscriptions are lost)
5. **Retries Room Join** → Calls `join_ride` again to re-subscribe
6. **Continues Tracking** → Receives driver location updates

**Background Handling**:

- WebSocket connection is closed when app backgrounds
- Pending join promises are rejected
- Reconnect attempts pause (not initiated in background)
- Location polling stops

### App State Transitions

\`\`\`
active (default)
↓
├─ User presses home → inactive
│ ↓
│ └─ User switches back to app → active
│ (Reconnect triggers if needed)
│
└─ System kills background processes → closed
↓
└─ User relaunches app → active (cold start)
\`\`\`

## WebSocket Integration

### Connection Lifecycle

\`\`\`javascript
// In MapScreen.connectWebSocket()
const ws = new WebSocketService()

// Register callbacks for state recovery
ws.setOnReconnectCallback((reason) => {
// reason: "reconnected" or "foreground_resume"
validateAndSyncRide() // GET ride and restore state
})

// Connect (token obtained from login)
ws.connect(userId, jwtToken, rideId)

// Manual room join (after validation)
ws.joinRide(rideId)
.then(() => console.log("Joined ride room"))
.catch(err => console.error("Join failed", err))
\`\`\`

### Event Handling

\`\`\`javascript
// Subscribe to events
ws.on("driver_location_update", (event) => {
// event.latitude, event.longitude
updateMapMarker(event.driver_id, event.latitude, event.longitude)
})

ws.on("ride_accepted", (event) => {
// event.driver contains driver details
setCurrentRide({...currentRide, status: "accepted", driver: event.driver})
})

ws.on("ride_completed", (event) => {
// Ride finished, navigate to rating screen
navigation.navigate("RideSummary")
})

ws.on("connected", (event) => {
// Connection established
// event.active_ride tells us if user is in an ongoing ride
if (event.active_ride?.status === "completed") {
clearRideState() // Don't restore completed rides
}
})
\`\`\`

### Keepalive & Health Monitoring

- **Client pings server** every 15 seconds if no activity
- **Server responds with pong** to confirm connection is alive
- **Reconnect triggers** if pong not received within 10 seconds
- **Stale detection**: If no heartbeat for 45 seconds, connection is dropped

## Map Behavior & Route Polylines

### Markers

- **User Marker**: Blue pulsing dot at user's current location (updated via Expo Location)
- **Assigned Driver Marker**: Motorcycle emoji at driver's real-time location
- **Nearby Drivers**: Motorcycle emojis for all available drivers within search radius
- **Destination Marker**: Pin emoji at dropoff location

### Route Polyline

- **Fetched when**: Ride is requested (user taps "Request Ride")
- **Uses**: Google Directions API to encode polyline between pickup and dropoff
- **Rendering**: MapViewComponent renders polyline as blue line on map
- **Cleared when**: Ride completed or cancelled
- **Cold restart recovery**: If app kills, polyline is re-fetched during `initPersistedRide`

**Polyline Rendering Timing**:

- Polyline only renders AFTER map's native view is fully mounted (`onMapReady` callback)
- Prevents race conditions where route data arrives before map is ready
- Uses a `polylineKey` state to force re-render when route changes post-ready

### Location Tracking

- **Frequency**: Updated every time OS provides new location (usually 5-10 seconds)
- **Accuracy**: Uses high accuracy location type from Expo Location
- **Permissions**: Foreground location permission required; background tracking paused
- **Not sent to server**: User location is NOT broadcast to driver (for privacy)

## Screens

### LoginScreen

- Email and password inputs
- Validates credentials against `/auth/login`
- Stores JWT token in SecureStore
- Navigates to MapScreen on success

### RegisterScreen

- Email, password, full name, phone inputs
- Calls `POST /auth/register`
- Validates email format and password strength
- Auto-login after registration

### MapScreen (Main Screen)

- Displays map with user location, nearby drivers
- Destination search input (Google Places autocomplete)
- Ride request button
- Ride status card showing current ride state
- Cancel ride button (for pending and assigned statuses)
- Handles all WebSocket connection and room joining logic

**Ride Statuses Displayed**:

- **pending**: "Finding Driver..." with loading animation
- **accepted**: "Driver Accepted" + driver details
- **driver_arriving**: "Driver Arriving" + ETA
- **in_progress**: "Trip In Progress" + distance/fare
- **completed**: Navigate to RideSummaryScreen
- **cancelled**: Alert + navigate to home

### RideSummaryScreen

- Shows completed ride summary (distance, fare, driver rating)
- Star rating input (1-5 stars)
- Feedback text area
- Submit button to call `POST /rides/{ride_id}/rating`
- "Back to Home" button

## Ride Cancellation

**Allowed Statuses**: `pending` and `driver_arriving`

**Not Allowed**: `in_progress` (unless `ALLOW_CANCELLATION_DURING_TRIP=true` on backend)

**Flow**:

1. User taps "Cancel Ride" button
2. Modal appears with cancellation reason options
3. User selects reason and confirms
4. Frontend calls `POST /rides/{ride_id}/cancel`
5. Backend updates ride status to `cancelled`
6. Backend broadcasts `ride_cancelled` event
7. Frontend clears ride state and returns to home

**Cancellation Fee**: If configured, applied by backend and returned in response

## Toast Notifications

- Auto-dismiss after 3 seconds
- Slide-up animation from bottom
- High z-index (elevation 15) to appear above map
- Used for success (green), error (red), and info (blue) messages

**Examples**:
\`\`\`javascript
showToast("Ride requested successfully!", "success")
showToast("Error accepting ride", "error")
showToast("Driver is arriving", "info")
\`\`\`

## Critical Timing & Constraints

### Startup Phase Stability (First 1.5 seconds)

- AppState changes during startup are ignored (prevent false reconnects)
- WebSocket validates after startup phase completes
- Prevents cold start from immediately triggering reconnect logic

### Foreground Resume Timing

- Connection health check + potential reconnect: ~1s
- Reconnect callback delay: +500ms (wait for connection to stabilize)
- AppState stability check: 500ms minimum
- Total startup recovery: ~1-2 seconds

### Polyline Rehydration

- Only runs on cold startup (not foreground resume)
- Waits for startup phase to complete before fetching directions
- Requires valid pickup/dropoff coordinates from validated ride

### Join Room Idempotency

- Calling `join_ride` twice is safe (returns immediately if already joined)
- Foreground resume clears `joinedRooms` to force re-join
- Prevents duplicate room subscriptions

## Known Limitations & Not Implemented

- **No push notifications**: Must have app open to receive updates
- **No offline requests**: Cannot request ride while backend is unavailable
- **No payment integration**: Fare is estimate only, no actual payment
- **No multi-ride support**: Only one active ride per user at a time
- **No saved places**: Each request requires entering destination
- **No driver rating filter**: Cannot search by minimum driver rating
- **No promotions/discounts**: No promo code or surge pricing support
- **Limited navigation options**: No turn-by-turn directions for driver
- **No SMS confirmation**: No SMS or email notifications sent to user
- **No ride history**: Only current/recent rides, not complete history filter

## Performance Optimizations

- **Zustand debouncing**: State updates are not debounced; rely on WebSocket throttling
- **Map re-renders**: Memoized marker components to prevent unnecessary re-renders
- **Location throttling**: Server throttles driver location at 400ms minimum intervals
- **Image optimization**: Marker assets are lightweight SVG-based components
- **WebSocket health checks**: Adaptive ping intervals based on app state

## Debugging

Enable detailed logs with:

\`\`\`javascript
// In websocket.js
console.log("[WebSocket] ...")

// In MapScreen.js
console.log("[MapScreen] ...")

// Android Emulator: Ctrl+M (macOS: Cmd+M) for dev menu
// iOS Simulator: Cmd+D for dev menu
// View logs: npm start → press L for logs, A for Android logcat
\`\`\`

## Project Status

**Phase 1 Complete**: Core ride-hailing functionality (request, accept, track, complete, rate)

**Phase 2 Planned** (see backend README_PHASE2.md):

- Driver app
- Admin dashboard
- Payment processing
- Advanced metrics and analytics
- Multi-city support
- Promo codes and surge pricing

---

**Built with React Native and WebSocket for real-time, production-grade ride-hailing.**
