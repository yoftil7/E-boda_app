"""
Ride Model - Represents ride requests and their lifecycle
Tracks status from pending to completed/cancelled
"""

from mongoengine import (
    Document,
    StringField,
    ReferenceField,
    DateTimeField,
    FloatField,
    IntField,
)
from datetime import datetime
from models.user_model import User


class Ride(Document):
    """
    Ride model tracking the complete lifecycle of a ride request
    Status flow: pending → accepted → in_progress → completed/cancelled
    """

    meta = {
        "collection": "rides",
        "indexes": ["status", "rider", "driver", "created_at"],
    }

    # Participants
    rider = ReferenceField(User, required=True, reverse_delete_rule=2)  # CASCADE
    driver = ReferenceField(User, reverse_delete_rule=2)  # Assigned when accepted

    # Location Details
    pickup_address = StringField(required=True, max_length=200)
    pickup_latitude = FloatField(required=True)
    pickup_longitude = FloatField(required=True)
    pickup_place_name = StringField(max_length=200)

    dropoff_address = StringField(required=True, max_length=200)
    dropoff_latitude = FloatField(required=True)
    dropoff_longitude = FloatField(required=True)
    dropoff_place_name = StringField(max_length=200)

    # Ride Details
    distance_km = FloatField(default=0.0)  # Will be calculated via Google Maps API
    estimated_fare = FloatField(required=True)
    final_fare = FloatField()  # Set when ride is completed

    # Status Management
    status = StringField(
        required=True,
        choices=["pending", "accepted", "in_progress", "completed", "cancelled"],
        default="pending",
    )

    # Additional Information
    rider_notes = StringField(max_length=500)
    cancellation_reason = StringField(max_length=500)

    rider_rating = IntField(min_value=1, max_value=5)
    rider_feedback = StringField(max_length=500)
    rated_at = DateTimeField()

    # Timestamps for lifecycle tracking
    created_at = DateTimeField(default=datetime.utcnow)
    accepted_at = DateTimeField()
    started_at = DateTimeField()
    completed_at = DateTimeField()
    cancelled_at = DateTimeField()
    updated_at = DateTimeField(default=datetime.utcnow)

    def to_dict(self):
        """Convert ride to dictionary"""
        return {
            "id": str(self.id),
            "rider": (
                {
                    "id": str(self.rider.id),
                    "name": self.rider.full_name,
                    "phone": self.rider.phone,
                }
                if self.rider
                else None
            ),
            "driver": (
                {
                    "id": str(self.driver.id),
                    "name": self.driver.full_name,
                    "phone": self.driver.phone,
                    "vehicle_plate": self.driver.vehicle_plate,
                    "vehicle_model": self.driver.vehicle_model,
                    "rating": self.driver.rating,
                }
                if self.driver
                else None
            ),
            "pickup": {
                "address": self.pickup_address,
                "latitude": self.pickup_latitude,
                "longitude": self.pickup_longitude,
                "place_name": self.pickup_place_name,
            },
            "dropoff": {
                "address": self.dropoff_address,
                "latitude": self.dropoff_latitude,
                "longitude": self.dropoff_longitude,
                "place_name": self.dropoff_place_name,
            },
            "distance_km": self.distance_km,
            "estimated_fare": self.estimated_fare,
            "final_fare": self.final_fare,
            "status": self.status,
            "rider_notes": self.rider_notes,
            "cancellation_reason": self.cancellation_reason,
            "rider_rating": self.rider_rating,
            "rider_feedback": self.rider_feedback,
            "rated_at": self.rated_at.isoformat() if self.rated_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "accepted_at": self.accepted_at.isoformat() if self.accepted_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": (
                self.completed_at.isoformat() if self.completed_at else None
            ),
            "cancelled_at": (
                self.cancelled_at.isoformat() if self.cancelled_at else None
            ),
        }

    def __str__(self):
        return f"Ride({self.id}, {self.status})"
