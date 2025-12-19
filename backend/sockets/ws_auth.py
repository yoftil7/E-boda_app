"""
WebSocket Authentication Utility
Handles JWT authentication for WebSocket connections
"""

from fastapi import WebSocket, status
from jose import jwt, JWTError
import os
import logging

logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"


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
    logger.info("=" * 60)
    logger.info("WebSocket Authentication Started")
    logger.info(f"SECRET_KEY being used: {SECRET_KEY[:10]}...{SECRET_KEY[-10:]}")

    # Try to get token from query parameters first
    token = websocket.query_params.get("token")
    logger.info(f"Token from query params: {'Found' if token else 'Not found'}")
    if token:
        logger.info(f"Token preview: {token[:20]}...{token[-20:]}")

    # If not in query params, try headers
    if not token:
        auth_header = websocket.headers.get("authorization")
        logger.info(
            f"Authorization header: {auth_header[:30] if auth_header else 'None'}"
        )
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
            logger.info(f"Token from header: {token[:20]}...{token[-20:]}")

    if not token:
        logger.warning("WebSocket connection rejected: Missing authentication token")
        # The caller (websocket_endpoint) handles cleanup
        raise Exception("Missing authentication token")

    try:
        logger.info(f"Attempting to decode token with SECRET_KEY...")
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        logger.info(f"Token decoded successfully! Payload: {payload}")

        user_id = payload.get("user_id")
        role = payload.get("role")

        if not user_id or not role:
            logger.warning(
                f"WebSocket connection rejected: Invalid token payload - user_id={user_id}, role={role}"
            )
            raise Exception("Invalid token payload")

        logger.info(
            f"WebSocket authenticated successfully: user_id={user_id}, role={role}"
        )
        logger.info("=" * 60)
        return {"user_id": user_id, "email": payload.get("email"), "role": role}

    except JWTError as e:
        logger.error("=" * 60)
        logger.error(f"JWT validation FAILED!")
        logger.error(f"Error type: {type(e).__name__}")
        logger.error(f"Error message: {str(e)}")
        logger.error(f"SECRET_KEY used: {SECRET_KEY[:10]}...{SECRET_KEY[-10:]}")
        logger.error(f"Token that failed: {token[:30]}...{token[-30:]}")
        logger.error("=" * 60)
        raise Exception("Invalid or expired token")
