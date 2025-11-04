"""
WebSocket Authentication Utility
Handles JWT authentication for WebSocket connections
"""

from fastapi import WebSocket, status
from jose import jwt, JWTError
import os
import logging

logger = logging.getLogger(__name__)

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "supersecretkey")
JWT_ALGORITHM = "HS256"


async def authenticate_websocket(websocket: WebSocket) -> dict:
    """
    Authenticate WebSocket connection using JWT token

    Args:
        websocket: WebSocket connection

    Returns:
        Decoded token payload with user information

    Raises:
        Exception if authentication fails
    """
    # Try to get token from query parameters first
    token = websocket.query_params.get("token")

    # If not in query params, try headers
    if not token:
        auth_header = websocket.headers.get("authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if not token:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Missing authentication token"
        )
        raise Exception("Missing authentication token")

    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        role = payload.get("role")

        if not user_id or not role:
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token payload"
            )
            raise Exception("Invalid token payload")

        return {"user_id": user_id, "email": payload.get("email"), "role": role}

    except JWTError as e:
        logger.error(f"JWT validation error: {str(e)}")
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired token"
        )
        raise Exception("Invalid or expired token")
