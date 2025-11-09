"""
E-Boda Backend - FastAPI Entry Point
Main application file with CORS, middleware, and route registration
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
import logging_config
import time
from database import connect_db, disconnect_db
from routes import auth_routes, ride_routes, admin_routes
from sockets import ride_socket

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="E-Boda API",
    description="Backend API for E-Boda ride-hailing platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS Configuration - Allow future frontend apps
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update with specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming requests with timing"""
    start_time = time.time()

    # Log request
    logger.info(f"Request: {request.method} {request.url.path}")

    # Process request
    response = await call_next(request)

    # Calculate processing time
    process_time = time.time() - start_time
    logger.info(f"Completed in {process_time:.2f}s - Status: {response.status_code}")

    return response


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle all unhandled exceptions"""
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "message": "Internal server error",
            "error": str(exc),
        },
    )


# Database connection events
@app.on_event("startup")
async def startup_event():
    """Connect to MongoDB on startup"""
    logger.info("Starting E-Boda API...")
    connect_db()
    logger.info("Database connected successfully")


@app.on_event("shutdown")
async def shutdown_event():
    """Disconnect from MongoDB on shutdown"""
    logger.info("Shutting down E-Boda API...")
    disconnect_db()
    logger.info("Database disconnected")


# Health check endpoint
@app.get("/")
async def root():
    """API health check"""
    return {"success": True, "message": "E-Boda API is running", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {"success": True, "status": "healthy", "database": "connected"}


# Register route modules
app.include_router(auth_routes.router, prefix="/auth", tags=["Authentication"])
app.include_router(ride_routes.router, prefix="/rides", tags=["Rides"])
app.include_router(admin_routes.router, prefix="/admin", tags=["Admin"])

# Register WebSocket routes
app.include_router(ride_socket.router, prefix="/ws", tags=["WebSocket"])

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
