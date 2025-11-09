# E-Boda Rider App

A React Native mobile app built with Expo for requesting rides from the E-Boda ride-hailing platform.

## Features

- **User Authentication** - Secure login/registration with JWT tokens
- **Real-time Map** - View your location and nearby available drivers
- **Ride Requests** - Request rides and track driver in real-time via WebSocket
- **Live Tracking** - Follow driver location as they approach and during the ride
- **Ride Summary** - View ride details and rate drivers after completion
- **Secure Token Storage** - JWT tokens stored securely with Expo SecureStore

## Setup

### Prerequisites

- Node.js 16+
- Expo CLI: `npm install -g expo-cli`
- Backend running on `http://localhost:8000`

### Installation

\`\`\`bash
# Install dependencies
npm install

# Start the app
npm start

# Run on iOS or Android
npm run ios
# or
npm run android
\`\`\`

### Environment Configuration

Update `.env` with your backend URLs:

\`\`\`
API_BASE_URL=http://localhost:8000
WS_BASE_URL=ws://localhost:8000/ws
GOOGLE_MAPS_API_KEY=YOUR_API_KEY
\`\`\`

## Architecture

### State Management

Uses **Zustand** for global state management:

- User authentication state
- Current ride information
- Nearby drivers list

### Services

- **API Service** - Axios instance with automatic JWT token injection
- **WebSocket Service** - Real-time driver location and ride status updates

### Screens

- **LoginScreen** - User authentication
- **RegisterScreen** - New user registration
- **MapScreen** - Main ride-hailing interface with map
- **RideSummaryScreen** - Post-ride rating and feedback

### Components

- **MapViewComponent** - Renders map with user and driver markers
- **RideStatusCard** - Shows current ride status and details
- **DriverMarker** - Custom marker for driver locations

## Key Flows

### Authentication

1. User enters email/password
2. Backend validates and returns user data + JWT token
3. Token stored in SecureStore for future requests
4. App navigates to MapScreen

### Ride Request

1. User enters destination
2. App sends ride request with pickup/dropoff coordinates
3. Backend finds nearest driver and creates ride
4. Rider joins WebSocket room for real-time updates
5. Driver accepts ride
6. Driver location streamed via WebSocket
7. Rider can track driver in real-time

### WebSocket Events

- `driver_location_update` - Driver's current location
- `ride_status_update` - Ride status changes (accepted, in_progress, completed)
- `ride_cancelled` - Ride was cancelled

## API Integration

### Authentication Endpoints

\`\`\`
POST /api/auth/login
POST /api/auth/register
PUT /api/auth/me/location
\`\`\`

### Ride Endpoints

\`\`\`
POST /api/rides/request
GET /api/rides/nearby-drivers
GET /api/rides/{ride_id}
POST /api/rides/{ride_id}/cancel
POST /api/rides/{ride_id}/rate
\`\`\`

## Deployment

To deploy to production:

1. Update `.env` with production backend URLs
2. Build the app: `eas build --platform ios --platform android`
3. Submit to Apple App Store and Google Play Store

## Troubleshooting

### Location Permission Issues

Ensure location permissions are granted on device. The app requests foreground location access on startup.

### WebSocket Connection Failed

- Check backend is running on `WS_BASE_URL`
- Verify network connectivity
- Check JWT token validity

### Nearby Drivers Not Showing

- Ensure drivers are marked as available in backend
- Check driver geospatial index is set up correctly

## Next Steps

- Driver app for accepting rides
- Admin dashboard for platform management
- Payment integration
- Rating and review system enhancements
