"""
User Model - Represents riders and drivers
Includes authentication fields and role-based access
"""

from mongoengine import (
    Document,
    StringField,
    EmailField,
    BooleanField,
    DateTimeField,
    PointField,
)
from datetime import datetime
from passlib.context import CryptContext

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class User(Document):
    """
    User model for both riders and drivers
    Role determines access level: 'rider', 'driver', 'admin'
    """

    meta = {
        "collection": "users",
        "indexes": ["email", "phone", "role", {"fields": [("location", "2dsphere")]}],
        "strict": False,
    }

    # Basic Information
    full_name = StringField(required=True, max_length=100)
    email = EmailField(required=True, unique=True)
    phone = StringField(required=True, unique=True, max_length=15)
    password_hash = StringField(required=True)

    # Role and Status
    role = StringField(
        required=True, choices=["rider", "driver", "admin"], default="rider"
    )
    is_active = BooleanField(default=True)
    is_verified = BooleanField(default=False)

    # Driver-specific fields
    driver_license = StringField(max_length=50)
    vehicle_plate = StringField(max_length=20)
    vehicle_model = StringField(max_length=50)
    is_available = BooleanField(default=False)  # For drivers only

    location = PointField(
        auto_index=False
    )  # GeoJSON Point: {"type": "Point", "coordinates": [longitude, latitude]}

    # Ratings
    rating = StringField(default="5.0")
    total_rides = StringField(default="0")

    # Timestamps
    created_at = DateTimeField(default=datetime.utcnow)
    updated_at = DateTimeField(default=datetime.utcnow)

    def set_password(self, password: str):
        """Hash and set user password"""
        self.password_hash = pwd_context.hash(password)

    def verify_password(self, password: str) -> bool:
        """Verify password against hash"""
        return pwd_context.verify(password, self.password_hash)

    def to_dict(self):
        """Convert user to dictionary (exclude sensitive data)"""
        user_dict = {
            "id": str(self.id),
            "full_name": self.full_name,
            "email": self.email,
            "phone": self.phone,
            "role": self.role,
            "is_active": self.is_active,
            "is_verified": self.is_verified,
            "rating": self.rating,
            "total_rides": self.total_rides,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

        # Driver-specific fields
        if self.role == "driver":
            user_dict.update(
                {
                    "driver_license": self.driver_license,
                    "vehicle_plate": self.vehicle_plate,
                    "vehicle_model": self.vehicle_model,
                    "is_available": self.is_available,
                    "location": self.location if self.location else None,
                }
            )

        return user_dict

    def __str__(self):
        return f"User({self.full_name}, {self.role})"
