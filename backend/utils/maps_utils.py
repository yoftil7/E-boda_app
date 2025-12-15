"""
Google Maps Integration Utilities
Handles distance calculation, ETA, routing, and fare estimation using Google Routes API
"""

import os
import httpx
from typing import Dict, Tuple, Optional
import logging
import json

logger = logging.getLogger(__name__)

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
BASE_FARE = 2000  # UGX
PRICE_PER_KM = 1500  # UGX per kilometer
PRICE_PER_MINUTE = 100  # UGX per minute


async def get_distance_and_eta(
    origin: Tuple[float, float], destination: Tuple[float, float]
) -> Dict:
    """
    Get distance and estimated time of arrival using Google Routes API (Distance Matrix)

    Args:
        origin: Tuple of (latitude, longitude) for starting point
        destination: Tuple of (latitude, longitude) for ending point

    Returns:
        Dict with distance_km, duration_minutes, and duration_text
    """
    if not GOOGLE_MAPS_API_KEY:
        logger.warning("Google Maps API key not configured, using fallback calculation")
        return _fallback_distance_calculation(origin, destination)

    try:
        url = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"

        payload = {
            "origins": [
                {
                    "waypoint": {
                        "location": {
                            "latLng": {"latitude": origin[0], "longitude": origin[1]}
                        }
                    }
                }
            ],
            "destinations": [
                {
                    "waypoint": {
                        "location": {
                            "latLng": {
                                "latitude": destination[0],
                                "longitude": destination[1],
                            }
                        }
                    }
                }
            ],
            "travelMode": "DRIVE",
        }

        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status",
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                url, json=payload, headers=headers, timeout=10.0
            )

            if response.status_code != 200:
                logger.warning(
                    f"Routes API returned {response.status_code}: {response.text}, using fallback"
                )
                return _fallback_distance_calculation(origin, destination)

            data = response.json()

        if not data or "rows" not in data or not data["rows"]:
            logger.warning("Routes API returned empty response, using fallback")
            return _fallback_distance_calculation(origin, destination)

        # Extract first result from rows array
        row = data["rows"][0]
        if "elements" not in row or not row["elements"]:
            logger.warning("No elements in Routes API response, using fallback")
            return _fallback_distance_calculation(origin, destination)

        element = row["elements"][0]

        # Check status
        if element.get("status") != "OK":
            logger.warning(
                f"Route calculation status: {element.get('status')}, using fallback"
            )
            return _fallback_distance_calculation(origin, destination)

        # Extract distance and duration
        distance_meters = element.get("distanceMeters", 0)
        duration_str = element.get("duration", "0s")

        # Parse duration string (format: "123s")
        duration_seconds = (
            int(duration_str.replace("s", "")) if isinstance(duration_str, str) else 0
        )

        distance_km = round(distance_meters / 1000, 2)
        duration_minutes = round(duration_seconds / 60)

        return {
            "distance_km": distance_km,
            "duration_minutes": max(duration_minutes, 5),  # Minimum 5 minutes
            "duration_text": f"{duration_minutes} mins",
            "distance_text": f"{distance_km:.1f} km",
        }

    except Exception as e:
        logger.warning(f"Google Routes API error: {str(e)}, using fallback calculation")
        return _fallback_distance_calculation(origin, destination)


async def get_route_polyline(
    origin: Tuple[float, float], destination: Tuple[float, float]
) -> Optional[str]:
    """
    Get route polyline using Google Routes API (Compute Routes)

    Args:
        origin: Tuple of (latitude, longitude) for starting point
        destination: Tuple of (latitude, longitude) for ending point

    Returns:
        Encoded polyline string or None if error
    """
    if not GOOGLE_MAPS_API_KEY:
        logger.warning("Google Maps API key not configured")
        return None

    try:
        url = "https://routes.googleapis.com/directions/v2:computeRoutes"

        payload = {
            "origin": {
                "location": {"latLng": {"latitude": origin[0], "longitude": origin[1]}}
            },
            "destination": {
                "location": {
                    "latLng": {"latitude": destination[0], "longitude": destination[1]}
                }
            },
            "travelMode": "DRIVE",
        }

        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                url, json=payload, headers=headers, timeout=10.0
            )

            if response.status_code != 200:
                logger.warning(
                    f"Routes API returned {response.status_code}: {response.text}"
                )
                return None

            data = response.json()

        if "routes" not in data or not data["routes"]:
            logger.warning("Routes API returned no routes")
            return None

        route = data["routes"][0]

        # Extract polyline
        if "polyline" in route and "encodedPolyline" in route["polyline"]:
            polyline = route["polyline"]["encodedPolyline"]
            return polyline

        logger.warning("No polyline found in Routes API response")
        return None

    except Exception as e:
        logger.warning(f"Error getting route polyline: {str(e)}")
        return None


def calculate_fare(distance_km: float, duration_minutes: int = 0) -> float:
    """
    Calculate ride fare based on distance and duration

    Args:
        distance_km: Distance in kilometers
        duration_minutes: Duration in minutes

    Returns:
        Fare in UGX
    """
    distance_cost = distance_km * PRICE_PER_KM
    time_cost = duration_minutes * PRICE_PER_MINUTE
    total_fare = BASE_FARE + distance_cost + time_cost

    # Round to nearest 500 UGX
    return round(total_fare / 500) * 500


def _fallback_distance_calculation(
    origin: Tuple[float, float], destination: Tuple[float, float]
) -> Dict:
    """
    Fallback calculation using Haversine formula when Google Maps API is unavailable
    """
    from math import radians, sin, cos, sqrt, atan2

    lat1, lon1 = origin
    lat2, lon2 = destination

    R = 6371  # Earth's radius in kilometers

    lat1_rad = radians(lat1)
    lat2_rad = radians(lat2)
    delta_lat = radians(lat2 - lat1)
    delta_lon = radians(lon2 - lon1)

    a = (
        sin(delta_lat / 2) ** 2
        + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon / 2) ** 2
    )
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    distance_km = R * c

    # Estimate duration (assuming average speed of 30 km/h in city traffic)
    duration_minutes = round((distance_km / 30) * 60)

    return {
        "distance_km": round(distance_km, 2),
        "duration_minutes": max(duration_minutes, 5),  # Minimum 5 minutes
        "duration_text": f"{duration_minutes} mins",
        "distance_text": f"{distance_km:.1f} km",
    }
