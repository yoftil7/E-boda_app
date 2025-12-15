# E-Boda Backend API

**E-Boda** is a ride-hailing backend platform built with **FastAPI**, designed to support real-time motorcycle taxi services using REST APIs and WebSockets.

This backend handles authentication, ride lifecycle management, real-time driver/rider communication, admin controls, and scalable infrastructure for future growth.

---

## Tech Stack

- **Framework:** FastAPI (Python)
- **Database:** MongoDB
- **ORM / ODM:** Motor / PyMongo
- **Real-time Communication:** WebSockets
- **Authentication:** JWT (Access & Refresh Tokens)
- **Server:** Uvicorn
- **Docs:** OpenAPI (Swagger & ReDoc)
- **Architecture:** Modular, scalable, production-ready

---

## 📁 Project Structure

```
e-boda-backend/
│
├── main.py                # Application entry point
├── database.py            # MongoDB connection logic
│
├── routes/
│   ├── auth_routes.py     # Authentication endpoints
│   ├── ride_routes.py     # Ride lifecycle endpoints
│   └── admin_routes.py    # Admin management endpoints
│
├── sockets/
│   ├── ride_socket.py     # WebSocket ride events
│   └── manager.py         # WebSocket connection manager
│
├── models/                # Database models
├── schemas/               # Pydantic schemas
├── services/              # Business logic
├── utils/                 # Helpers & utilities
│
├── requirements.txt
└── README.md
```

---

## Features

### Authentication

- User & driver registration
- Login with JWT tokens
- Role-based access control (Rider, Driver, Admin)
- Secure token validation

### Ride Management

- Create ride requests
- Assign drivers
- Accept / reject rides
- Start & complete rides
- Cancel rides
- Track ride status changes

### Real-Time Communication (WebSockets)

- Live ride status updates
- Driver ↔ Rider real-time events
- WebSocket connection manager
- Scalable event broadcasting

### Admin Capabilities

- View platform statistics
- Manage users & drivers
- Monitor active rides
- System-level controls

### Maps & Directions

- Architecture prepared for **Google Maps Directions API**
- Distance & route calculation support
- Location-based ride logic ready for integration

_(Note: Maps APIs are structured but usage depends on frontend integration and billing configuration.)_

---

## Application Lifecycle

### Startup

- MongoDB connection initialized
- WebSocket manager started
- Middleware and routes registered

### Shutdown

- WebSocket connections gracefully closed
- Database disconnected safely

---

## API Documentation

Once running, access:

- **Swagger UI:**
  `http://localhost:8000/docs`

- **ReDoc:**
  `http://localhost:8000/redoc`

---

## Health Checks

- **Root:** `/`
- **Health:** `/health`

Example response:

```json
{
  "success": true,
  "status": "healthy",
  "database": "connected"
}
```

---

## ▶️ Running the Project

### Install Dependencies

```bash
pip install -r requirements.txt
```

### Run the Server

```bash
uvicorn main:app --reload
```

Server runs at:

```
http://localhost:8000
```

---

## Environment Variables (Example)

```
MONGO_URI=mongodb://localhost:27017/e_boda
JWT_SECRET=your_secret_key
JWT_ALGORITHM=HS256
TOKEN_EXPIRE_MINUTES=60
```

---

## Scalability & Future Enhancements

- Payment gateway integration
- Push notifications
- Ride history & analytics
- Driver earnings system
- Multi-city support
- Rate limiting & monitoring
- Docker & CI/CD pipelines

---

## Design Philosophy

- Clean separation of concerns
- Real-time first architecture
- Production-minded logging & error handling
- Easily extensible modules
- Mobile-first backend design

---

## Author

**Yoftahie Alem**
Backend Engineer | FastAPI | Real-time Systems
Built with precision, patience, and caffeine ☕

---

## 🏁 Status

🚧 **Active Development**
Core backend architecture is stable and ready for frontend/mobile integration.

---
