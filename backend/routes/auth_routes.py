"""
Authentication Routes
Handles user registration, login, and profile management
"""

from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from models.user_model import User
from models.ride_model import Ride
from utils.jwt_utils import create_access_token, get_current_user
from datetime import datetime
import logging

from sockets.ride_socket import manager, ride_rooms

router = APIRouter()
logger = logging.getLogger(__name__)


# Pydantic models for request validation
class RegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=100)
    email: EmailStr
    phone: str = Field(..., min_length=10, max_length=15)
    password: str = Field(..., min_length=6)
    role: str = Field(default="rider", pattern="^(rider|driver)$")

    # Driver-specific fields (optional)
    driver_license: Optional[str] = None
    vehicle_plate: Optional[str] = None
    vehicle_model: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    success: bool
    message: str
    token: str
    user: dict


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(data: RegisterRequest):
    """
    Register a new user (rider or driver)
    Validates input and creates user account
    """
    try:
        # Check if user already exists
        existing_user = User.objects(email=data.email).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )

        existing_phone = User.objects(phone=data.phone).first()
        if existing_phone:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Phone number already registered",
            )

        # Create new user
        user = User(
            full_name=data.full_name, email=data.email, phone=data.phone, role=data.role
        )

        # Set password (hashed)
        user.set_password(data.password)

        # Add driver-specific fields if role is driver
        if data.role == "driver":
            if not data.driver_license or not data.vehicle_plate:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Driver license and vehicle plate are required for drivers",
                )
            user.driver_license = data.driver_license
            user.vehicle_plate = data.vehicle_plate
            user.vehicle_model = data.vehicle_model

        user.save()

        logger.info(f"New user registered: {user.email} ({user.role})")

        # Generate JWT token
        token = create_access_token({"user_id": str(user.id), "role": user.role})

        return {
            "success": True,
            "message": "Registration successful",
            "token": token,
            "user": user.to_dict(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Registration failed: {str(e)}",
        )


@router.post("/login", response_model=LoginResponse)
async def login(data: LoginRequest):
    """
    Login user with email and password
    Returns JWT token on success
    """
    try:
        # Find user by email
        user = User.objects(email=data.email).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )

        # Verify password
        if not user.verify_password(data.password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )

        # Check if user is active
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated"
            )

        # Generate JWT token
        token = create_access_token({"user_id": str(user.id), "role": user.role})

        logger.info(f"User logged in: {user.email}")

        return {
            "success": True,
            "message": "Login successful",
            "token": token,
            "user": user.to_dict(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Login failed: {str(e)}",
        )


@router.get("/me")
async def get_current_user_profile(current_user: User = Depends(get_current_user)):
    """
    Get current authenticated user's profile
    Requires valid JWT token
    """
    return {"success": True, "user": current_user.to_dict()}


@router.put("/me/location")
async def update_location(
    latitude: float, longitude: float, current_user: User = Depends(get_current_user)
):
    """
    Update driver's current location
    Only available for drivers
    Broadcasts location update to all active ride WebSocket connections
    """
    if current_user.role != "driver":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only drivers can update location",
        )

    current_user.location = {"type": "Point", "coordinates": [longitude, latitude]}
    current_user.save()

    driver_id = str(current_user.id)
    location_data = {
        "event_type": "driver_location_update",
        "driver_id": driver_id,
        "latitude": latitude,
        "longitude": longitude,
        "location": {"type": "Point", "coordinates": [longitude, latitude]},
        "timestamp": datetime.utcnow().isoformat(),
    }

    # Broadcast to all ride rooms where this driver is active
    for ride_id in ride_rooms:
        ride = Ride.objects(id=ride_id).first()
        if ride and ride.driver and str(ride.driver.id) == driver_id:
            location_data["ride_id"] = ride_id
            await manager.broadcast_to_room(ride_id, location_data)

    return {
        "success": True,
        "message": "Location updated successfully",
        "data": {"latitude": latitude, "longitude": longitude},
    }


@router.put("/me/availability")
async def toggle_availability(
    is_available: bool,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    current_user: User = Depends(get_current_user),
):
    """
    Toggle driver availability status
    Only available for drivers
    Optionally set location when becoming available
    """
    if current_user.role != "driver":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only drivers can update availability",
        )

    if is_available and latitude is not None and longitude is not None:
        current_user.location = {"type": "Point", "coordinates": [longitude, latitude]}
        logger.info(
            f"Updated location for driver {current_user.id}: [{latitude}, {longitude}]"
        )
    elif is_available and not current_user.location:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Location is required when becoming available. Please provide latitude and longitude.",
        )

    current_user.is_available = is_available
    current_user.save()

    if is_available:
        available_count = User.objects(
            role="driver", is_available=True, is_active=True
        ).count()
        await manager.broadcast_to_all(
            {
                "event_type": "driver_availability_changed",
                "driver_id": str(current_user.id),
                "is_available": is_available,
                "available_drivers_count": available_count,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    response_data = {
        "success": True,
        "message": f"Availability set to {'available' if is_available else 'unavailable'}",
        "is_available": is_available,
    }

    if current_user.location:
        response_data["location"] = {
            "latitude": current_user.location["coordinates"][1],
            "longitude": current_user.location["coordinates"][0],
        }

    return response_data
