# pyright: reportAttributeAccessIssue=false

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
from sockets.ride_socket import manager, ride_rooms
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


# Pydantic models for request validation
class RideRequest(BaseModel):
    pickup_address: str = Field(..., min_length=5, max_length=200)
    pickup_latitude: float = Field(..., ge=-90, le=90)
    pickup_longitude: float = Field(..., ge=-180, le=180)
    dropoff_address: str = Field(..., min_length=5, max_length=200)
    dropoff_latitude: float = Field(..., ge=-90, le=90)
    dropoff_longitude: float = Field(..., ge=-180, le=180)
    rider_notes: Optional[str] = None
    auto_assign: bool = Field(
        default=True, description="Auto-assign nearest available driver"
    )


class StatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(accepted|in_progress|completed|cancelled)$")
    cancellation_reason: Optional[str] = None
    final_fare: Optional[float] = None


@router.post("/request", status_code=status.HTTP_201_CREATED)
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
            dropoff_address=data.dropoff_address,
            dropoff_latitude=data.dropoff_latitude,
            dropoff_longitude=data.dropoff_longitude,
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
                nearest_driver = User.objects(
                    role="driver",
                    is_available=True,
                    is_active=True,
                    location__near=[data.pickup_longitude, data.pickup_latitude],
                    location__max_distance=5000,  # 5km radius
                ).first()

                if nearest_driver:
                    ride.driver = nearest_driver
                    ride.status = "accepted"
                    ride.accepted_at = datetime.utcnow()
                    ride.save()

                    nearest_driver.is_available = False
                    nearest_driver.save()

                    assigned_driver = nearest_driver.to_dict()

                    await manager.send_personal_message(
                        {
                            "event_type": "ride_assigned",
                            "ride_id": str(ride.id),
                            "pickup": {
                                "address": data.pickup_address,
                                "latitude": data.pickup_latitude,
                                "longitude": data.pickup_longitude,
                            },
                            "dropoff": {
                                "address": data.dropoff_address,
                                "latitude": data.dropoff_latitude,
                                "longitude": data.dropoff_longitude,
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

                    # Notify rider
                    await manager.send_personal_message(
                        {
                            "event_type": "ride_accepted",
                            "ride_id": str(ride.id),
                            "driver": assigned_driver,
                            "message": "Driver assigned to your ride",
                        },
                        str(current_user.id),
                    )

                    logger.info(
                        f"Ride {ride.id} auto-assigned to driver {nearest_driver.email}"
                    )
                else:
                    logger.warning(
                        f"No available drivers found within 5km for ride {ride.id}"
                    )
            except Exception as e:
                logger.error(f"Auto-assignment error: {str(e)}")

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
        nearby_drivers = User.objects(
            role="driver",
            is_available=True,
            is_active=True,
            location__near=[longitude, latitude],
            location__max_distance=radius_km * 1000,  # Convert km to meters
        ).limit(10)

        if not nearby_drivers:
            return {
                "success": True,
                "message": f"No available drivers found within {radius_km} km",
                "count": 0,
                "drivers": [],
            }

        drivers_list = []
        for driver in nearby_drivers:
            driver_dict = driver.to_dict()
            # Calculate approximate distance if location exists
            if driver.location and driver.location.get("coordinates"):
                driver_coords = driver.location["coordinates"]
                # Simple distance calculation (will be more accurate with actual route)
                from math import radians, sin, cos, sqrt, atan2

                R = 6371  # Earth radius in km
                lat1, lon1 = radians(latitude), radians(longitude)
                lat2, lon2 = radians(driver_coords[1]), radians(driver_coords[0])
                dlat = lat2 - lat1
                dlon = lon2 - lon1
                a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
                c = 2 * atan2(sqrt(a), sqrt(1 - a))
                distance = R * c
                driver_dict["distance_km"] = round(distance, 2)

            drivers_list.append(driver_dict)

        # Sort by distance
        drivers_list.sort(key=lambda x: x.get("distance_km", float("inf")))

        logger.info(
            f"Found {len(drivers_list)} drivers within {radius_km} km of ({latitude}, {longitude})"
        )

        return {
            "success": True,
            "count": len(drivers_list),
            "drivers": drivers_list,
            "search_radius_km": radius_km,
        }

    except Exception as e:
        logger.error(f"Nearby drivers search error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to search for nearby drivers: {str(e)}",
        )


@router.post("/{ride_id}/accept")
async def accept_ride(ride_id: str, current_user: User = Depends(get_current_user)):
    """
    Driver accepts a ride request
    Notifies rider via WebSocket
    """
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

        if ride.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ride is already {ride.status}",
            )

        ride.driver = current_user
        ride.status = "accepted"
        ride.accepted_at = datetime.utcnow()
        ride.updated_at = datetime.utcnow()
        ride.save()

        current_user.is_available = False
        current_user.save()

        driver_location = current_user.location if current_user.location else None
        await manager.send_personal_message(
            {
                "event_type": "ride_accepted",
                "ride_id": str(ride.id),
                "driver": {
                    "id": str(current_user.id),
                    "name": current_user.full_name,
                    "phone": current_user.phone,
                    "vehicle_plate": current_user.vehicle_plate,
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
    """
    Driver starts the ride (picked up rider)
    Updates status to in_progress
    """
    try:
        ride = Ride.objects(id=ride_id).first()
        if not ride:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found"
            )

        # Only assigned driver can start the ride
        if not ride.driver or str(ride.driver.id) != str(current_user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the assigned driver can start this ride",
            )

        if ride.status != "accepted":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot start ride with status: {ride.status}",
            )

        ride.status = "in_progress"
        ride.started_at = datetime.utcnow()
        ride.updated_at = datetime.utcnow()
        ride.save()

        # Notify rider
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
    """
    Driver completes the ride
    Updates statistics and makes driver available again
    """
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

        if ride.status != "in_progress":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot complete ride with status: {ride.status}",
            )

        ride.status = "completed"
        ride.completed_at = datetime.utcnow()
        ride.updated_at = datetime.utcnow()
        ride.final_fare = ride.estimated_fare  # Use estimated fare as final
        ride.save()

        # Update driver stats and availability
        current_user.is_available = True
        try:
            current_total = (
                int(str(current_user.total_rides))
                if current_user.total_rides is not None
                else 0
            )
        except Exception:
            current_total = 0
        current_user.total_rides = str(current_total + 1)
        current_user.save()

        # Update rider stats
        try:
            rider_total = (
                int(str(ride.rider.total_rides))
                if ride.rider.total_rides is not None
                else 0
            )
        except Exception:
            rider_total = 0
        ride.rider.total_rides = str(rider_total + 1)
        ride.rider.save()

        # Calculate ride duration
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
            # Update driver stats
            if ride.driver:
                ride.driver.is_available = True
                try:
                    driver_total = (
                        int(str(ride.driver.total_rides))
                        if ride.driver.total_rides is not None
                        else 0
                    )
                except Exception:
                    driver_total = 0
                ride.driver.total_rides = str(driver_total + 1)
                ride.driver.save()

            # Update rider stats
            try:
                rider_total = (
                    int(str(ride.rider.total_rides))
                    if ride.rider.total_rides is not None
                    else 0
                )
            except Exception:
                rider_total = 0
            ride.rider.total_rides = str(rider_total + 1)
            ride.rider.save()
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
