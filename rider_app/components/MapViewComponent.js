"use client"

import { useEffect, useRef, useState, useMemo } from "react"
import { StyleSheet, View, Text } from "react-native"
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps"

const RiderMarker = () => (
  <View style={markerStyles.riderContainer}>
    <View style={markerStyles.riderDot} />
    <View style={markerStyles.riderPulse} />
  </View>
)

const DriverMarker = () => (
  <View style={markerStyles.driverContainer}>
    <Text style={markerStyles.driverIcon}>🏍️</Text>
  </View>
)

const DestinationMarker = () => (
  <View style={markerStyles.destinationContainer}>
    <View style={markerStyles.destinationPin}>
      <Text style={markerStyles.destinationIcon}>📍</Text>
    </View>
  </View>
)

const NearbyDriverMarker = () => (
  <View style={markerStyles.nearbyDriverContainer}>
    <Text style={markerStyles.nearbyDriverIcon}>🛵</Text>
  </View>
)

export default function MapViewComponent({ mapRef, userLocation, nearbyDrivers, currentRide, routeCoordinates }) {
  const previousDriverLocation = useRef(null)
  const [driverMarkerKey, setDriverMarkerKey] = useState(0)
  const lastValidDriverLocation = useRef(null)

  const lastMapUpdate = useRef(0)
  const MAP_UPDATE_THROTTLE_MS = 500

  const [isMapReady, setIsMapReady] = useState(false)
  const [polylineKey, setPolylineKey] = useState(0)

  const handleMapReady = () => {
    console.log("[MapViewComponent] Map is ready")
    setIsMapReady(true)
  }

  useEffect(() => {
    if (isMapReady && routeCoordinates && routeCoordinates.length > 0) {
      console.log("[MapViewComponent] Route coordinates available, forcing polyline render")
      setPolylineKey((prev) => prev + 1)
    }
  }, [isMapReady, routeCoordinates])

  const getStableDriverLocation = () => {
    if (!currentRide) return null
    if (currentRide.status === "pending" || currentRide.status === "completed" || currentRide.status === "cancelled")
      return null

    const loc = currentRide.driver_location
    if (!loc) return lastValidDriverLocation.current

    const lat = Number(loc.latitude)
    const lng = Number(loc.longitude)

    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
      return lastValidDriverLocation.current
    }

    // Update last valid location
    lastValidDriverLocation.current = { latitude: lat, longitude: lng }
    return lastValidDriverLocation.current
  }

  const stableDriverLocation = useMemo(
    () => getStableDriverLocation(),
    [currentRide?.driver_location?.latitude, currentRide?.driver_location?.longitude, currentRide?.status],
  )

  useEffect(() => {
    if (!stableDriverLocation) return

    const { latitude, longitude } = stableDriverLocation
    const now = Date.now()

    if (now - lastMapUpdate.current < MAP_UPDATE_THROTTLE_MS) {
      return
    }

    // Check if location changed significantly (more than ~10 meters)
    const THRESHOLD = 0.0001
    const locationChanged =
      !previousDriverLocation.current ||
      Math.abs(previousDriverLocation.current.latitude - latitude) > THRESHOLD ||
      Math.abs(previousDriverLocation.current.longitude - longitude) > THRESHOLD

    if (locationChanged) {
      previousDriverLocation.current = { latitude, longitude }
      lastMapUpdate.current = now
      setDriverMarkerKey((prev) => prev + 1)

      // Fit map to show both rider and driver
      if (mapRef.current && userLocation) {
        try {
          mapRef.current.fitToCoordinates(
            [
              { latitude: userLocation.latitude, longitude: userLocation.longitude },
              { latitude, longitude },
            ],
            {
              edgePadding: { top: 100, right: 50, bottom: 300, left: 50 },
              animated: true,
            },
          )
        } catch (e) {
          // Silently handle fitToCoordinates errors
        }
      }
    }
  }, [stableDriverLocation, userLocation, mapRef, currentRide])

  useEffect(() => {
    if (!currentRide || currentRide.status === "completed" || currentRide.status === "cancelled") {
      lastValidDriverLocation.current = null
      previousDriverLocation.current = null
    }
  }, [currentRide])

  if (
    !userLocation ||
    typeof userLocation.latitude !== "number" ||
    typeof userLocation.longitude !== "number" ||
    isNaN(userLocation.latitude) ||
    isNaN(userLocation.longitude)
  ) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Loading map...</Text>
      </View>
    )
  }

  const showNearbyDrivers =
    (!currentRide || currentRide.status === "pending") && nearbyDrivers && nearbyDrivers.length > 0

  const shouldShowDriverMarker = stableDriverLocation !== null

  const hasValidPickup =
    currentRide?.pickup &&
    typeof currentRide.pickup.latitude === "number" &&
    typeof currentRide.pickup.longitude === "number" &&
    !isNaN(currentRide.pickup.latitude) &&
    !isNaN(currentRide.pickup.longitude)

  const hasValidDropoff =
    currentRide?.dropoff &&
    typeof currentRide.dropoff.latitude === "number" &&
    typeof currentRide.dropoff.longitude === "number" &&
    !isNaN(currentRide.dropoff.latitude) &&
    !isNaN(currentRide.dropoff.longitude)

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      style={styles.map}
      initialRegion={{
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }}
      showsUserLocation={false}
      showsMyLocationButton={true}
      showsCompass={true}
      onMapReady={handleMapReady}
    >
      <Marker
        coordinate={{
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
        }}
        title="Your Location"
        anchor={{ x: 0.5, y: 0.5 }}
      >
        <RiderMarker />
      </Marker>

      {showNearbyDrivers &&
        nearbyDrivers.map((driver) => {
          if (!driver.location?.coordinates || driver.location.coordinates.length < 2) {
            return null
          }
          const [longitude, latitude] = driver.location.coordinates
          if (typeof latitude !== "number" || typeof longitude !== "number" || isNaN(latitude) || isNaN(longitude)) {
            return null
          }
          return (
            <Marker
              key={`nearby-driver-${driver.id}`}
              coordinate={{
                latitude: latitude,
                longitude: longitude,
              }}
              title={driver.full_name}
              description={`Rating: ${driver.rating} ⭐`}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <NearbyDriverMarker />
            </Marker>
          )
        })}

      {shouldShowDriverMarker && (
        <Marker
          key={`driver-${currentRide?.driver_id}-${driverMarkerKey}`}
          coordinate={{
            latitude: stableDriverLocation.latitude,
            longitude: stableDriverLocation.longitude,
          }}
          title={currentRide?.driver_name || "Your Driver"}
          description="On the way"
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <DriverMarker />
        </Marker>
      )}

      {hasValidDropoff && (
        <Marker
          coordinate={{
            latitude: currentRide.dropoff.latitude,
            longitude: currentRide.dropoff.longitude,
          }}
          title="Destination"
          description={currentRide.dropoff.address}
          anchor={{ x: 0.5, y: 1 }}
        >
          <DestinationMarker />
        </Marker>
      )}

      {isMapReady && routeCoordinates && routeCoordinates.length > 0 && (
        <Polyline
          key={`polyline-${polylineKey}`}
          coordinates={routeCoordinates}
          strokeColor="#2196F3"
          strokeWidth={4}
        />
      )}
    </MapView>
  )
}

const styles = StyleSheet.create({
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  errorContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1a1a1a",
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    color: "#fff",
    fontSize: 16,
  },
})

const markerStyles = StyleSheet.create({
  riderContainer: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  riderDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#4285F4",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  riderPulse: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(66, 133, 244, 0.3)",
  },
  driverContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    borderWidth: 2,
    borderColor: "#4CAF50",
  },
  driverIcon: {
    fontSize: 22,
  },
  destinationContainer: {
    alignItems: "center",
  },
  destinationPin: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  destinationIcon: {
    fontSize: 32,
  },
  nearbyDriverContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  nearbyDriverIcon: {
    fontSize: 18,
  },
})
