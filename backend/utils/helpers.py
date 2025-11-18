"""
Helper Utilities
Common utility functions used across the application
"""

import math
from typing import Tuple


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate distance between two coordinates using Haversine formula

    Args:
        lat1, lon1: First coordinate (latitude, longitude)
        lat2, lon2: Second coordinate (latitude, longitude)

    Returns:
        Distance in kilometers
    """
    # Earth's radius in kilometers
    R = 6371.0

    # Convert degrees to radians
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)

    # Differences
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad

    # Haversine formula
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    distance = R * c
    return round(distance, 2)


def calculate_fare(
    pickup_lat: float,
    pickup_lon: float,
    dropoff_lat: float,
    dropoff_lon: float,
    base_fare: float = 2000.0,  # UGX
    per_km_rate: float = 1500.0,  # UGX per km
) -> float:
    """
    Calculate estimated ride fare based on distance

    Args:
        pickup_lat, pickup_lon: Pickup coordinates
        dropoff_lat, dropoff_lon: Dropoff coordinates
        base_fare: Base fare in UGX (default: 2000)
        per_km_rate: Rate per kilometer in UGX (default: 1500)

    Returns:
        Estimated fare in UGX

    Note:
        This is a simple calculation. In production, integrate with
        Google Maps Distance Matrix API for accurate distance and time
    """
    # Calculate distance
    distance = calculate_distance(pickup_lat, pickup_lon, dropoff_lat, dropoff_lon)

    # Calculate fare
    fare = base_fare + (distance * per_km_rate)

    # Round to nearest 100 UGX
    fare = round(fare / 100) * 100

    return fare


def format_phone_number(phone: str) -> str:
    """
    Format phone number to standard format

    Args:
        phone: Phone number string

    Returns:
        Formatted phone number
    """
    # Remove all non-digit characters
    digits = "".join(filter(str.isdigit, phone))

    # Add Uganda country code if not present
    if not digits.startswith("256"):
        if digits.startswith("0"):
            digits = "256" + digits[1:]
        else:
            digits = "256" + digits

    return digits


def validate_coordinates(latitude: str, longitude: str) -> Tuple[bool, str]:
    """
    Validate latitude and longitude coordinates

    Args:
        latitude: Latitude string
        longitude: Longitude string

    Returns:
        Tuple of (is_valid, error_message)
    """
    try:
        lat = float(latitude)
        lon = float(longitude)

        # Check valid ranges
        if not (-90 <= lat <= 90):
            return False, "Latitude must be between -90 and 90"

        if not (-180 <= lon <= 180):
            return False, "Longitude must be between -180 and 180"

        return True, ""

    except ValueError:
        return False, "Invalid coordinate format"


def get_ride_status_message(status: str) -> str:
    """
    Get user-friendly message for ride status

    Args:
        status: Ride status

    Returns:
        User-friendly status message
    """
    messages = {
        "pending": "Looking for a driver...",
        "accepted": "Driver is on the way to pick you up",
        "in_progress": "Ride in progress",
        "completed": "Ride completed successfully",
        "cancelled": "Ride was cancelled",
    }

    return messages.get(status, "Unknown status")


def calculate_eta(distance_km: float, avg_speed_kmh: float = 30.0) -> int:
    """
    Calculate estimated time of arrival in minutes

    Args:
        distance_km: Distance in kilometers
        avg_speed_kmh: Average speed in km/h (default: 30)

    Returns:
        ETA in minutes
    """
    if distance_km <= 0:
        return 0

    hours = distance_km / avg_speed_kmh
    minutes = hours * 60

    return round(minutes)
