"""
MongoDB Database Connection using MongoEngine
Handles connection and disconnection to MongoDB
"""
import os
from mongoengine import connect, disconnect
from dotenv import load_dotenv
import logging

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

def connect_db():
    """
    Connect to MongoDB using MongoEngine
    Uses MONGO_URI from environment variables
    """
    try:
        mongo_uri = os.getenv("MONGO_URI", "mongodb+srv://eboda_db_user:Ebodadevyoftil7@cluster0.1pjdndp.mongodb.net/eboda?retryWrites=true&w=majority")
        
        connect(
            host=mongo_uri,
            alias='default'
        )
        
        logger.info(f"Connected to MongoDB successfully")
        
    except Exception as e:
        logger.error(f"Failed to connect to MongoDB: {str(e)}")
        raise

def disconnect_db():
    """Disconnect from MongoDB"""
    try:
        disconnect(alias='default')
        logger.info("Disconnected from MongoDB")
    except Exception as e:
        logger.error(f"Error disconnecting from MongoDB: {str(e)}")
