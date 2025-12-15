"""
Ride Management Routes
Handles ride requests, acceptance, status updates, and history
"""

from fastapi import APIRouter, HTTPException, Depends, status, Query, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timedelta
from models.user_model import User
from models.ride_model import Ride
from models.location_model import LocationUpdate, NearbyDriversRequest
from models.events import (
    RideRequestEvent,
    RideAcceptEvent,
    LocationUpdateEvent,
    RideCompleteEvent,
    RideStatusEvent,
)
from utils.jwt_utils import get_current_user
from utils.maps_utils import get_distance_and_eta, calculate_fare, get_route_polyline
import os

from sockets.ride_socket import manager, ride_rooms

import logging

router = APIRouter()
logger = logging.getLogger(__name__)


# Pydantic models for request validation
class RideRequest(BaseModel):
    pickup_address: str = Field(..., min_length=5, max_length=200)
    pickup_latitude: float = Field(..., ge=-90, le=90)
    pickup_longitude: float = Field(..., ge=-180, le=180)
    pickup_place_name: Optional[str] = None
    dropoff_address: str = Field(..., min_length=5, max_length=200)
    dropoff_latitude: float = Field(..., ge=-90, le=90)
    dropoff_longitude: float = Field(..., ge=-180, le=180)
    dropoff_place_name: Optional[str] = None
    rider_notes: Optional[str] = None
    auto_assign: bool = Field(
        default=True, description="Auto-assign nearest available driver"
    )


class StatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(accepted|in_progress|completed|cancelled)$")
    cancellation_reason: Optional[str] = None
    final_fare: Optional[float] = None


VALID_STATE_TRANSITIONS = {
    "pending": ["accepted", "cancelled"],
    "accepted": ["in_progress", "cancelled"],
    "in_progress": ["completed", "cancelled"],
    "completed": [],
    "cancelled": [],
}

PENDING_RIDES_QUEUE = (
    {}
)  # ride_id -> {"created_at": datetime, "attempts": int, "rider_id": str}
PENDING_RIDE_TTL_MINUTES = 10
MAX_ASSIGNMENT_ATTEMPTS = 5


def validate_ride_transition(current_status: str, new_status: str) -> bool:
    """Validate if a ride state transition is allowed."""
    valid_next = VALID_STATE_TRANSITIONS.get(current_status, [])
    return new_status in valid_next


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_ride_request(
    data: RideRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """
    Create a new ride request with Google Maps integration
    Optionally auto-assigns nearest available driver
    """
    try:
        if current_user.role != "rider":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only riders can request rides",
            )

        origin = (data.pickup_latitude, data.pickup_longitude)
        destination = (data.dropoff_latitude, data.dropoff_longitude)

        route_info = await get_distance_and_eta(origin, destination)
        distance_km = route_info["distance_km"]
        duration_minutes = route_info["duration_minutes"]

        estimated_fare = calculate_fare(distance_km, duration_minutes)

        # Get route polyline for map display
        polyline = await get_route_polyline(origin, destination)

        # Create ride
        ride = Ride(
            rider=current_user,
            pickup_address=data.pickup_address,
            pickup_latitude=data.pickup_latitude,
            pickup_longitude=data.pickup_longitude,
            pickup_place_name=data.pickup_place_name or data.pickup_address,
            dropoff_address=data.dropoff_address,
            dropoff_latitude=data.dropoff_latitude,
            dropoff_longitude=data.dropoff_longitude,
            dropoff_place_name=data.dropoff_place_name or data.dropoff_address,
            distance_km=distance_km,
            estimated_fare=estimated_fare,
            rider_notes=data.rider_notes,
            status="pending",
        )

        ride.save()

        logger.info(
            f"New ride request created: {ride.id} by {current_user.email}, distance: {distance_km}km, fare: {estimated_fare} UGX"
        )

        assigned_driver = None
        if data.auto_assign:
            try:
                logger.info(
                    f"Searching for available drivers near [{data.pickup_latitude}, {data.pickup_longitude}]"
                )

                # Check if any drivers exist
                all_drivers = User.objects(role="driver", is_active=True).count()
                available_drivers = User.objects(
                    role="driver", is_available=True, is_active=True
                ).count()
                logger.info(
                    f"Total active drivers: {all_drivers}, Available: {available_drivers}"
                )

                nearest_driver = User.objects(
                    role="driver",
                    is_available=True,
                    is_active=True,
                    location__near=[
                        data.pickup_longitude,
                        data.pickup_latitude,
                    ],  # MongoDB uses [longitude, latitude]
                    location__max_distance=5000,  # 5km radius in meters
                ).first()

                if nearest_driver:
                    logger.info(
                        f"Found nearest driver: {nearest_driver.email} at {nearest_driver.location}"
                    )

                    ride.driver = nearest_driver
                    ride.status = "accepted"
                    ride.accepted_at = datetime.utcnow()
                    ride.save()

                    nearest_driver.is_available = False
                    nearest_driver.save()

                    assigned_driver = nearest_driver.to_dict()

                    ride_id_str = str(ride.id)
                    if ride_id_str not in ride_rooms:
                        ride_rooms[ride_id_str] = set()
                    ride_rooms[ride_id_str].add(str(nearest_driver.id))
                    ride_rooms[ride_id_str].add(str(current_user.id))
                    logger.info(
                        f"Created ride room for auto-assigned ride {ride_id_str}"
                    )

                    # Notify driver
                    await manager.send_personal_message(
                        {
                            "event_type": "ride_assigned",
                            "ride_id": ride_id_str,
                            "pickup": {
                                "address": data.pickup_address,
                                "latitude": data.pickup_latitude,
                                "longitude": data.pickup_longitude,
                                "place_name": data.pickup_place_name,
                            },
                            "dropoff": {
                                "address": data.dropoff_address,
                                "latitude": data.dropoff_latitude,
                                "longitude": data.dropoff_longitude,
                                "place_name": data.dropoff_place_name,
                            },
                            "estimated_fare": estimated_fare,
                            "distance_km": distance_km,
                            "rider": {
                                "name": current_user.full_name,
                                "phone": current_user.phone,
                            },
                        },
                        str(nearest_driver.id),
                    )

                    driver_location = None
                    if nearest_driver.location and nearest_driver.location.get(
                        "coordinates"
                    ):
                        coords = nearest_driver.location["coordinates"]
                        # MongoDB GeoJSON format is [longitude, latitude]
                        driver_location = {
                            "latitude": coords[1],
                            "longitude": coords[0],
                        }

                    await manager.send_personal_message(
                        {
                            "event_type": "ride_accepted",
                            "ride_id": ride_id_str,
                            "driver": {
                                "id": str(nearest_driver.id),
                                "name": nearest_driver.full_name,
                                "full_name": nearest_driver.full_name,
                                "phone": nearest_driver.phone,
                                "vehicle_plate": nearest_driver.vehicle_plate,
                                "plate_number": nearest_driver.vehicle_plate,
                                "vehicle_model": nearest_driver.vehicle_model,
                                "rating": nearest_driver.rating,
                                "location": driver_location,
                            },
                            "message": "Driver assigned to your ride",
                            "timestamp": datetime.utcnow().isoformat(),
                        },
                        str(current_user.id),
                    )

                    logger.info(
                        f"Ride {ride.id} auto-assigned to driver {nearest_driver.email}"
                    )
                else:
                    logger.warning(
                        f"No available drivers found within 5km for ride {ride.id}. Available drivers: {available_drivers}"
                    )

                    # Add ride to pending queue
                    PENDING_RIDES_QUEUE[str(ride.id)] = {
                        "created_at": datetime.utcnow(),
                        "attempts": 0,
                        "rider_id": str(current_user.id),
                    }
            except Exception as e:
                logger.error(f"Auto-assignment error: {str(e)}", exc_info=True)

        response_data = {
            "success": True,
            "message": "Ride request created successfully",
            "ride": ride.to_dict(),
            "route_info": route_info,
            "polyline": polyline,
        }

        if assigned_driver:
            response_data["driver_assigned"] = True
            response_data["driver"] = assigned_driver

        return response_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Ride request error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create ride request: {str(e)}",
        )


@router.get("/available")
async def get_available_rides(current_user: User = Depends(get_current_user)):
    """
    Get all available (pending) rides for drivers
    Only drivers can access this endpoint
    """
    if current_user.role != "driver":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only drivers can view available rides",
        )

    if not current_user.is_available:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must be available to view ride requests",
        )

    # Get all pending rides
    rides = Ride.objects(status="pending").order_by("-created_at")

    return {
        "success": True,
        "count": len(rides),
        "rides": [ride.to_dict() for ride in rides],
    }


@router.get("/nearby-drivers")
async def get_nearby_drivers(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(default=5.0, ge=0.1, le=50),
    current_user: User = Depends(get_current_user),
):
    """
    Find nearby available drivers using MongoDB geospatial query
    Returns drivers within specified radius sorted by distance
    """
    try:
        from math import radians, sin, cos, sqrt, atan2

        logger.info(
            f"Searching for drivers near ({latitude}, {longitude}) within {radius_km}km"
        )

        # Calculate radius in radians for $centerSphere (radius_km / Earth radius in km)
        radius_radians = radius_km / 6371.0

        # MongoDB geospatial query using $geoWithin + $centerSphere
        available_drivers = User.objects(
            role="driver",
            is_available=True,
            is_active=True,
            location__geo_within_sphere=[[longitude, latitude], radius_radians],
        )

        logger.info(
            f"Found {available_drivers.count()} available drivers within {radius_km}km"
        )

        # Convert to list and manually calculate distances for sorting
        drivers_with_distance = []

        for driver in available_drivers:
            if driver.location and "coordinates" in driver.location:
                coords = driver.location["coordinates"]

                # Calculate exact distance using Haversine formula
                R = 6371  # Earth radius in km
                lat1, lon1 = radians(latitude), radians(longitude)
                lat2, lon2 = radians(coords[1]), radians(
                    coords[0]
                )  # GeoJSON is [lon, lat]
                dlat = lat2 - lat1
                dlon = lon2 - lon1
                a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
                c = 2 * atan2(sqrt(a), sqrt(1 - a))
                distance = R * c

                driver_dict = driver.to_dict()
                driver_dict["distance_km"] = round(distance, 2)
                drivers_with_distance.append(driver_dict)

        # Sort by distance (closest first)
        drivers_with_distance.sort(key=lambda x: x.get("distance_km", float("inf")))

        logger.info(
            f"Returning {len(drivers_with_distance)} drivers sorted by distance"
        )

        return {
            "success": True,
            "count": len(drivers_with_distance),
            "drivers": drivers_with_distance[:10],  # Limit to 10 closest drivers
            "search_radius_km": radius_km,
        }

    except Exception as e:
        logger.error(f"Nearby drivers search error: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to search for nearby drivers: {str(e)}"
        )


@router.post("/{ride_id}/accept")
async def accept_ride(ride_id: str, current_user: User = Depends(get_current_user)):
    """Driver accepts a ride request with strict state validation."""
    try:
        if current_user.role != "driver":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only drivers can accept rides",
            )

        if not current_user.is_available:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You must be available to accept rides",
            )

        ride = Ride.objects(id=ride_id).first()
        if not ride:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found"
            )

        if not validate_ride_transition(ride.status, "accepted"):
            logger.warning(
                f"Invalid transition attempt: {ride.status} -> accepted for ride {ride_id}"
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot accept ride with status: {ride.status}",
            )

        ride.driver = current_user
        ride.status = "accepted"
        ride.accepted_at = datetime.utcnow()
        ride.updated_at = datetime.utcnow()
        ride.save()

        current_user.is_available = False
        current_user.save()

        ride_id_str = str(ride.id)
        if ride_id_str not in ride_rooms:
            ride_rooms[ride_id_str] = set()
        ride_rooms[ride_id_str].add(str(current_user.id))
        ride_rooms[ride_id_str].add(str(ride.rider.id))
        logger.info(f"Created ride room for manually accepted ride {ride_id_str}")

        driver_location = current_user.location if current_user.location else None
        await manager.send_personal_message(
            {
                "event_type": "ride_accepted",
                "ride_id": ride_id_str,
                "driver": {
                    "id": str(current_user.id),
                    "name": current_user.full_name,
                    "full_name": current_user.full_name,
                    "phone": current_user.phone,
                    "vehicle_plate": current_user.vehicle_plate,
                    "plate_number": current_user.vehicle_plate,
                    "vehicle_model": current_user.vehicle_model,
                    "rating": current_user.rating,
                    "location": driver_location,
                },
                "message": "Your ride has been accepted!",
                "timestamp": datetime.utcnow().isoformat(),
            },
            str(ride.rider.id),
        )

        logger.info(f"Ride {ride_id} accepted by driver {current_user.email}")

        return {
            "success": True,
            "message": "Ride accepted successfully",
            "ride": ride.to_dict(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Accept ride error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to accept ride: {str(e)}",
        )


@router.post("/{ride_id}/start")
async def start_ride(ride_id: str, current_user: User = Depends(get_current_user)):
    """Driver starts the ride with strict state validation."""
    try:
        ride = Ride.objects(id=ride_id).first()
        if not ride:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found"
            )

        if not ride.driver or str(ride.driver.id) != str(current_user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the assigned driver can start this ride",
            )

        if not validate_ride_transition(ride.status, "in_progress"):
            logger.warning(
                f"Invalid transition attempt: {ride.status} -> in_progress for ride {ride_id}"
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot start ride with status: {ride.status}",
            )

        ride.status = "in_progress"
        ride.started_at = datetime.utcnow()
        ride.updated_at = datetime.utcnow()
        ride.save()

        await manager.send_personal_message(
            {
                "event_type": "ride_started",
                "ride_id": str(ride.id),
                "message": "Your ride has started!",
                "timestamp": datetime.utcnow().isoformat(),
            },
            str(ride.rider.id),
        )

        logger.info(f"Ride {ride_id} started by driver {current_user.email}")

        return {
            "success": True,
            "message": "Ride started successfully",
            "ride": ride.to_dict(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Start ride error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start ride: {str(e)}",
        )


@router.post("/{ride_id}/complete")
async def complete_ride(ride_id: str, current_user: User = Depends(get_current_user)):
    """Driver completes the ride with strict state validation."""
    try:
        ride = Ride.objects(id=ride_id).first()
        if not ride:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found"
            )

        if not ride.driver or str(ride.driver.id) != str(current_user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the assigned driver can complete this ride",
            )

        if not validate_ride_transition(ride.status, "completed"):
            logger.warning(
                f"Invalid transition attempt: {ride.status} -> completed for ride {ride_id}"
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot complete ride with status: {ride.status}",
            )

        ride.status = "completed"
        ride.completed_at = datetime.utcnow()
        ride.updated_at = datetime.utcnow()
        ride.final_fare = ride.estimated_fare
        ride.save()

        current_user.is_available = True
        current_user.total_rides = str(int(current_user.total_rides) + 1)
        current_user.save()

        ride.rider.total_rides = str(int(ride.rider.total_rides) + 1)
        ride.rider.save()

        duration_minutes = 0
        if ride.started_at and ride.completed_at:
            duration = ride.completed_at - ride.started_at
            duration_minutes = int(duration.total_seconds() / 60)

        await manager.send_personal_message(
            {
                "event_type": "ride_completed",
                "ride_id": str(ride.id),
                "final_fare": ride.final_fare,
                "distance_km": ride.distance_km,
                "duration_minutes": duration_minutes,
                "message": "Your ride has been completed!",
                "timestamp": datetime.utcnow().isoformat(),
            },
            str(ride.rider.id),
        )

        logger.info(f"Ride {ride_id} completed by driver {current_user.email}")

        return {
            "success": True,
            "message": "Ride completed successfully",
            "ride": ride.to_dict(),
            "duration_minutes": duration_minutes,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Complete ride error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to complete ride: {str(e)}",
        )


@router.post("/{ride_id}/status")
async def update_ride_status(
    ride_id: str, data: StatusUpdate, current_user: User = Depends(get_current_user)
):
    """
    Update ride status
    Drivers can update to in_progress, completed, or cancelled
    Riders can only cancel
    """
    try:
        # Find ride
        ride = Ride.objects(id=ride_id).first()
        if not ride:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found"
            )

        # Authorization check
        is_rider = str(ride.rider.id) == str(current_user.id)
        is_driver = ride.driver and str(ride.driver.id) == str(current_user.id)

        if not (is_rider or is_driver):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to update this ride",
            )

        # Riders can only cancel
        if is_rider and current_user.role == "rider" and data.status != "cancelled":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Riders can only cancel rides",
            )

        # Update status
        old_status = ride.status
        ride.status = data.status
        ride.updated_at = datetime.utcnow()

        # Update timestamps based on status
        if data.status == "in_progress":
            ride.started_at = datetime.utcnow()
        elif data.status == "completed":
            ride.completed_at = datetime.utcnow()
            if data.final_fare:
                ride.final_fare = data.final_fare
            else:
                ride.final_fare = ride.estimated_fare

            # Update driver stats
            if ride.driver:
                ride.driver.is_available = True
                ride.driver.total_rides = str(int(ride.driver.total_rides) + 1)
                ride.driver.save()

            # Update rider stats
            ride.rider.total_rides = str(int(ride.rider.total_rides) + 1)
            ride.rider.save()

        elif data.status == "cancelled":
            ride.cancelled_at = datetime.utcnow()
            ride.cancellation_reason = data.cancellation_reason

            # Make driver available again if they were assigned
            if ride.driver:
                ride.driver.is_available = True
                ride.driver.save()

        ride.save()

        logger.info(f"Ride {ride_id} status updated: {old_status} → {data.status}")

        return {
            "success": True,
            "message": f"Ride status updated to {data.status}",
            "ride": ride.to_dict(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update status error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update ride status: {str(e)}",
        )


@router.get("/user/{user_id}")
async def get_user_ride_history(
    user_id: str,
    current_user: User = Depends(get_current_user),
    status_filter: Optional[str] = Query(None, description="Filter by status"),
):
    """
    Get ride history for a specific user
    Users can only view their own history unless they're admin
    """
    # Authorization check
    if str(current_user.id) != user_id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own ride history",
        )

    # Find user
    user = User.objects(id=user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Build query based on user role
    query = {}
    if user.role == "rider":
        query["rider"] = user
    elif user.role == "driver":
        query["driver"] = user

    # Add status filter if provided
    if status_filter:
        query["status"] = status_filter

    # Get rides
    rides = Ride.objects(**query).order_by("-created_at")

    return {
        "success": True,
        "count": len(rides),
        "rides": [ride.to_dict() for ride in rides],
    }


@router.get("/{ride_id}")
async def get_ride_details(
    ride_id: str, current_user: User = Depends(get_current_user)
):
    """
    Get details of a specific ride
    Only accessible by rider, driver, or admin
    """
    ride = Ride.objects(id=ride_id).first()
    if not ride:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found"
        )

    # Authorization check
    is_rider = str(ride.rider.id) == str(current_user.id)
    is_driver = ride.driver and str(ride.driver.id) == str(current_user.id)
    is_admin = current_user.role == "admin"

    if not (is_rider or is_driver or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to view this ride",
        )

    return {"success": True, "ride": ride.to_dict()}


@router.post("/{ride_id}/cancel")
async def cancel_ride(
    ride_id: str, request: dict, current_user: User = Depends(get_current_user)
):
    """
    Cancel a ride - works for any non-terminal state.
    Riders can cancel their own rides.
    Drivers can cancel rides assigned to them.
    Supports cancellation during trip if ALLOW_CANCELLATION_DURING_TRIP=true.
    """
    try:
        allow_trip_cancellation = (
            os.getenv("ALLOW_CANCELLATION_DURING_TRIP", "false").lower() == "true"
        )
        cancellation_fee = float(os.getenv("CANCELLATION_FEE_AMOUNT", "50.0"))

        ride = Ride.objects(id=ride_id).first()
        if not ride:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found"
            )

        # Authorization check
        is_rider = str(ride.rider.id) == str(current_user.id)
        is_driver = ride.driver and str(ride.driver.id) == str(current_user.id)

        if not (is_rider or is_driver):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to cancel this ride",
            )

        if ride.status == "in_progress":
            if not allow_trip_cancellation:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot cancel ride while in progress. This feature is disabled.",
                )

            # Return charge information
            charge_applicable = True
            charge_amount = cancellation_fee
        else:
            charge_applicable = False
            charge_amount = 0

        # Check if already in terminal state
        if ride.status in ["completed", "cancelled"]:
            return {
                "success": True,
                "message": f"Ride already {ride.status}",
                "ride": ride.to_dict(),
            }

        old_status = ride.status
        was_unassigned = ride.driver is None

        reason = request.get("reason", "")
        reason_detail = request.get("reason_detail", "")

        # Update ride status
        ride.status = "cancelled"
        ride.cancelled_at = datetime.utcnow()
        ride.cancellation_reason = (
            f"{reason} - {reason_detail}" if reason_detail else reason
        )
        ride.cancelled_by = "rider" if is_rider else "driver"
        if charge_applicable:
            ride.cancellation_charge = charge_amount
        ride.updated_at = datetime.utcnow()
        ride.save()

        # Make driver available again if assigned
        if ride.driver:
            ride.driver.is_available = True
            ride.driver.save()

        # Remove from pending queue if present
        if ride_id in PENDING_RIDES_QUEUE:
            del PENDING_RIDES_QUEUE[ride_id]

        # Broadcast cancellation to room
        ride_id_str = str(ride.id)
        await manager.broadcast_to_room(
            ride_id_str,
            {
                "event_type": "ride_cancelled",
                "ride_id": ride_id_str,
                "cancelled_by": "rider" if is_rider else "driver",
                "reason": ride.cancellation_reason,
                "timestamp": datetime.utcnow().isoformat(),
            },
        )

        logger.info(
            f"Ride {ride_id} cancelled by {current_user.email} (was_unassigned={was_unassigned})"
        )

        return {
            "success": True,
            "reason": (
                "cancelled_unassigned" if was_unassigned else "cancelled_assigned"
            ),
            "message": "Ride cancelled successfully",
            "charge_applicable": charge_applicable,
            "charge_amount": charge_amount,
            "ride": ride.to_dict(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cancel ride error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cancel ride: {str(e)}",
        )


@router.post("/{ride_id}/rating")
async def rate_ride(
    ride_id: str, request: dict, current_user: User = Depends(get_current_user)
):
    """
    Submit a rating for a completed ride.
    Only the rider can rate the driver.
    """
    try:
        enable_aggregation = (
            os.getenv("ENABLE_RATING_AGGREGATION", "true").lower() == "true"
        )

        ride = Ride.objects(id=ride_id).first()
        if not ride:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found"
            )

        # Check authorization
        if str(ride.rider.id) != str(current_user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the rider can rate the ride",
            )

        # Check if ride is completed
        if ride.status != "completed":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Can only rate completed rides",
            )

        rating = request.get("rating")
        feedback = request.get("feedback", "")

        if not rating or rating < 1 or rating > 5:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Rating must be between 1 and 5",
            )

        # Store rating on ride
        ride.rider_rating = rating
        ride.rider_feedback = feedback
        ride.rated_at = datetime.utcnow()
        ride.save()

        # Update driver's aggregate rating if enabled
        if enable_aggregation and ride.driver:
            driver = ride.driver

            # Get all rated rides for this driver
            rated_rides = Ride.objects(driver=driver, rider_rating__exists=True)

            if rated_rides.count() > 0:
                total_rating = sum(r.rider_rating for r in rated_rides)
                avg_rating = total_rating / rated_rides.count()

                driver.rating = str(round(avg_rating, 2))
                driver.total_ratings = rated_rides.count()
                driver.save()

                logger.info(
                    f"Updated driver {driver.email} rating to {driver.rating} ({driver.total_ratings} ratings)"
                )

        logger.info(f"Ride {ride_id} rated {rating} stars by {current_user.email}")

        return {
            "success": True,
            "message": "Rating submitted successfully",
            "rating": rating,
            "ride": ride.to_dict(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Rate ride error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to submit rating: {str(e)}",
        )


@router.post("/{ride_id}/retry-assign")
async def retry_assign_driver(
    ride_id: str, current_user: User = Depends(get_current_user)
):
    """
    Retry driver assignment for a pending ride.
    Only the ride owner (rider) can trigger this.
    """
    try:
        ride = Ride.objects(id=ride_id).first()
        if not ride:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found"
            )

        if str(ride.rider.id) != str(current_user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the rider can retry assignment",
            )

        if ride.status != "pending":
            return {
                "success": False,
                "message": f"Cannot retry assignment for ride with status: {ride.status}",
                "ride": ride.to_dict(),
            }

        # Check if ride has been pending too long
        if ride.created_at:
            age_minutes = (datetime.utcnow() - ride.created_at).total_seconds() / 60
            if age_minutes > PENDING_RIDE_TTL_MINUTES:
                ride.status = "cancelled"
                ride.cancelled_at = datetime.utcnow()
                ride.cancellation_reason = "No driver found within time limit"
                ride.save()

                await manager.send_personal_message(
                    {
                        "event_type": "no_driver_found",
                        "ride_id": str(ride.id),
                        "reason": "timeout",
                        "message": "No driver available. Please try again.",
                        "timestamp": datetime.utcnow().isoformat(),
                    },
                    str(ride.rider.id),
                )

                return {
                    "success": False,
                    "reason": "timeout",
                    "message": "Ride expired - no driver found",
                    "ride": ride.to_dict(),
                }

        # Try to find a driver
        nearest_driver = User.objects(
            role="driver",
            is_available=True,
            is_active=True,
            location__near=[ride.pickup_longitude, ride.pickup_latitude],
            location__max_distance=5000,
        ).first()

        if nearest_driver:
            ride.driver = nearest_driver
            ride.status = "accepted"
            ride.accepted_at = datetime.utcnow()
            ride.save()

            nearest_driver.is_available = False
            nearest_driver.save()

            # Remove from pending queue
            if ride_id in PENDING_RIDES_QUEUE:
                del PENDING_RIDES_QUEUE[ride_id]

            driver_location = None
            if nearest_driver.location and nearest_driver.location.get("coordinates"):
                coords = nearest_driver.location["coordinates"]
                driver_location = {"latitude": coords[1], "longitude": coords[0]}

            # Notify rider
            await manager.send_personal_message(
                {
                    "event_type": "ride_accepted",
                    "ride_id": str(ride.id),
                    "driver": {
                        "id": str(nearest_driver.id),
                        "name": nearest_driver.full_name,
                        "full_name": nearest_driver.full_name,
                        "phone": nearest_driver.phone,
                        "vehicle_plate": nearest_driver.vehicle_plate,
                        "plate_number": nearest_driver.vehicle_plate,
                        "vehicle_model": nearest_driver.vehicle_model,
                        "rating": nearest_driver.rating,
                        "location": driver_location,
                    },
                    "message": "Driver assigned to your ride",
                    "timestamp": datetime.utcnow().isoformat(),
                },
                str(current_user.id),
            )

            logger.info(
                f"Ride {ride_id} assigned to driver {nearest_driver.email} via retry"
            )

            return {
                "success": True,
                "driver_assigned": True,
                "message": "Driver assigned successfully",
                "ride": ride.to_dict(),
                "driver": nearest_driver.to_dict(),
            }
        else:
            # Track retry attempts
            if ride_id not in PENDING_RIDES_QUEUE:
                PENDING_RIDES_QUEUE[ride_id] = {
                    "created_at": ride.created_at or datetime.utcnow(),
                    "attempts": 0,
                    "rider_id": str(ride.rider.id),
                }

            PENDING_RIDES_QUEUE[ride_id]["attempts"] += 1
            attempts = PENDING_RIDES_QUEUE[ride_id]["attempts"]

            if attempts >= MAX_ASSIGNMENT_ATTEMPTS:
                ride.status = "cancelled"
                ride.cancelled_at = datetime.utcnow()
                ride.cancellation_reason = "No driver found after multiple attempts"
                ride.save()

                del PENDING_RIDES_QUEUE[ride_id]

                await manager.send_personal_message(
                    {
                        "event_type": "no_driver_found",
                        "ride_id": str(ride.id),
                        "reason": "max_attempts",
                        "attempts": attempts,
                        "message": "No drivers available. Please try again later.",
                        "timestamp": datetime.utcnow().isoformat(),
                    },
                    str(ride.rider.id),
                )

                return {
                    "success": False,
                    "reason": "max_attempts",
                    "attempts": attempts,
                    "message": "No driver found after maximum attempts",
                    "ride": ride.to_dict(),
                }

            available_count = User.objects(
                role="driver", is_available=True, is_active=True
            ).count()

            return {
                "success": False,
                "driver_assigned": False,
                "attempts": attempts,
                "available_drivers": available_count,
                "message": "No driver available nearby. Will keep trying.",
                "ride": ride.to_dict(),
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Retry assign error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retry assignment: {str(e)}",
        )
