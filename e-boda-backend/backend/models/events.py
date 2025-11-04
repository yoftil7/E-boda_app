"""
WebSocket Event Models
Defines structured event types for real-time communication
"""

from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime


class RideRequestEvent(BaseModel):
    """Event emitted when a ride is requested"""

    event_type: str = "ride_request"
    ride_id: str
    rider_id: str
    pickup_location: Dict[str, Any]
    dropoff_location: Dict[str, Any]
    estimated_fare: float
    timestamp: datetime


class RideAcceptEvent(BaseModel):
    """Event emitted when a driver accepts a ride"""

    event_type: str = "ride_accepted"
    ride_id: str
    driver_id: str
    rider_id: str
    driver_name: str
    driver_phone: str
    driver_location: Dict[str, Any]
    estimated_arrival_time: Optional[int] = None  # in minutes
    timestamp: datetime


class LocationUpdateEvent(BaseModel):
    """Event emitted when driver location is updated"""

    event_type: str = "driver_location_update"
    ride_id: str
    driver_id: str
    location: Dict[str, Any]  # GeoJSON Point
    timestamp: datetime


class RideStatusEvent(BaseModel):
    """Event emitted when ride status changes"""

    event_type: str = "ride_status_update"
    ride_id: str
    status: str  # started, in_progress, completed, cancelled
    timestamp: datetime
    message: Optional[str] = None


class RideCompleteEvent(BaseModel):
    """Event emitted when a ride is completed"""

    event_type: str = "ride_completed"
    ride_id: str
    driver_id: str
    rider_id: str
    final_fare: float
    distance_km: float
    duration_minutes: int
    timestamp: datetime
