# E-Boda Backend API

Complete FastAPI backend for E-Boda ride-hailing platform connecting passengers with electric motorcycle (boda) drivers in Kampala, Uganda.

## 🚀 Features

- **User Authentication**: JWT-based authentication with role-based access (rider, driver, admin)
- **Ride Management**: Complete ride lifecycle from request to completion
- **Real-time Updates**: WebSocket support for live driver location and ride status
- **Admin Dashboard**: Comprehensive admin endpoints for platform management
- **Scalable Architecture**: Modular design ready for production deployment

## 🛠️ Tech Stack

- **Framework**: FastAPI (Python 3.9+)
- **Database**: MongoDB with MongoEngine ODM
- **Authentication**: JWT (JSON Web Tokens)
- **Real-time**: WebSockets
- **Documentation**: Auto-generated Swagger/ReDoc

## 📁 Project Structure

\`\`\`
backend/
├── main.py                 # FastAPI entry point
├── database.py            # MongoDB connection
├── models/
│   ├── user_model.py      # User/Driver model
│   └── ride_model.py      # Ride model
├── routes/
│   ├── auth_routes.py     # Authentication endpoints
│   ├── ride_routes.py     # Ride management endpoints
│   └── admin_routes.py    # Admin endpoints
├── sockets/
│   └── ride_socket.py     # WebSocket handlers
├── utils/
│   ├── jwt_utils.py       # JWT utilities
│   └── helpers.py         # Helper functions
├── requirements.txt       # Python dependencies
├── .env.example          # Environment variables template
└── README.md             # This file
\`\`\`

## 🔧 Installation

### Prerequisites

- Python 3.9 or higher
- MongoDB (local or Atlas)
- pip (Python package manager)

### Setup Steps

1. **Clone the repository**
   \`\`\`bash
   cd backend
   \`\`\`

2. **Create virtual environment**
   \`\`\`bash
   python -m venv venv
   
   # Activate virtual environment
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   \`\`\`

3. **Install dependencies**
   \`\`\`bash
   pip install -r requirements.txt
   \`\`\`

4. **Configure environment variables**
   \`\`\`bash
   cp .env.example .env
   # Edit .env with your configuration
   \`\`\`

5. **Start MongoDB**
   \`\`\`bash
   # If using local MongoDB:
   mongod
   
   # If using MongoDB Atlas, update MONGO_URI in .env
   \`\`\`

6. **Run the application**
   \`\`\`bash
   # Development mode with auto-reload
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   
   # Or use the main.py directly
   python main.py
   \`\`\`

7. **Access the API**
   - API: http://localhost:8000
   - Swagger Docs: http://localhost:8000/docs
   - ReDoc: http://localhost:8000/redoc

## 📚 API Endpoints

### Authentication (`/auth`)

- `POST /auth/register` - Register new user (rider/driver)
- `POST /auth/login` - Login user
- `GET /auth/me` - Get current user profile
- `PUT /auth/me/location` - Update driver location
- `PUT /auth/me/availability` - Toggle driver availability

### Rides (`/rides`)

- `POST /rides/request` - Create ride request (rider)
- `GET /rides/available` - Get available rides (driver)
- `POST /rides/{ride_id}/accept` - Accept ride (driver)
- `POST /rides/{ride_id}/status` - Update ride status
- `GET /rides/user/{user_id}` - Get user ride history
- `GET /rides/{ride_id}` - Get ride details

### Admin (`/admin`)

- `GET /admin/users` - Get all users
- `GET /admin/drivers` - Get all drivers
- `GET /admin/rides` - Get all rides
- `GET /admin/stats` - Get platform statistics
- `PUT /admin/users/{user_id}/status` - Activate/deactivate user
- `DELETE /admin/rides/{ride_id}` - Delete ride

### WebSocket (`/ws`)

- `WS /ws/ride/{user_id}?token={jwt_token}` - Real-time ride updates

## 🔐 Authentication

All protected endpoints require JWT token in Authorization header:

\`\`\`
Authorization: Bearer <your_jwt_token>
\`\`\`

### User Roles

- **Rider**: Can request rides, view ride history
- **Driver**: Can view available rides, accept rides, update location
- **Admin**: Full access to all endpoints and platform management

## 🌐 WebSocket Usage

Connect to WebSocket for real-time updates:

\`\`\`javascript
const ws = new WebSocket('ws://localhost:8000/ws/ride/{user_id}?token={jwt_token}');

// Send location update (driver)
ws.send(JSON.stringify({
  type: 'location_update',
  latitude: '0.3476',
  longitude: '32.5825',
  ride_id: 'ride_id_here'
}));

// Join ride room
ws.send(JSON.stringify({
  type: 'join_ride',
  ride_id: 'ride_id_here'
}));
\`\`\`

## 🧪 Testing

### Create Admin User

\`\`\`python
# Run Python shell
python

# Create admin
from models.user_model import User
from database import connect_db

connect_db()

admin = User(
    full_name="Admin User",
    email="admin@eboda.com",
    phone="256700000000",
    role="admin",
    is_verified=True
)
admin.set_password("admin123")
admin.save()
\`\`\`

### Test Endpoints

Use the Swagger UI at http://localhost:8000/docs to test all endpoints interactively.

## 🚀 Deployment

### Render.com

1. Create new Web Service
2. Connect your repository
3. Set build command: `pip install -r requirements.txt`
4. Set start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add environment variables from `.env.example`

### Railway.app

1. Create new project
2. Connect your repository
3. Add MongoDB plugin
4. Set environment variables
5. Deploy automatically

## 🔮 Future Enhancements

- [ ] Google Maps API integration for accurate distance/fare
- [ ] Payment gateway integration (Mobile Money)
- [ ] Push notifications
- [ ] Ride rating system
- [ ] Driver earnings dashboard
- [ ] Ride scheduling
- [ ] Promo codes and discounts
- [ ] Multi-language support

## 📝 Environment Variables

Required environment variables (see `.env.example`):

- `MONGO_URI` - MongoDB connection string
- `JWT_SECRET_KEY` - Secret key for JWT tokens
- `FRONTEND_URL` - Frontend application URL (for CORS)

## 🤝 Contributing

This is a Phase 1 MVP backend. Future phases will include:
- Rider mobile app (React Native/Expo)
- Driver mobile app (React Native/Expo)
- Admin dashboard (React + Tailwind)

## 📄 License

MIT License - feel free to use this for your projects!

## 🆘 Support

For issues or questions:
1. Check the Swagger documentation at `/docs`
2. Review the code comments
3. Check MongoDB connection and environment variables

---

**Built with ❤️ for E-Boda - Connecting Kampala with Electric Mobility**
