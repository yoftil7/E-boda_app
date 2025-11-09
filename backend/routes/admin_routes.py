"""
Admin Routes
Administrative functions for managing users, drivers, and rides
"""
from fastapi import APIRouter, HTTPException, Depends, status, Query
from typing import Optional
from datetime import datetime, timedelta
from models.user_model import User
from models.ride_model import Ride
from utils.jwt_utils import get_current_user, require_admin
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/users")
async def get_all_users(
    role: Optional[str] = Query(None, description="Filter by role"),
    current_user: User = Depends(require_admin)
):
    """
    Get all users with optional role filter
    Admin only
    """
    query = {}
    if role:
        query["role"] = role
    
    users = User.objects(**query).order_by('-created_at')
    
    return {
        "success": True,
        "count": len(users),
        "users": [user.to_dict() for user in users]
    }

@router.get("/drivers")
async def get_all_drivers(
    available_only: bool = Query(False, description="Show only available drivers"),
    current_user: User = Depends(require_admin)
):
    """
    Get all drivers with availability filter
    Admin only
    """
    query = {"role": "driver"}
    if available_only:
        query["is_available"] = True
    
    drivers = User.objects(**query).order_by('-created_at')
    
    return {
        "success": True,
        "count": len(drivers),
        "drivers": [driver.to_dict() for driver in drivers]
    }

@router.get("/rides")
async def get_all_rides(
    status_filter: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(100, description="Number of rides to return"),
    current_user: User = Depends(require_admin)
):
    """
    Get all rides with optional status filter
    Admin only
    """
    query = {}
    if status_filter:
        query["status"] = status_filter
    
    rides = Ride.objects(**query).order_by('-created_at').limit(limit)
    
    return {
        "success": True,
        "count": len(rides),
        "rides": [ride.to_dict() for ride in rides]
    }

@router.get("/stats")
async def get_platform_stats(
    current_user: User = Depends(require_admin)
):
    """
    Get aggregated platform statistics
    Admin only
    """
    try:
        # User statistics
        total_users = User.objects.count()
        total_riders = User.objects(role="rider").count()
        total_drivers = User.objects(role="driver").count()
        active_drivers = User.objects(role="driver", is_available=True).count()
        
        # Ride statistics
        total_rides = Ride.objects.count()
        pending_rides = Ride.objects(status="pending").count()
        active_rides = Ride.objects(status__in=["accepted", "in_progress"]).count()
        completed_rides = Ride.objects(status="completed").count()
        cancelled_rides = Ride.objects(status="cancelled").count()
        
        # Today's statistics
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        rides_today = Ride.objects(created_at__gte=today_start).count()
        completed_today = Ride.objects(
            status="completed",
            completed_at__gte=today_start
        ).count()
        
        # Calculate total revenue (completed rides)
        completed_rides_list = Ride.objects(status="completed")
        total_revenue = sum(
            ride.final_fare or ride.estimated_fare 
            for ride in completed_rides_list
        )
        
        # Average fare
        avg_fare = total_revenue / completed_rides if completed_rides > 0 else 0
        
        return {
            "success": True,
            "stats": {
                "users": {
                    "total": total_users,
                    "riders": total_riders,
                    "drivers": total_drivers,
                    "active_drivers": active_drivers
                },
                "rides": {
                    "total": total_rides,
                    "pending": pending_rides,
                    "active": active_rides,
                    "completed": completed_rides,
                    "cancelled": cancelled_rides,
                    "today": rides_today,
                    "completed_today": completed_today
                },
                "revenue": {
                    "total": round(total_revenue, 2),
                    "average_fare": round(avg_fare, 2)
                }
            }
        }
        
    except Exception as e:
        logger.error(f"Stats error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch statistics: {str(e)}"
        )

@router.put("/users/{user_id}/status")
async def update_user_status(
    user_id: str,
    is_active: bool,
    current_user: User = Depends(require_admin)
):
    """
    Activate or deactivate a user account
    Admin only
    """
    user = User.objects(id=user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    user.is_active = is_active
    user.save()
    
    logger.info(f"User {user_id} status updated to {'active' if is_active else 'inactive'}")
    
    return {
        "success": True,
        "message": f"User {'activated' if is_active else 'deactivated'} successfully",
        "user": user.to_dict()
    }

@router.delete("/rides/{ride_id}")
async def delete_ride(
    ride_id: str,
    current_user: User = Depends(require_admin)
):
    """
    Delete a ride (admin only, use with caution)
    Admin only
    """
    ride = Ride.objects(id=ride_id).first()
    if not ride:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ride not found"
        )
    
    ride.delete()
    
    logger.warning(f"Ride {ride_id} deleted by admin {current_user.email}")
    
    return {
        "success": True,
        "message": "Ride deleted successfully"
    }
