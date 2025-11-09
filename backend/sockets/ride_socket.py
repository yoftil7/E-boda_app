"""
WebSocket Routes for Real-time Communication - Phase 2
Handles driver location updates, ride status notifications with JWT authentication
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from typing import Dict, Set
import json
import logging
from datetime import datetime
from sockets.ws_auth import authenticate_websocket
from models.user_model import User
from models.ride_model import Ride

router = APIRouter()
logger = logging.getLogger(__name__)

# Store active WebSocket connections
# Format: {user_id: websocket}
active_connections: Dict[str, WebSocket] = {}

# Store ride rooms
# Format: {ride_id: {rider_id, driver_id}}
ride_rooms: Dict[str, Set[str]] = {}


class ConnectionManager:
    """Manages WebSocket connections with authentication"""

    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        """Accept and store WebSocket connection"""
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info(f"WebSocket connected: {user_id}")

    def disconnect(self, user_id: str):
        """Remove WebSocket connection"""
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            logger.info(f"WebSocket disconnected: {user_id}")

    async def send_personal_message(self, message: dict, user_id: str):
        """Send message to specific user"""
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
                logger.debug(
                    f"Message sent to {user_id}: {message.get('event_type', 'unknown')}"
                )
            except Exception as e:
                logger.error(f"Error sending message to {user_id}: {str(e)}")
                self.disconnect(user_id)

    async def broadcast_to_ride(self, message: dict, ride_id: str):
        """Broadcast message to all participants in a ride"""
        if ride_id in ride_rooms:
            for user_id in ride_rooms[ride_id]:
                await self.send_personal_message(message, user_id)
            logger.debug(
                f"Broadcast to ride {ride_id}: {message.get('event_type', 'unknown')}"
            )


manager = ConnectionManager()


@router.websocket("/ride")
async def websocket_ride_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time ride updates
    Requires JWT token for authentication (via query param or header)
    """
    user_info = None
    user_id = None

    try:
        user_info = await authenticate_websocket(websocket)
        user_id = user_info["user_id"]
        role = user_info["role"]

        # Connect user
        await manager.connect(user_id, websocket)

        # Send connection confirmation
        await websocket.send_json(
            {
                "event_type": "connected",
                "message": "Connected to E-Boda real-time service",
                "user_id": user_id,
                "role": role,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

        # Listen for messages
        while True:
            try:
                data = await websocket.receive_json()
                event_type = data.get("event_type") or data.get("type")

                if event_type == "location_update":
                    await handle_location_update(user_id, role, data)

                elif event_type == "join_ride":
                    # Join ride room for real-time updates
                    ride_id = data.get("ride_id")
                    if ride_id:
                        # Verify user is part of this ride
                        ride = Ride.objects(id=ride_id).first()
                        if ride:
                            is_participant = str(ride.rider.id) == user_id or (
                                ride.driver and str(ride.driver.id) == user_id
                            )
                            if is_participant:
                                if ride_id not in ride_rooms:
                                    ride_rooms[ride_id] = set()
                                ride_rooms[ride_id].add(user_id)
                                logger.info(f"User {user_id} joined ride {ride_id}")

                                await websocket.send_json(
                                    {
                                        "event_type": "joined_ride",
                                        "ride_id": ride_id,
                                        "message": "Successfully joined ride room",
                                    }
                                )
                            else:
                                await websocket.send_json(
                                    {
                                        "event_type": "error",
                                        "message": "You are not a participant in this ride",
                                    }
                                )

                elif event_type == "leave_ride":
                    # Leave ride room
                    ride_id = data.get("ride_id")
                    if ride_id and ride_id in ride_rooms:
                        ride_rooms[ride_id].discard(user_id)
                        if not ride_rooms[ride_id]:
                            del ride_rooms[ride_id]
                        logger.info(f"User {user_id} left ride {ride_id}")

                        await websocket.send_json(
                            {
                                "event_type": "left_ride",
                                "ride_id": ride_id,
                                "message": "Successfully left ride room",
                            }
                        )

                elif event_type == "ping":
                    # Heartbeat/keepalive
                    await websocket.send_json(
                        {
                            "event_type": "pong",
                            "timestamp": datetime.utcnow().isoformat(),
                        }
                    )

                else:
                    # Unknown event type
                    await websocket.send_json(
                        {
                            "event_type": "error",
                            "message": f"Unknown event type: {event_type}",
                        }
                    )

            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected normally: {user_id}")
                break
            except json.JSONDecodeError:
                await websocket.send_json(
                    {"event_type": "error", "message": "Invalid JSON format"}
                )
            except Exception as e:
                logger.error(f"WebSocket message error for {user_id}: {str(e)}")
                await websocket.send_json(
                    {
                        "event_type": "error",
                        "message": f"Error processing message: {str(e)}",
                    }
                )

    except Exception as e:
        logger.error(f"WebSocket connection error: {str(e)}")
    finally:
        if user_id:
            manager.disconnect(user_id)
            # Clean up ride rooms
            for ride_id in list(ride_rooms.keys()):
                if user_id in ride_rooms[ride_id]:
                    ride_rooms[ride_id].discard(user_id)
                    if not ride_rooms[ride_id]:
                        del ride_rooms[ride_id]


async def handle_location_update(user_id: str, role: str, data: dict):
    """
    Handle driver location updates
    Updates database and broadcasts to riders in active rides
    """
    if role != "driver":
        logger.warning(f"Non-driver {user_id} attempted to send location update")
        return

    latitude = data.get("latitude")
    longitude = data.get("longitude")
    ride_id = data.get("ride_id")

    if not all([latitude, longitude]):
        logger.warning(f"Invalid location data from {user_id}")
        return

    try:
        # Update driver's location in database
        driver = User.objects(id=user_id).first()
        if driver:
            driver.location = {
                "type": "Point",
                "coordinates": [float(longitude), float(latitude)],
            }
            driver.updated_at = datetime.utcnow()
            driver.save()
            logger.debug(f"Updated location for driver {user_id}")

        # Broadcast location to ride participants
        if ride_id and ride_id in ride_rooms:
            await manager.broadcast_to_ride(
                {
                    "event_type": "driver_location_update",
                    "ride_id": ride_id,
                    "driver_id": user_id,
                    "location": {
                        "type": "Point",
                        "coordinates": [float(longitude), float(latitude)],
                    },
                    "latitude": latitude,
                    "longitude": longitude,
                    "timestamp": datetime.utcnow().isoformat(),
                },
                ride_id,
            )

    except Exception as e:
        logger.error(f"Error handling location update: {str(e)}")


@router.get("/connections")
async def get_active_connections():
    """
    Get count of active WebSocket connections
    For monitoring purposes
    """
    return {
        "success": True,
        "active_connections": len(manager.active_connections),
        "active_rides": len(ride_rooms),
        "ride_rooms": {ride_id: len(users) for ride_id, users in ride_rooms.items()},
    }
