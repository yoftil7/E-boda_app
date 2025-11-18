"use client"

import { useEffect, useState, useRef } from "react"
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Modal } from "react-native"
import * as Location from "expo-location"
import { useUserStore } from "../store/useUserStore"
import { rideAPI } from "../services/api"
import WebSocketService from "../services/websocket"
import MapViewComponent from "../components/MapViewComponent"
import RideStatusCard from "../components/RideStatusCard"
import DestinationSearch from "../components/DestinationSearch"

export default function MapScreen({ navigation }) {
  const mapRef = useRef(null)
  const { user, token, currentRide, setCurrentRide, nearbyDrivers, setNearbyDrivers, logout } = useUserStore()

  const [location, setLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [showRideRequest, setShowRideRequest] = useState(false)
  const [pickupLocation, setPickupLocation] = useState(null)
  const [dropoffLocation, setDropoffLocation] = useState(null)
  const [routeCoordinates, setRouteCoordinates] = useState([])
  const [wsConnected, setWsConnected] = useState(false)

  useEffect(() => {
    initializeLocation()
  }, [])

  useEffect(() => {
    if (location && user) {
      updateLocationAndFetchDrivers()
      connectWebSocket()
    }

    return () => {
      WebSocketService.disconnect()
    }
  }, [location, user])

  const initializeLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      console.log("[v0] Location permission status:", status)

      if (status !== "granted") {
        Alert.alert("Error", "Location permission is required to use E-Boda")
        setLoading(false)
        return
      }

      let currentLocation
      try {
        currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,
          distanceInterval: 10,
        })
      } catch (locationError) {
        console.log("[v0] Using mock location for development (emulator)")
        currentLocation = {
          coords: {
            latitude: 0.3476,
            longitude: 32.5825,
          },
        }
      }

      console.log("[v0] Current location obtained:", currentLocation.coords)

      setLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      })
      setPickupLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      })
    } catch (error) {
      console.error("[v0] Location error details:", error.message, error.code)
      setLocation({
        latitude: 0.3476,
        longitude: 32.5825,
      })
      setPickupLocation({
        latitude: 0.3476,
        longitude: 32.5825,
      })
    } finally {
      setLoading(false)
    }
  }

  const updateLocationAndFetchDrivers = async () => {
    try {
      console.log("[v0] Fetching drivers with location:", location)
      const response = await rideAPI.getNearbyDrivers(location.latitude, location.longitude, 5)
      console.log("[v0] Drivers fetched successfully:", response.data)
      setNearbyDrivers(response.data.drivers || [])
    } catch (error) {
      console.error("[v0] Failed to fetch drivers:", error.message)
      console.error("[v0] Error response:", error.response?.data)
    }
  }

  const connectWebSocket = () => {
    if (!wsConnected && token) {
      WebSocketService.connect(user.id, token)
      setWsConnected(true)

      WebSocketService.on("driver_location_update", (data) => {
        if (currentRide && data.driver_id === currentRide.driver_id) {
          setCurrentRide({
            ...currentRide,
            driver_location: data.location,
          })
        }
      })

      WebSocketService.on("ride_status_update", (data) => {
        setCurrentRide(data)
      })

      WebSocketService.on("connected", () => {
        console.log("WebSocket connected")
      })
    }
  }

  const handleRequestRide = async () => {
    if (!dropoffLocation || !dropoffLocation.latitude || !dropoffLocation.longitude) {
      Alert.alert("Error", "Please select a destination from the suggestions")
      return
    }

    setRequesting(true)
    try {
      const rideRequest = {
        pickup_address: "Current Location",
        pickup_latitude: pickupLocation.latitude,
        pickup_longitude: pickupLocation.longitude,
        dropoff_address: dropoffLocation.address,
        dropoff_latitude: dropoffLocation.latitude,
        dropoff_longitude: dropoffLocation.longitude,
        rider_notes: null,
        auto_assign: true,
      }

      console.log("[v0] Sending ride request:", rideRequest)
      const response = await rideAPI.requestRide(rideRequest)

      const ride = response.data.data
      setCurrentRide(ride)
      setShowRideRequest(false)

      if (token) {
        WebSocketService.joinRide(ride.id)
      }
    } catch (error) {
      console.error("[v0] Ride request error:", error.response?.data)
      Alert.alert("Error", error.response?.data?.detail || "Failed to request ride")
    } finally {
      setRequesting(false)
    }
  }

  const handleCancelRide = async () => {
    if (!currentRide) return

    try {
      await rideAPI.cancelRide(currentRide.id)
      setCurrentRide(null)
    } catch (error) {
      Alert.alert("Error", "Failed to cancel ride")
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <MapViewComponent
        mapRef={mapRef}
        userLocation={location}
        nearbyDrivers={nearbyDrivers}
        currentRide={currentRide}
        routeCoordinates={routeCoordinates}
      />

      {currentRide ? (
        <RideStatusCard ride={currentRide} onCancel={handleCancelRide} />
      ) : (
        <View style={styles.requestButton}>
          <TouchableOpacity style={styles.buttonPrimary} onPress={() => setShowRideRequest(true)}>
            <Text style={styles.buttonText}>Request a Ride</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.profileButton} onPress={logout}>
        <Text style={styles.profileButtonText}>Logout</Text>
      </TouchableOpacity>

      <Modal
        visible={showRideRequest}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowRideRequest(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Where to?</Text>

            <DestinationSearch
              placeholder="Enter destination"
              onPlaceSelected={(place) => {
                console.log("[v0] Place selected:", place)
                setDropoffLocation(place)
              }}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.buttonSecondary}
                onPress={() => {
                  setShowRideRequest(false)
                  setDropoffLocation(null)
                }}
                disabled={requesting}
              >
                <Text style={styles.buttonSecondaryText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.buttonPrimary, requesting && styles.buttonDisabled]}
                onPress={handleRequestRide}
                disabled={requesting}
              >
                {requesting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Request Ride</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a1a",
  },
  requestButton: {
    position: "absolute",
    bottom: 20,
    left: 16,
    right: 16,
  },
  buttonPrimary: {
    backgroundColor: "#FF6B35",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonSecondary: {
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    flex: 1,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#333",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonSecondaryText: {
    color: "#999",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  profileButton: {
    position: "absolute",
    top: 40,
    right: 16,
    backgroundColor: "#2a2a2a",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#333",
  },
  profileButtonText: {
    color: "#999",
    fontSize: 12,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#1a1a1a",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderTopWidth: 1,
    borderTopColor: "#333",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 20,
  },
  input: {
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#fff",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#333",
    fontSize: 16,
  },
  modalButtons: {
    flexDirection: "row",
  },
})
