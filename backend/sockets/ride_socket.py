"""
Production-grade WebSocket connection manager for E-Boda ride-sharing.

This module provides:
- Thread-safe connection management with per-connection write locks
- Room-based messaging for ride participants
- Automatic stale connection cleanup
- Non-blocking broadcast operations
- Server-initiated keepalive pings
- Backward compatibility with legacy API
- Driver location throttling
- Strict ride state validation
- Reconnect and state resume support
"""

import asyncio
import json
import time
import logging
from datetime import datetime
from typing import Dict, Set, Optional, Any
from dataclasses import dataclass, field

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from .ws_auth import authenticate_websocket
from models.ride_model import Ride
from models.user_model import User

logger = logging.getLogger(__name__)

router = APIRouter()


# =============================================================================
# CONFIGURATION
# =============================================================================

HEARTBEAT_INTERVAL_SECONDS = 15
HEARTBEAT_TIMEOUT_SECONDS = 45
SEND_TIMEOUT_SECONDS = 5
MAX_MESSAGE_SIZE_BYTES = 65536
CLEANUP_INTERVAL_SECONDS = 30
PING_INTERVAL_SECONDS = 10

LOCATION_THROTTLE_MS = 400  # Minimum 400ms between location broadcasts
LOCATION_MIN_DISTANCE_METERS = 1  # Minimum distance change to broadcast

VALID_STATE_TRANSITIONS = {
    "pending": ["accepted", "cancelled"],
    "accepted": ["in_progress", "cancelled"],
    "in_progress": ["completed", "cancelled"],
    "completed": [],  # Terminal state
    "cancelled": [],  # Terminal state
}


# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class ClientConnection:
    """Represents a single WebSocket client connection with metadata."""

    websocket: WebSocket
    user_id: str
    role: str
    connected_at: float = field(default_factory=time.time)
    last_heartbeat: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    write_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    is_alive: bool = True
    joined_rooms: Set[str] = field(default_factory=set)
    last_location_broadcast: float = 0.0
    last_location_coords: Optional[tuple] = None
    last_pong: float = 0.0  # Added for pong handling

    def update_heartbeat(self) -> None:
        self.last_heartbeat = time.time()
        self.last_activity = time.time()

    def update_activity(self) -> None:
        self.last_activity = time.time()

    def is_stale(self, timeout: float = HEARTBEAT_TIMEOUT_SECONDS) -> bool:
        return (time.time() - self.last_heartbeat) > timeout

    def needs_ping(self, interval: float = PING_INTERVAL_SECONDS) -> bool:
        return (time.time() - self.last_activity) > interval

    def should_throttle_location(self, lat: float, lon: float) -> bool:
        """Check if location update should be throttled based on time and distance."""
        now = time.time() * 1000  # Convert to ms
        time_since_last = now - self.last_location_broadcast

        # Always allow if enough time has passed
        if time_since_last >= LOCATION_THROTTLE_MS:
            return False

        # If we have previous coords, check distance
        if self.last_location_coords:
            prev_lat, prev_lon = self.last_location_coords
            # Quick approximation: 1 degree ≈ 111km at equator
            dist_lat = abs(lat - prev_lat) * 111000
            dist_lon = abs(lon - prev_lon) * 111000 * 0.9  # Rough cos adjustment
            dist = (dist_lat**2 + dist_lon**2) ** 0.5

            # Allow if moved significantly
            if dist >= LOCATION_MIN_DISTANCE_METERS:
                return False

        return True

    def update_location_state(self, lat: float, lon: float) -> None:
        """Update location tracking state after successful broadcast."""
        self.last_location_broadcast = time.time() * 1000
        self.last_location_coords = (lat, lon)


@dataclass
class RideRoom:
    """Represents a ride room containing participants."""

    ride_id: str
    participants: Set[str] = field(default_factory=set)
    created_at: float = field(default_factory=time.time)
    last_driver_location: Optional[dict] = None

    def add_participant(self, user_id: str) -> bool:
        """Add a participant. Returns True if newly added, False if already present."""
        if user_id in self.participants:
            return False
        self.participants.add(user_id)
        return True

    def remove_participant(self, user_id: str) -> None:
        self.participants.discard(user_id)

    def is_empty(self) -> bool:
        return len(self.participants) == 0

    def get_participant_count(self) -> int:
        return len(self.participants)


# =============================================================================
# BACKWARD COMPATIBLE RIDE ROOMS PROXY
# =============================================================================


class RideRoomsProxy:
    """Proxy class for backward-compatible dict-like access to ride rooms."""

    def __init__(self, manager_ref: "ConnectionManager"):
        self._manager = manager_ref

    def __contains__(self, ride_id: str) -> bool:
        return ride_id in self._manager._rooms

    def __setitem__(self, ride_id: str, participants: Set[str]) -> None:
        if ride_id not in self._manager._rooms:
            self._manager._rooms[ride_id] = RideRoom(ride_id=ride_id)
        self._manager._rooms[ride_id].participants = participants

    def __getitem__(self, ride_id: str) -> Set[str]:
        if ride_id in self._manager._rooms:
            return self._manager._rooms[ride_id].participants
        raise KeyError(ride_id)

    def __iter__(self):
        return iter(self._manager._rooms.keys())

    def get(self, ride_id: str, default=None) -> Optional[Set[str]]:
        if ride_id in self._manager._rooms:
            return self._manager._rooms[ride_id].participants
        return default

    def keys(self):
        return self._manager._rooms.keys()

    def items(self):
        return {k: v.participants for k, v in self._manager._rooms.items()}.items()


# =============================================================================
# CONNECTION MANAGER
# =============================================================================


class ConnectionManager:
    """Production-grade WebSocket connection manager."""

    def __init__(self):
        self._connections: Dict[str, ClientConnection] = {}
        self._rooms: Dict[str, RideRoom] = {}
        self._connections_lock = asyncio.Lock()
        self._rooms_lock = asyncio.Lock()
        self._cleanup_task: Optional[asyncio.Task] = None
        self._keepalive_task: Optional[asyncio.Task] = None
        self._is_running = False
        self.ride_rooms = RideRoomsProxy(self)

    async def start(self) -> None:
        if self._is_running:
            return
        self._is_running = True
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        self._keepalive_task = asyncio.create_task(self._keepalive_loop())
        logger.info("ConnectionManager started with background cleanup and keepalive")

    async def stop(self) -> None:
        self._is_running = False
        for task in [self._cleanup_task, self._keepalive_task]:
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        logger.info("ConnectionManager stopped")

    async def _cleanup_loop(self) -> None:
        while self._is_running:
            try:
                await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
                await self._cleanup_stale_connections()
                await self._cleanup_empty_rooms()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Cleanup loop error: {type(e).__name__}: {str(e)}")

    async def _keepalive_loop(self) -> None:
        while self._is_running:
            try:
                await asyncio.sleep(PING_INTERVAL_SECONDS)
                await self._send_keepalive_pings()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Keepalive loop error: {type(e).__name__}: {str(e)}")

    async def _send_keepalive_pings(self) -> None:
        connections_to_ping = []
        async with self._connections_lock:
            for user_id, conn in self._connections.items():
                if conn.is_alive and conn.needs_ping():
                    connections_to_ping.append(user_id)

        for user_id in connections_to_ping:
            try:
                await self.send_to_user(
                    user_id,
                    {"event_type": "ping", "timestamp": datetime.utcnow().isoformat()},
                )
            except Exception as e:
                logger.debug(f"Keepalive ping failed for {user_id}: {e}")

    async def _cleanup_stale_connections(self) -> None:
        async with self._connections_lock:
            stale_users = [
                user_id
                for user_id, conn in self._connections.items()
                if conn.is_stale()
            ]

        for user_id in stale_users:
            logger.warning(f"Removing stale connection: {user_id}")
            await self.disconnect(user_id, reason="Heartbeat timeout")

    async def _cleanup_empty_rooms(self) -> None:
        async with self._rooms_lock:
            empty_rooms = [
                ride_id for ride_id, room in self._rooms.items() if room.is_empty()
            ]
            for ride_id in empty_rooms:
                del self._rooms[ride_id]
                logger.debug(f"Cleaned up empty room: {ride_id}")

    # -------------------------------------------------------------------------
    # Connection Management
    # -------------------------------------------------------------------------

    async def connect(
        self, websocket: WebSocket, user_id: str, role: str
    ) -> ClientConnection:
        """Accept and register a new WebSocket connection."""
        if not self._is_running:
            await self.start()

        if user_id in self._connections:
            logger.info(
                f"Closing existing connection for user {user_id} (new connection)"
            )
            await self.disconnect(user_id, reason="New connection established")

        await websocket.accept()

        connection = ClientConnection(websocket=websocket, user_id=user_id, role=role)

        async with self._connections_lock:
            self._connections[user_id] = connection

        logger.info(f"WebSocket connected: user_id={user_id}, role={role}")
        return connection

    async def disconnect(
        self, user_id: str, reason: str = "Client disconnected"
    ) -> None:
        """Disconnect and cleanup a WebSocket connection."""
        connection = None

        async with self._connections_lock:
            connection = self._connections.pop(user_id, None)

        if connection:
            connection.is_alive = False

            for ride_id in list(connection.joined_rooms):
                await self.leave_room(ride_id, user_id)

            try:
                await connection.websocket.close(
                    code=status.WS_1000_NORMAL_CLOSURE, reason=reason
                )
            except Exception:
                pass

        logger.info(f"WebSocket disconnected: user_id={user_id}, reason={reason}")

    def get_connection(self, user_id: str) -> Optional[ClientConnection]:
        return self._connections.get(user_id)

    def is_connected(self, user_id: str) -> bool:
        conn = self._connections.get(user_id)
        return conn is not None and conn.is_alive

    # -------------------------------------------------------------------------
    # Room Management
    # -------------------------------------------------------------------------

    async def join_room(self, ride_id: str, user_id: str) -> bool:
        """Add a user to a ride room. Returns False if already joined."""
        connection = self.get_connection(user_id)

        async with self._rooms_lock:
            if ride_id not in self._rooms:
                self._rooms[ride_id] = RideRoom(ride_id=ride_id)

            if user_id in self._rooms[ride_id].participants:
                logger.debug(f"User {user_id} already in room {ride_id}, skipping")
                return False

            self._rooms[ride_id].add_participant(user_id)

        if connection:
            connection.joined_rooms.add(ride_id)

        logger.info(f"User {user_id} joined room {ride_id}")
        return True

    async def leave_room(self, ride_id: str, user_id: str) -> bool:
        """Remove a user from a ride room."""
        connection = self.get_connection(user_id)

        async with self._rooms_lock:
            if ride_id not in self._rooms:
                return False

            self._rooms[ride_id].remove_participant(user_id)

            if self._rooms[ride_id].is_empty():
                del self._rooms[ride_id]
                logger.debug(f"Room {ride_id} removed (empty)")

        if connection:
            connection.joined_rooms.discard(ride_id)

        logger.info(f"User {user_id} left room {ride_id}")
        return True

    def get_room_participants(self, ride_id: str) -> Set[str]:
        room = self._rooms.get(ride_id)
        return room.participants.copy() if room else set()

    def is_room_active(self, ride_id: str) -> bool:
        room = self._rooms.get(ride_id)
        return room is not None and not room.is_empty()

    def get_room(self, ride_id: str) -> Optional[RideRoom]:
        return self._rooms.get(ride_id)

    async def update_room_driver_location(self, ride_id: str, location: dict) -> None:
        async with self._rooms_lock:
            if ride_id in self._rooms:
                self._rooms[ride_id].last_driver_location = location

    # -------------------------------------------------------------------------
    # Messaging
    # -------------------------------------------------------------------------

    async def send_to_user(
        self, user_id: str, message: dict, timeout: float = SEND_TIMEOUT_SECONDS
    ) -> bool:
        """Send a message to a specific user with timeout protection."""
        connection = self.get_connection(user_id)
        if not connection or not connection.is_alive:
            return False

        try:
            ws_state = connection.websocket.client_state
            if ws_state.name != "CONNECTED":
                logger.debug(
                    f"WebSocket not in CONNECTED state for {user_id}: {ws_state.name}"
                )
                connection.is_alive = False
                return False
        except Exception:
            # If we can't check state, proceed cautiously
            pass

        try:
            async with connection.write_lock:
                await asyncio.wait_for(
                    connection.websocket.send_json(message), timeout=timeout
                )
            connection.update_activity()
            logger.debug(
                f"Message sent to {user_id}: {message.get('event_type', 'unknown')}"
            )
            return True

        except asyncio.TimeoutError:
            logger.warning(f"Send timeout for user {user_id}, marking as stale")
            connection.is_alive = False
            return False

        except RuntimeError as e:
            if "not connected" in str(e).lower() or "accept" in str(e).lower():
                logger.debug(f"WebSocket not connected for {user_id}, marking as dead")
            else:
                logger.error(f"RuntimeError sending to {user_id}: {str(e)}")
            connection.is_alive = False
            return False

        except Exception as e:
            logger.error(f"Error sending to {user_id}: {type(e).__name__}: {str(e)}")
            connection.is_alive = False
            return False

    async def broadcast_to_room(
        self, ride_id: str, message: dict, exclude_user: Optional[str] = None
    ) -> int:
        """Broadcast a message to all participants in a ride room."""
        participants = self.get_room_participants(ride_id)
        if not participants:
            logger.debug(f"No participants in room {ride_id} for broadcast")
            return 0

        if exclude_user:
            participants.discard(exclude_user)

        tasks = [self.send_to_user(user_id, message) for user_id in participants]

        results = await asyncio.gather(*tasks, return_exceptions=True)
        success_count = sum(1 for r in results if r is True)

        logger.debug(
            f"Broadcast to room {ride_id}: {success_count}/{len(participants)} successful, "
            f"event={message.get('event_type', 'unknown')}"
        )
        return success_count

    async def broadcast_to_all(self, message: dict) -> int:
        """Broadcast message to all connected clients."""
        sent_count = 0
        disconnected = []

        async with self._connections_lock:
            connections_snapshot = list(self._connections.items())

        for user_id, connection in connections_snapshot:
            try:
                try:
                    ws_state = connection.websocket.client_state
                    if ws_state.name != "CONNECTED":
                        disconnected.append(user_id)
                        continue
                except Exception:
                    pass

                async with asyncio.timeout(5.0):
                    async with connection.write_lock:
                        await connection.websocket.send_json(message)
                    sent_count += 1
            except RuntimeError as e:
                if "not connected" in str(e).lower() or "accept" in str(e).lower():
                    logger.debug(
                        f"WebSocket not connected for {user_id} during broadcast"
                    )
                else:
                    logger.warning(f"RuntimeError broadcasting to {user_id}: {e}")
                disconnected.append(user_id)
            except Exception as e:
                logger.warning(f"Failed to send to user {user_id}: {e}")
                disconnected.append(user_id)

        # Clean up disconnected
        for user_id in disconnected:
            await self.disconnect(user_id)

        return sent_count

    # -------------------------------------------------------------------------
    # BACKWARD COMPATIBILITY METHODS
    # -------------------------------------------------------------------------

    async def send_personal_message(self, message: dict, user_id: str) -> bool:
        """DEPRECATED: Use send_to_user(user_id, message) instead."""
        return await self.send_to_user(user_id, message)

    async def broadcast_to_ride(
        self, message: dict, ride_id: str, exclude_user: Optional[str] = None
    ) -> int:
        """DEPRECATED: Use broadcast_to_room(ride_id, message) instead."""
        return await self.broadcast_to_room(ride_id, message, exclude_user)

    # -------------------------------------------------------------------------
    # Statistics
    # -------------------------------------------------------------------------

    def get_stats(self) -> dict:
        return {
            "active_connections": len(self._connections),
            "active_rooms": len(self._rooms),
            "rooms": {
                ride_id: room.get_participant_count()
                for ride_id, room in self._rooms.items()
            },
            "connections_by_role": self._count_by_role(),
        }

    def _count_by_role(self) -> dict:
        counts = {"rider": 0, "driver": 0}
        for conn in self._connections.values():
            if conn.role in counts:
                counts[conn.role] += 1
        return counts


# =============================================================================
# GLOBAL MANAGER INSTANCE
# =============================================================================

manager = ConnectionManager()
ride_rooms = manager.ride_rooms


# =============================================================================
# RIDE STATE VALIDATION
# =============================================================================


def is_valid_state_transition(current_status: str, new_status: str) -> bool:
    """Check if a ride state transition is valid."""
    valid_next_states = VALID_STATE_TRANSITIONS.get(current_status, [])
    return new_status in valid_next_states


# =============================================================================
# EVENT HANDLERS
# =============================================================================


async def handle_join_ride(connection: ClientConnection, data: dict) -> dict:
    """Handle join_ride event - add user to ride room with validation."""
    ride_id = data.get("ride_id")

    if not ride_id:
        return {"event_type": "error", "message": "Missing ride_id"}

    if ride_id in connection.joined_rooms:
        logger.debug(f"User {connection.user_id} already joined room {ride_id}")
        return {
            "event_type": "joined_ride",
            "ride_id": ride_id,
            "message": "Already in ride room",
        }

    # Verify user is a participant in this ride
    try:
        ride = Ride.objects(id=ride_id).first()
        if not ride:
            return {"event_type": "error", "message": "Ride not found"}

        rider_id = str(ride.rider.id) if ride.rider else None
        driver_id = str(ride.driver.id) if ride.driver else None

        is_participant = (
            connection.user_id == rider_id or connection.user_id == driver_id
        )

        if not is_participant:
            logger.warning(
                f"Unauthorized join attempt: user {connection.user_id} for ride {ride_id}"
            )
            return {
                "event_type": "error",
                "message": "You are not a participant in this ride",
            }

        if ride.status in ["completed", "cancelled"]:
            return {
                "event_type": "error",
                "message": f"Cannot join ride with status: {ride.status}",
            }

    except Exception as e:
        logger.error(f"Error verifying ride participant: {str(e)}")
        return {"event_type": "error", "message": "Error verifying ride participation"}

    was_newly_joined = await manager.join_room(ride_id, connection.user_id)
    connection.update_heartbeat()

    response = {
        "event_type": "joined_ride",
        "ride_id": ride_id,
        "message": "Successfully joined ride room",
    }

    room = manager.get_room(ride_id)
    if room and room.last_driver_location:
        response["last_driver_location"] = room.last_driver_location

    # Include current ride status for state sync
    response["ride_status"] = ride.status

    return response


async def handle_leave_ride(connection: ClientConnection, data: dict) -> dict:
    """Handle leave_ride event - remove user from ride room."""
    ride_id = data.get("ride_id")

    if not ride_id:
        return {"event_type": "error", "message": "Missing ride_id"}

    await manager.leave_room(ride_id, connection.user_id)
    connection.update_heartbeat()

    return {
        "event_type": "left_ride",
        "ride_id": ride_id,
        "message": "Successfully left ride room",
    }


async def handle_location_update(
    connection: ClientConnection, data: dict
) -> Optional[dict]:
    """Handle location_update event from drivers with throttling."""
    if connection.role != "driver":
        logger.warning(f"Non-driver {connection.user_id} attempted location update")
        return {
            "event_type": "error",
            "message": "Only drivers can send location updates",
        }

    ride_id = data.get("ride_id")
    latitude = data.get("latitude")
    longitude = data.get("longitude")

    if not ride_id:
        return {"event_type": "error", "message": "Missing ride_id for location update"}

    if latitude is None or longitude is None:
        logger.warning(
            f"Invalid location from {connection.user_id}: lat={latitude}, lon={longitude}"
        )
        return {"event_type": "error", "message": "Missing latitude or longitude"}

    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError):
        return {"event_type": "error", "message": "Invalid coordinate format"}

    if not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
        return {"event_type": "error", "message": "Coordinates out of valid range"}

    if connection.should_throttle_location(latitude, longitude):
        logger.debug(f"Throttled location update from {connection.user_id}")
        return None  # Silently drop throttled updates

    # Update driver's location in database
    try:
        driver = User.objects(id=connection.user_id).first()
        if driver:
            driver.location = {"type": "Point", "coordinates": [longitude, latitude]}
            driver.save()
    except Exception as e:
        logger.error(f"Failed to update driver location in DB: {str(e)}")

    connection.update_heartbeat()
    connection.update_location_state(latitude, longitude)

    location_message = {
        "event_type": "driver_location_update",
        "driver_id": connection.user_id,
        "ride_id": ride_id,
        "latitude": latitude,
        "longitude": longitude,
        "timestamp": data.get("timestamp", datetime.utcnow().isoformat()),
        "heading": data.get("heading"),
        "speed": data.get("speed"),
    }

    await manager.update_room_driver_location(
        ride_id,
        {
            "latitude": latitude,
            "longitude": longitude,
            "timestamp": location_message["timestamp"],
        },
    )

    await manager.broadcast_to_room(
        ride_id, location_message, exclude_user=connection.user_id
    )

    return None


async def handle_ping(connection: ClientConnection, data: dict) -> dict:
    """Handle ping event - respond with pong for heartbeat."""
    connection.last_heartbeat = time.time()
    connection.last_activity = time.time()
    return {"event_type": "pong", "timestamp": datetime.utcnow().isoformat()}


async def handle_pong(connection: ClientConnection, data: dict) -> Optional[dict]:
    """Handle pong event from client - update connection health."""
    connection.last_pong = time.time()
    connection.is_alive = True
    # No response needed for pong - it's just an acknowledgment
    return None


EVENT_HANDLERS = {
    "join_ride": handle_join_ride,
    "leave_ride": handle_leave_ride,
    "location_update": handle_location_update,
    "ping": handle_ping,
    "pong": handle_pong,
}


# =============================================================================
# WEBSOCKET ENDPOINT
# =============================================================================


@router.websocket("/ride")
async def websocket_endpoint(websocket: WebSocket):
    """Main WebSocket endpoint for real-time communication."""
    connection: Optional[ClientConnection] = None
    user_id: Optional[str] = None

    try:
        auth_result = await authenticate_websocket(websocket)
        if not auth_result:
            return

        if isinstance(auth_result, dict):
            user_id = auth_result.get("user_id")
            role = auth_result.get("role")
        elif isinstance(auth_result, (tuple, list)) and len(auth_result) >= 2:
            user_id, role = auth_result[0], auth_result[1]
        else:
            logger.error(f"Unexpected auth_result format: {type(auth_result)}")
            await websocket.close(code=1008, reason="Authentication error")
            return

        if not user_id or not role:
            logger.error(f"Missing user_id or role in auth_result: {auth_result}")
            await websocket.close(code=1008, reason="Invalid authentication data")
            return

        connection = await manager.connect(websocket, user_id, role)

        active_ride = await _find_active_ride_for_user(user_id, role)

        connected_response = {
            "event_type": "connected",
            "message": "Connected to E-Boda real-time service",
            "user_id": user_id,
            "role": role,
            "timestamp": datetime.utcnow().isoformat(),
        }

        if active_ride:
            connected_response["active_ride"] = {
                "ride_id": str(active_ride.id),
                "status": active_ride.status,
            }

        await manager.send_to_user(user_id, connected_response)

        # Message loop
        while True:
            try:
                raw_message = await asyncio.wait_for(
                    websocket.receive_text(), timeout=HEARTBEAT_INTERVAL_SECONDS
                )

                connection.update_activity()

                try:
                    data = json.loads(raw_message)
                except json.JSONDecodeError:
                    await manager.send_to_user(
                        user_id,
                        {"event_type": "error", "message": "Invalid JSON format"},
                    )
                    continue

                event_type = data.get("event_type") or data.get("type")
                if not event_type:
                    await manager.send_to_user(
                        user_id,
                        {"event_type": "error", "message": "Missing event_type"},
                    )
                    continue

                handler = EVENT_HANDLERS.get(event_type)
                if handler:
                    response = await handler(connection, data)
                    if response:
                        await manager.send_to_user(user_id, response)
                else:
                    await manager.send_to_user(
                        user_id,
                        {
                            "event_type": "error",
                            "message": f"Unknown event type: {event_type}",
                        },
                    )

            except asyncio.TimeoutError:
                if not connection.is_alive:
                    logger.info(f"Connection marked dead for {user_id}")
                    break
                continue

            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected normally: {user_id}")
                break
            except Exception as e:
                logger.error(
                    f"Message processing error for {user_id}: {type(e).__name__}: {str(e)}"
                )
                continue

    except Exception as e:
        logger.error(
            f"WebSocket connection error for {user_id}: {type(e).__name__}: {str(e)}"
        )
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except:
            pass

    finally:
        if user_id:
            await manager.disconnect(user_id, reason="Connection ended")


async def _find_active_ride_for_user(user_id: str, role: str) -> Optional[Ride]:
    """Find any active ride for a user to support auto-rejoin on reconnect."""
    try:
        active_statuses = ["pending", "accepted", "in_progress"]

        if role == "rider":
            ride = (
                Ride.objects(rider=user_id, status__in=active_statuses)
                .order_by("-created_at")
                .first()
            )
        elif role == "driver":
            ride = (
                Ride.objects(driver=user_id, status__in=active_statuses)
                .order_by("-created_at")
                .first()
            )
        else:
            return None

        return ride
    except Exception as e:
        logger.error(f"Error finding active ride for {user_id}: {str(e)}")
        return None


# =============================================================================
# ADMIN ENDPOINT
# =============================================================================


@router.get("/stats")
async def get_websocket_stats():
    """Get WebSocket statistics for monitoring."""
    stats = manager.get_stats()
    return {
        "success": True,
        "data": {
            "active_connections": stats["active_connections"],
            "active_rooms": stats["active_rooms"],
            "ride_rooms": stats["rooms"],
            "connections_by_role": stats["connections_by_role"],
        },
    }


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================


async def broadcast_ride_event(ride_id: str, event: dict) -> int:
    """Broadcast an event to all participants in a ride room."""
    return await manager.broadcast_to_room(ride_id, event)
