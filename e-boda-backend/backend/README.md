# E-Boda Backend API

**FastAPI backend for the E-Boda ride-hailing platform** — connecting passengers with electric boda (motorcycle) drivers in Kampala, Uganda.

---

## 🚀 Features

- **JWT Authentication** with role-based access (rider, driver, admin)
- **Ride Lifecycle Management** — from request to completion
- **Google Maps Integration** (Distance Matrix + Directions APIs)
- **Real-time WebSocket Updates** for driver location and ride status
- **Nearby Driver Search** via MongoDB geospatial queries
- **Scalable, Modular Architecture** built for production
- **Admin Dashboard Endpoints** for full platform control

---

## 🛠️ Tech Stack

| Component | Technology                                  |
| --------- | ------------------------------------------- |
| Framework | **FastAPI (Python 3.9+)**                   |
| Database  | **MongoDB + MongoEngine ODM**               |
| Auth      | **JWT (JSON Web Tokens)**                   |
| Real-Time | **WebSockets**                              |
| Mapping   | **Google Maps API (Distance + Directions)** |
| Docs      | **Swagger / ReDoc (auto-generated)**        |

---

## 📁 Project Structure

backend/
├── main.py # FastAPI entry point
├── database.py # MongoDB connection
├── logging_config.py # Logging setup (file + console)
├── logs/ # App log storage
├── models/
│ ├── user_model.py
│ └── ride_model.py
├── routes/
│ ├── auth_routes.py
│ ├── ride_routes.py
│ └── admin_routes.py
├── sockets/
│ ├── ride_socket.py
│ └── ws_auth.py
├── utils/
│ ├── jwt_utils.py
│ └── helpers.py
├── requirements.txt
├── .env.example
└── README.md

---

## ⚙️ Installation & Setup

### Prerequisites

- Python 3.9+
- MongoDB (local or Atlas)
- Google Cloud Project (for Maps API)
- pip package manager

### Steps

```bash
# 1. Clone repo
git clone https://github.com/<your-username>/e-boda-backend.git
cd e-boda-backend/backend

# 2. Create and activate virtual environment
python -m venv venv
source venv/bin/activate   # macOS/Linux
# venv\Scripts\activate    # Windows

# 3. Install dependencies
pip install -r requirements.txt

# 4. Setup environment variables
cp .env.example .env

# 5. Run the app
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### API Overview

## Authentication (/auth)

Method Endpoint Description
POST /auth/register Register new user
POST /auth/login Login and get token
GET /auth/me Get current user profile
PUT /auth/me/location Update driver location
PUT /auth/me/availability Toggle driver availability

## Rides (/rides)

Method Endpoint Description
POST /rides/request Request a ride
GET /rides/available Drivers: get available rides
GET /rides/nearby-drivers Riders: find nearby drivers
POST /rides/{ride_id}/accept Accept a ride
POST /rides/{ride_id}/start Start a ride
POST /rides/{ride_id}/complete Complete a ride
GET /rides/user/{user_id} Ride history
GET /rides/{ride_id} Ride details

## Admin (/admin)

Method Endpoint Description
GET /admin/users Get all users
GET /admin/drivers Get all drivers
GET /admin/rides Get all rides
GET /admin/stats Platform stats
PUT /admin/users/{user_id}/status Update user status
DELETE /admin/rides/{ride_id} Delete ride

### WebSocket API (/ws/ride)

# Connect:

ws://localhost:8000/ws/ride?token=<JWT_TOKEN>

# Events

# Client → Server

{ "event_type": "join_ride", "ride_id": "ride_id_here" }

{ "event_type": "location_update", "ride_id": "ride_id_here", "latitude": 0.3476, "longitude": 32.5825 }

# Server → Client

{ "event_type": "ride_accepted", "ride_id": "..." }

{ "event_type": "driver_location_update", "ride_id": "...", "latitude": 0.3476, "longitude": 32.5825 }

{ "event_type": "ride_completed", "ride_id": "...", "final_fare": 5500 }

### Security

- All REST and WS routes require valid JWT.

- Role-based access control for rider/driver/admin.

- Unauthorized access returns 401 or 403.

- WebSocket tokens verified on connection.

### Google Maps Integration

- Distance Matrix API → distance & ETA

- Directions API → route polyline

- Fallback → Haversine formula if API fails

- 2dsphere index for nearby driver search:

- db.users.createIndex({ location: "2dsphere" })

### Logging & Error Handling

- Logs stored in logs/eboda.log

- Rotating file handler + console output

- Consistent error handling across modules

- Example:
  - logger.error(f"Error handling ride update: {str(e)}", exc_info=True)

### Performance

- Nearby drivers limited to 10 results

- WS auto-cleanup on disconnect

- Async I/O for API calls

- MongoDB optimized with indexes

### Testing

- Quick Test Commands

# Health check

curl http://localhost:8000/health

# Login

curl -X POST http://localhost:8000/auth/login -d '{"email":"test@test.com","password":"123"}' -H "Content-Type: application/json"

### WebSocket Test (wscat)

- wscat -c "ws://localhost:8000/ws/ride?token=YOUR_JWT_TOKEN"
  > {"event_type": "join_ride", "ride_id": "ride_id_here"}
  > {"event_type": "location_update", "ride_id": "ride_id_here", "latitude": 0.3476, "longitude": 32.5825}

### Deployment (Render / Railway)

- Start Command:
  . uvicorn main:app --host 0.0.0.0 --port $PORT

- Environment Variables:
  . MONGO_URI
  . JWT_SECRET_KEY
  . GOOGLE_MAPS_API_KEY
  . FRONTEND_URL

### License

MIT License

Built with ❤️ by Yofti for E-Boda — empowering clean mobility in Africa 🌍
