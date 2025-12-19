"use client"

import { Platform, TouchableOpacity, View as RNView } from "react-native"
import { useEffect, useRef, useState, useMemo, forwardRef, useCallback, useImperativeHandle } from "react"
import { StyleSheet, View, Text, ActivityIndicator } from "react-native"
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps"

const isValidCoordinate = (lat, lng) => {
  const latNum = Number(lat)
  const lngNum = Number(lng)
  return (
    Number.isFinite(latNum) &&
    Number.isFinite(lngNum) &&
    latNum >= -90 &&
    latNum <= 90 &&
    lngNum >= -180 &&
    lngNum <= 180
  )
}

const filterValidCoordinates = (coords) => {
  if (!Array.isArray(coords)) return []
  return coords.filter((c) => c && isValidCoordinate(c.latitude, c.longitude))
}

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
    <Text style={markerStyles.nearbyDriverIcon}>🏍️</Text>
  </View>
)

const MapViewComponent = forwardRef(function MapViewComponent(
  { userLocation, nearbyDrivers, currentRide, routeCoordinates },
  ref,
) {
  const mapRef = useRef(null)
  const previousDriverLocation = useRef(null)
  const [driverMarkerKey, setDriverMarkerKey] = useState(0)
  const lastValidDriverLocation = useRef(null)
  const smoothedDriverLocation = useRef(null)

  const lastMapUpdate = useRef(0)
  const MAP_UPDATE_THROTTLE_MS = 500

  const [isMapReady, setIsMapReady] = useState(false)
  const [polylineKey, setPolylineKey] = useState(0)
  const previousRouteCoordinates = useRef([])

  const [isFollowingDriver, setIsFollowingDriver] = useState(true)
  const userInteractionTimeout = useRef(null)

  useImperativeHandle(
    ref,
    () => ({
      animateToRegion: (region, duration) => mapRef.current?.animateToRegion(region, duration),
      fitToCoordinates: (coords, options) => mapRef.current?.fitToCoordinates(coords, options),
      reCenterOnDriver: () => {
        setIsFollowingDriver(true)
        if (lastValidDriverLocation.current && mapRef.current) {
          const { latitude, longitude } = lastValidDriverLocation.current
          mapRef.current.animateToRegion(
            {
              latitude,
              longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.015,
            },
            500,
          )
        }
      },
      isFollowing: () => isFollowingDriver,
    }),
    [isFollowingDriver],
  )

  const hasValidUserLocation = useMemo(() => {
    return userLocation && isValidCoordinate(userLocation.latitude, userLocation.longitude)
  }, [userLocation])

  const handleMapReady = useCallback(() => {
    console.log("[MapViewComponent] Map is ready")
    setIsMapReady(true)

    if (routeCoordinates && routeCoordinates.length > 0) {
      console.log("[MapViewComponent] Map ready with existing route - forcing polyline render")
      setPolylineKey((prev) => prev + 1)
    }
  }, [routeCoordinates])

  const handlePanDrag = useCallback(() => {
    if (isFollowingDriver) {
      console.log("[MapViewComponent] User gesture detected - disabling auto-follow")
      setIsFollowingDriver(false)
    }
    // Clear any pending re-enable timeout
    if (userInteractionTimeout.current) {
      clearTimeout(userInteractionTimeout.current)
      userInteractionTimeout.current = null
    }
  }, [isFollowingDriver])

  useEffect(() => {
    if (isMapReady && routeCoordinates && routeCoordinates.length > 0) {
      console.log("[MapViewComponent] Route coordinates available, forcing polyline render")
      setPolylineKey((prev) => prev + 1)
    }
  }, [isMapReady, routeCoordinates])

  const getStableDriverLocation = useCallback(() => {
    if (!currentRide) return null
    if (currentRide.status === "pending" || currentRide.status === "completed" || currentRide.status === "cancelled")
      return null

    const loc = currentRide.driver_location
    if (!loc) return lastValidDriverLocation.current

    const lat = Number(loc.latitude)
    const lng = Number(loc.longitude)

    if (!isValidCoordinate(lat, lng) || (lat === 0 && lng === 0)) {
      return lastValidDriverLocation.current
    }

    lastValidDriverLocation.current = { latitude: lat, longitude: lng }
    return lastValidDriverLocation.current
  }, [currentRide])

  const stableDriverLocation = useMemo(() => getStableDriverLocation(), [getStableDriverLocation])

  const followDriver = useCallback(
    (driverLat, driverLng, speed = 0) => {
      if (!isFollowingDriver) return
      if (!mapRef.current || !isMapReady) return
      if (!isValidCoordinate(driverLat, driverLng)) return

      const SMOOTH_ALPHA = 0.3
      if (smoothedDriverLocation.current) {
        const smoothedLat = SMOOTH_ALPHA * driverLat + (1 - SMOOTH_ALPHA) * smoothedDriverLocation.current.latitude
        const smoothedLng = SMOOTH_ALPHA * driverLng + (1 - SMOOTH_ALPHA) * smoothedDriverLocation.current.longitude
        smoothedDriverLocation.current = { latitude: smoothedLat, longitude: smoothedLng }
      } else {
        smoothedDriverLocation.current = { latitude: driverLat, longitude: driverLng }
      }

      const { latitude, longitude } = smoothedDriverLocation.current

      let latitudeDelta = 0.008
      if (speed > 5 && speed <= 15) {
        latitudeDelta = 0.012
      } else if (speed > 15 && speed <= 30) {
        latitudeDelta = 0.018
      } else if (speed > 30) {
        latitudeDelta = 0.025
      }

      const region = {
        latitude,
        longitude,
        latitudeDelta,
        longitudeDelta: latitudeDelta * 1.5,
      }

      try {
        mapRef.current.animateToRegion(region, 500)
      } catch (e) {
        console.log("[MapViewComponent] animateToRegion error:", e.message)
      }
    },
    [isMapReady, isFollowingDriver],
  )

  useEffect(() => {
    if (!hasValidUserLocation) return
    if (!stableDriverLocation) return

    const { latitude, longitude } = stableDriverLocation
    const now = Date.now()

    if (now - lastMapUpdate.current < MAP_UPDATE_THROTTLE_MS) {
      return
    }

    const THRESHOLD = 0.0001
    const locationChanged =
      !previousDriverLocation.current ||
      Math.abs(previousDriverLocation.current.latitude - latitude) > THRESHOLD ||
      Math.abs(previousDriverLocation.current.longitude - longitude) > THRESHOLD

    if (locationChanged) {
      previousDriverLocation.current = { latitude, longitude }
      lastMapUpdate.current = now
      setDriverMarkerKey((prev) => prev + 1)

      if (isFollowingDriver) {
        const speed = currentRide?.driver_location?.speed || 0
        followDriver(latitude, longitude, speed)
      }
    }
  }, [stableDriverLocation, hasValidUserLocation, userLocation, currentRide, followDriver, isFollowingDriver])

  useEffect(() => {
    if (!currentRide || currentRide.status === "completed" || currentRide.status === "cancelled") {
      lastValidDriverLocation.current = null
      previousDriverLocation.current = null
      smoothedDriverLocation.current = null
      setIsFollowingDriver(true)
    }
  }, [currentRide])

  useEffect(() => {
    const coordsChanged = routeCoordinates?.length > 0 && previousRouteCoordinates.current !== routeCoordinates

    if (isMapReady && coordsChanged) {
      console.log("[MapViewComponent] Route coordinates changed post-ready, forcing polyline render")
      setPolylineKey((prev) => prev + 1)
    }

    previousRouteCoordinates.current = routeCoordinates
  }, [isMapReady, routeCoordinates])

  useEffect(() => {
    return () => {
      if (userInteractionTimeout.current) {
        clearTimeout(userInteractionTimeout.current)
      }
    }
  }, [])

  if (!hasValidUserLocation) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4285F4" />
        <Text style={styles.loadingText}>Getting your location...</Text>
      </View>
    )
  }

  const showNearbyDrivers =
    (!currentRide || currentRide.status === "pending") && nearbyDrivers && nearbyDrivers.length > 0

  const shouldShowDriverMarker = stableDriverLocation !== null

  const hasValidDropoff =
    currentRide?.dropoff && isValidCoordinate(currentRide.dropoff.latitude, currentRide.dropoff.longitude)

  const validRouteCoordinates = filterValidCoordinates(routeCoordinates)

  const showRecenterButton = !isFollowingDriver && shouldShowDriverMarker

  return (
    <View style={styles.mapContainer}>
      <MapView
        ref={mapRef}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
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
        onPanDrag={handlePanDrag}
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
            if (!isValidCoordinate(latitude, longitude)) {
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

        {isMapReady && validRouteCoordinates.length > 0 && (
          <Polyline
            key={`polyline-${polylineKey}`}
            coordinates={validRouteCoordinates}
            strokeColor="#2196F3"
            strokeWidth={4}
          />
        )}
      </MapView>

      {showRecenterButton && (
        <TouchableOpacity
          style={styles.recenterButton}
          onPress={() => {
            setIsFollowingDriver(true)
            if (lastValidDriverLocation.current && mapRef.current) {
              const { latitude, longitude } = lastValidDriverLocation.current
              mapRef.current.animateToRegion(
                {
                  latitude,
                  longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.015,
                },
                500,
              )
            }
          }}
        >
          <View style={styles.recenterIcon}>
            <RNView style={styles.recenterArrow} />
          </View>
        </TouchableOpacity>
      )}
    </View>
  )
})

export default MapViewComponent

const styles = StyleSheet.create({
  mapContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: "#666",
    fontSize: 16,
  },
  recenterButton: {
    position: "absolute",
    bottom: 320,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  recenterIcon: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  recenterArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 14,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#4285F4",
    transform: [{ rotate: "0deg" }],
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
    backgroundColor: "#0d3371ff",
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
    backgroundColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    borderWidth: 0,
  },
  driverIcon: {
    fontSize: 28,
  },
  destinationContainer: {
    alignItems: "center",
  },
  destinationPin: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  destinationIcon: {
    fontSize: 32,
  },
  nearbyDriverContainer: {
    width: 40,
    height: 40,
    borderRadius: 16,
    backgroundColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
    borderWidth: 0,
  },
  nearbyDriverIcon: {
    fontSize: 26,
  },
})
