"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Modal } from "react-native"
import * as Location from "expo-location"
import { useUserStore } from "../store/useUserStore"
import { rideAPI } from "../services/api"
import WebSocketService from "../services/websocket"
import MapViewComponent from "../components/MapViewComponent"
import RideStatusCard from "../components/RideStatusCard"
import DestinationSearch from "../components/DestinationSearch"
import Toast from "../components/Toast"
import CancelRideModal from "../components/CancelRideModal"

const ConnectionBanner = ({ wsHealthy, wsError }) => {
  if (wsHealthy) return null

  return (
    <View style={styles.connectionBanner}>
      <Text style={styles.connectionBannerText}>{wsError || "Reconnecting..."}</Text>
    </View>
  )
}

const decodePolyline = (encoded) => {
  const points = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let b
    let shift = 0
    let result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat

    shift = 0
    result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 })
  }
  return points
}

const fetchRoutePolyline = async (origin, destination) => {
  try {
    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) {
      console.log("[MapScreen] No Google Maps API key configured")
      return []
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&key=${apiKey}`

    const response = await fetch(url)
    const data = await response.json()

    if (data.routes && data.routes.length > 0) {
      const encodedPolyline = data.routes[0].overview_polyline.points
      return decodePolyline(encodedPolyline)
    }
    return []
  } catch (error) {
    console.log("[MapScreen] Failed to fetch route:", error)
    return []
  }
}

export default function MapScreen({ navigation }) {
  const mapRef = useRef(null)
  const {
    user,
    token,
    currentRide,
    setCurrentRide,
    nearbyDrivers,
    setNearbyDrivers,
    logout,
    wsHealthy,
    wsError,
    setWsHealth,
    loadPersistedRide,
    clearRide,
  } = useUserStore()

  const [location, setLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [showRideRequest, setShowRideRequest] = useState(false)
  const [pickupLocation, setPickupLocation] = useState(null)
  const [dropoffLocation, setDropoffLocation] = useState(null)
  const [routeCoordinates, setRouteCoordinates] = useState([])
  const [wsConnected, setWsConnected] = useState(false)
  const [toastMessage, setToastMessage] = useState(null)
  const [toastType, setToastType] = useState("success")
  const [showCancelModal, setShowCancelModal] = useState(false)

  const hasJoinedRideRef = useRef(false)
  const handlersRegistered = useRef(false)
  const pendingPollIntervalRef = useRef(null)
  const [pendingRetryCount, setPendingRetryCount] = useState(0)
  const isValidatingRef = useRef(false)

  const showToast = useCallback((message, type = "success") => {
    setToastMessage(message)
    setToastType(type)
  }, [])

  useEffect(() => {
    const initPersistedRide = async () => {
      console.log("[MapScreen] Waiting for startup stability...")
      await WebSocketService.waitForStartupComplete()

      await new Promise((resolve) => setTimeout(resolve, 300))

      // Check if app is still in active state
      if (!WebSocketService.isReadyForValidation()) {
        console.log("[MapScreen] App not ready for validation yet, will retry on foreground")
        return
      }

      const persistedRide = await loadPersistedRide()

      if (!persistedRide || !persistedRide.id) {
        console.log("[MapScreen] No persisted ride found - starting fresh")
        return
      }

      console.log("[MapScreen] Found persisted ride, validating BEFORE hydrating:", persistedRide.id)

      await validateAndSyncRide(persistedRide.id, "startup")
    }
    initPersistedRide()
  }, [])

  const validateAndSyncRide = useCallback(
    async (rideId, reason = "unknown", retryCount = 0) => {
      const MAX_RETRIES = 3
      const RETRY_DELAY_MS = 1000

      if (isValidatingRef.current && retryCount === 0) {
        console.log("[MapScreen] Validation already in progress, skipping")
        return null
      }

      if (retryCount === 0) {
        isValidatingRef.current = true
      }

      if (reason === "startup" && retryCount === 0) {
        if (!WebSocketService.isReadyForValidation()) {
          console.log("[MapScreen] Startup validation: waiting for app stability...")
          await WebSocketService.waitForStartupComplete()
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }

      console.log(
        `[MapScreen] Validating ride ${rideId} (reason: ${reason}, attempt: ${retryCount + 1}/${MAX_RETRIES + 1})`,
      )

      try {
        const response = await rideAPI.getRide(rideId)
        const serverRide = response.data

        if (!serverRide || serverRide.status === undefined) {
          console.log("[MapScreen] Server returned undefined ride - retrying...")

          if (reason === "startup" || reason === "foreground_resume") {
            const wsHealth = WebSocketService.getConnectionHealth()
            if (!wsHealth.isConnected) {
              console.log("[MapScreen] WS not connected during startup validation - waiting for connection...")
              // Wait for WS to connect, then retry
              await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * 2))
            }
          }

          if (retryCount < MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
            return validateAndSyncRide(rideId, reason, retryCount + 1)
          }

          if (reason === "startup") {
            console.log("[MapScreen] Startup validation failed - keeping local ride state for now")
            const persistedRide = await loadPersistedRide()
            if (persistedRide) {
              setCurrentRide(persistedRide)
              await rehydratePolylineIfNeeded(persistedRide, reason)
              try {
                await WebSocketService.joinRide(persistedRide.id)
              } catch (e) {
                console.log("[MapScreen] Failed to join ride room:", e)
              }
            }
            isValidatingRef.current = false
            return persistedRide
          }

          console.log("[MapScreen] Validation failed after retries - clearing ride state")
          clearRide()
          isValidatingRef.current = false
          return null
        }

        const TERMINAL_STATUSES = ["completed", "cancelled", "no_driver_found"]
        const ACTIVE_STATUSES = ["requested", "finding_driver", "pending", "assigned", "driver_arriving", "in_progress"]

        if (TERMINAL_STATUSES.includes(serverRide.status)) {
          console.log(`[MapScreen] Ride ${rideId} is terminal (${serverRide.status}) - clearing state`)

          if (serverRide.status === "completed") {
            navigation.navigate("RideSummary", { ride: serverRide })
          } else {
            showToast(`Ride was ${serverRide.status}`, "info")
          }
          clearRide()
          setRouteCoordinates([])
          isValidatingRef.current = false
          return null
        }

        if (ACTIVE_STATUSES.includes(serverRide.status)) {
          console.log(`[MapScreen] Ride ${rideId} is active (${serverRide.status}) - hydrating state`)
          setCurrentRide(serverRide)

          await rehydratePolylineIfNeeded(serverRide, reason)

          try {
            await WebSocketService.joinRide(rideId)
            hasJoinedRideRef.current = true
          } catch (e) {
            console.log("[MapScreen] Failed to join ride room after validation:", e)
          }
          isValidatingRef.current = false
          return serverRide
        }

        console.log(`[MapScreen] Unknown ride status: ${serverRide.status}`)

        if (retryCount < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
          return validateAndSyncRide(rideId, reason, retryCount + 1)
        }

        isValidatingRef.current = false
        return serverRide
      } catch (error) {
        console.log(`[MapScreen] Validation error for ride ${rideId}:`, error.message)

        if (error.response?.status === 404) {
          console.log("[MapScreen] Ride not found (404) - clearing state")
          clearRide()
          setRouteCoordinates([])
          isValidatingRef.current = false
          return null
        }

        if (retryCount < MAX_RETRIES) {
          console.log(`[MapScreen] Retrying validation... (${retryCount + 1}/${MAX_RETRIES})`)
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
          return validateAndSyncRide(rideId, reason, retryCount + 1)
        }

        if (reason === "startup") {
          console.log("[MapScreen] Startup validation network error - keeping local ride for now")
          const persistedRide = await loadPersistedRide()
          if (persistedRide) {
            setCurrentRide(persistedRide)
            await rehydratePolylineIfNeeded(persistedRide, reason)
            try {
              await WebSocketService.joinRide(persistedRide.id)
            } catch (e) {
              console.log("[MapScreen] Failed to join ride room:", e)
            }
          }
          isValidatingRef.current = false
          return persistedRide
        }

        isValidatingRef.current = false
        return null
      }
    },
    [clearRide, setCurrentRide, navigation],
  )

  const rehydratePolylineIfNeeded = async (ride, reason) => {
    // Only rehydrate on startup, not on foreground resume (polyline survives background)
    if (reason !== "startup") {
      return
    }

    // Only rehydrate if we don't already have route coordinates
    if (routeCoordinates && routeCoordinates.length > 0) {
      console.log("[MapScreen] Route already exists, skipping rehydration")
      return
    }

    // Only rehydrate for active ride statuses that need a route
    const ROUTE_STATUSES = ["assigned", "driver_arriving", "in_progress", "pending", "requested", "finding_driver"]
    if (!ROUTE_STATUSES.includes(ride.status)) {
      return
    }

    // Extract pickup and dropoff coordinates from ride
    const pickup = ride.pickup || ride.pickup_location
    const dropoff = ride.dropoff || ride.destination || ride.dropoff_location

    if (!pickup?.latitude || !pickup?.longitude || !dropoff?.latitude || !dropoff?.longitude) {
      console.log("[MapScreen] Cannot rehydrate polyline - missing coordinates")
      return
    }

    console.log("[MapScreen] Rehydrating route polyline after app restart...")
    try {
      const routePoints = await fetchRoutePolyline(
        { latitude: pickup.latitude, longitude: pickup.longitude },
        { latitude: dropoff.latitude, longitude: dropoff.longitude },
      )
      if (routePoints && routePoints.length > 0) {
        setRouteCoordinates(routePoints)
        console.log("[MapScreen] Route polyline rehydrated successfully")
      }
    } catch (error) {
      console.log("[MapScreen] Failed to rehydrate polyline:", error)
    }
  }

  useEffect(() => {
    initializeLocation()
  }, [])

  useEffect(() => {
    if (location && user) {
      updateLocationAndFetchDrivers()
      connectWebSocket()
    }

    return () => {
      WebSocketService.disconnect(false)
      stopPendingPolling()
    }
  }, [location, user])

  const initializeLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()

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
        currentLocation = {
          coords: {
            latitude: 0.3476,
            longitude: 32.5825,
          },
        }
      }

      setLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      })

      const address = await reverseGeocode(currentLocation.coords.latitude, currentLocation.coords.longitude)
      setPickupLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        address: address || "Current Location",
        place_name: address || "Current Location",
      })
    } catch (error) {
      setLocation({
        latitude: 0.3476,
        longitude: 32.5825,
      })
      setPickupLocation({
        latitude: 0.3476,
        longitude: 32.5825,
        address: "Current Location",
        place_name: "Current Location",
      })
    } finally {
      setLoading(false)
    }
  }

  const updateLocationAndFetchDrivers = async () => {
    if (!location?.latitude || !location?.longitude) {
      return
    }

    try {
      const latitude = location.latitude
      const longitude = location.longitude

      console.log(`[v0] Fetching nearby drivers with lat=${latitude}, lon=${longitude}`)

      const response = await rideAPI.getNearbyDrivers(latitude, longitude, 5)
      const drivers = response.data.drivers || []
      console.log(`[v0] Found ${drivers.length} nearby drivers`)
      setNearbyDrivers(drivers)
    } catch (error) {
      console.error("[v0] Failed to fetch drivers:", error.message)
      setNearbyDrivers([])
    }
  }

  const recoverRideState = useCallback(
    async (reason) => {
      console.log(`[MapScreen] Recovering state (reason: ${reason})`)

      await updateLocationAndFetchDrivers()

      const ride = useUserStore.getState().currentRide
      if (ride && ride.id) {
        await validateAndSyncRide(ride.id, reason)
      }
    },
    [validateAndSyncRide],
  )

  const startPendingPolling = useCallback(
    (rideId) => {
      stopPendingPolling()

      let attempts = 0
      const maxAttempts = 10
      const pollInterval = 5000 // 5 seconds

      pendingPollIntervalRef.current = setInterval(async () => {
        attempts++
        console.log(`[MapScreen] Polling pending ride (attempt ${attempts})`)

        try {
          const response = await rideAPI.retryAssign(rideId)

          if (response.data.driver_assigned) {
            console.log("[MapScreen] Driver assigned via polling!")
            stopPendingPolling()
          } else if (response.data.reason === "timeout" || response.data.reason === "max_attempts") {
            console.log("[MapScreen] No driver found - stopping poll")
            stopPendingPolling()
            clearRide()
            Alert.alert("No Driver Available", response.data.message || "Please try again later.")
          }
        } catch (error) {
          console.error("[MapScreen] Retry assign failed:", error.message)
        }

        if (attempts >= maxAttempts) {
          console.log("[MapScreen] Max poll attempts reached")
          stopPendingPolling()
        }
      }, pollInterval)
    },
    [clearRide],
  )

  const stopPendingPolling = useCallback(() => {
    if (pendingPollIntervalRef.current) {
      clearInterval(pendingPollIntervalRef.current)
      pendingPollIntervalRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      stopPendingPolling()
    }
  }, [stopPendingPolling])

  const connectWebSocket = () => {
    if (wsConnected || !token || handlersRegistered.current) return

    handlersRegistered.current = true

    WebSocketService.setGetCurrentRideCallback(() => useUserStore.getState().currentRide)

    WebSocketService.setOnHealthChangeCallback(({ healthy, error }) => {
      setWsHealth(healthy, error)
    })

    WebSocketService.setOnReconnectCallback(recoverRideState)

    WebSocketService.setOnTerminalRideCallback((status, errorMessage) => {
      console.log(`[MapScreen] Terminal ride detected: ${status}`)
      const ride = useUserStore.getState().currentRide

      if (status === "completed" && ride) {
        clearRide()
        WebSocketService.clearRoomState()
        stopPendingPolling()
        navigation.navigate("RideSummary", { ride })
      } else if (status === "cancelled") {
        clearRide()
        WebSocketService.clearRoomState()
        stopPendingPolling()
        Alert.alert("Ride Cancelled", "This ride was cancelled.")
      } else {
        clearRide()
        WebSocketService.clearRoomState()
        stopPendingPolling()
      }
    })

    WebSocketService.setOnConnectRoomJoinCallback(async () => {
      console.log("[MapScreen] Post-connect room join callback triggered")

      // First check current ride in store
      let ride = useUserStore.getState().currentRide

      // If no ride in store, try loading from persistence
      if (!ride || !ride.id) {
        const persistedRide = await loadPersistedRide()
        if (persistedRide && persistedRide.id) {
          console.log("[MapScreen] Found persisted ride for post-connect join:", persistedRide.id)
          ride = persistedRide
          // Hydrate the store with persisted ride
          setCurrentRide(persistedRide)
        }
      }

      if (!ride || !ride.id) {
        console.log("[MapScreen] No ride to join room for")
        return
      }

      const rideId = ride.id || ride.ride_id

      // Check if already in room
      if (WebSocketService.isJoinedToRoom(rideId)) {
        console.log("[MapScreen] Already in room for ride:", rideId)
        return
      }

      // Skip room join for pending rides (they use polling instead)
      const PENDING_STATUSES = ["pending", "finding_driver", "requested"]
      if (PENDING_STATUSES.includes(ride.status)) {
        console.log("[MapScreen] Ride is pending - starting polling instead of room join")
        startPendingPolling(rideId)
        return
      }

      // Join the ride room
      console.log("[MapScreen] Joining room for persisted ride:", rideId)
      try {
        await WebSocketService.joinRide(rideId)
        hasJoinedRideRef.current = true
        console.log("[MapScreen] Successfully joined room via post-connect callback")
      } catch (e) {
        console.log("[MapScreen] Post-connect room join failed:", e.message)
        // Retry once after short delay
        setTimeout(async () => {
          try {
            await WebSocketService.joinRide(rideId)
            hasJoinedRideRef.current = true
            console.log("[MapScreen] Post-connect room join retry succeeded")
          } catch (retryError) {
            console.log("[MapScreen] Post-connect room join retry also failed:", retryError.message)
          }
        }, 1000)
      }
    })

    WebSocketService.connect(user.id, token)
    setWsConnected(true)

    WebSocketService.on("joined_ride", (data) => {
      console.log("[MapScreen] Joined ride room confirmed:", data.ride_id)
      hasJoinedRideRef.current = true

      if (data.last_driver_location) {
        setCurrentRide((prevRide) => {
          if (!prevRide) return prevRide
          return {
            ...prevRide,
            driver_location: {
              latitude: data.last_driver_location.latitude,
              longitude: data.last_driver_location.longitude,
            },
          }
        })
      }

      if (data.ride_status) {
        setCurrentRide((prevRide) => {
          if (!prevRide) return prevRide
          return {
            ...prevRide,
            status: data.ride_status,
          }
        })
      }
    })

    WebSocketService.on("ride_accepted", (data) => {
      console.log("[MapScreen] ride_accepted received")
      stopPendingPolling()

      const driverInfo = data.driver || data || {}
      const rideId = data.ride_id || data.id

      setCurrentRide((prevRide) => {
        const currentRideId = prevRide?.id || prevRide?.ride_id

        if (!currentRideId || String(currentRideId) === String(rideId)) {
          let normalizedDriverLocation = null

          if (driverInfo.location) {
            if (driverInfo.location.coordinates && Array.isArray(driverInfo.location.coordinates)) {
              normalizedDriverLocation = {
                latitude: Number(driverInfo.location.coordinates[1]),
                longitude: Number(driverInfo.location.coordinates[0]),
              }
            } else if (driverInfo.location.latitude !== undefined && driverInfo.location.longitude !== undefined) {
              normalizedDriverLocation = {
                latitude: Number(driverInfo.location.latitude),
                longitude: Number(driverInfo.location.longitude),
              }
            }
          }

          const updatedRide = {
            ...(prevRide || {}),
            id: rideId,
            ride_id: rideId,
            status: "accepted",
            driver_id: driverInfo.id || driverInfo.driver_id,
            driver_name: driverInfo.name || driverInfo.full_name,
            vehicle_number: driverInfo.vehicle_plate || driverInfo.vehicle_model,
            driver_phone: driverInfo.phone,
            driver_location: normalizedDriverLocation || prevRide?.driver_location,
            fare: prevRide?.fare || prevRide?.estimated_fare || data.estimated_fare || 0,
            pickup: prevRide?.pickup,
            dropoff: prevRide?.dropoff,
          }

          if (rideId) {
            hasJoinedRideRef.current = false
            setTimeout(() => {
              WebSocketService.joinRide(rideId).catch((e) => console.error("Join after accept failed:", e))
            }, 500)
          }

          return updatedRide
        }

        return prevRide
      })
    })

    WebSocketService.on("ride_started", (data) => {
      if (!hasJoinedRideRef.current && !WebSocketService.isJoinedToRoom()) {
        console.log("[MapScreen] Ignoring ride_started - not yet joined room")
        return
      }

      setCurrentRide((prevRide) => ({
        ...prevRide,
        status: "in_progress",
      }))
    })

    WebSocketService.on("ride_completed", (data) => {
      console.log("[MapScreen] ride_completed received")
      stopPendingPolling()

      const currentRideState = useUserStore.getState().currentRide

      const completedRide = {
        ...(currentRideState || {}),
        status: "completed",
        distance_km: data.distance_km || data.distance || currentRideState?.distance_km,
        duration_minutes: data.duration_minutes || data.duration || currentRideState?.duration_minutes,
        final_fare: data.final_fare || data.fare || currentRideState?.fare,
        completed_at: data.completed_at || data.timestamp || new Date().toISOString(),
      }

      setRouteCoordinates([])
      clearRide()
      WebSocketService.clearRoomState()
      hasJoinedRideRef.current = false

      setTimeout(() => {
        navigation.navigate("RideSummary", { ride: completedRide })
      }, 300)
    })

    WebSocketService.on("driver_location_update", (data) => {
      if (!hasJoinedRideRef.current && !WebSocketService.isJoinedToRoom()) {
        return
      }

      if (!WebSocketService.shouldProcessLocationUpdate(data)) {
        return
      }

      const lat = Number(data.latitude)
      const lng = Number(data.longitude)

      if (isNaN(lat) || isNaN(lng)) {
        return
      }

      const newDriverLocation = {
        latitude: lat,
        longitude: lng,
        timestamp: Date.now(),
      }

      setCurrentRide((prevRide) => {
        if (!prevRide) return prevRide
        if (prevRide.status === "completed") return prevRide

        if (data.driver_id && prevRide.driver_id && String(data.driver_id) !== String(prevRide.driver_id)) {
          return prevRide
        }

        const rideMatches =
          String(data.ride_id) === String(prevRide.ride_id) || String(data.ride_id) === String(prevRide.id)

        if (rideMatches || !data.ride_id) {
          return {
            ...prevRide,
            driver_location: newDriverLocation,
            last_location_update: newDriverLocation.timestamp,
          }
        }

        return prevRide
      })
    })

    WebSocketService.on("ride_status_update", (data) => {
      setCurrentRide((prevRide) => {
        if (!prevRide && !data.id) {
          return prevRide
        }

        if (!prevRide) {
          return data
        }

        return {
          ...prevRide,
          ...data,
          driver_location: data.driver_location || prevRide.driver_location,
          driver_name: data.driver_name || prevRide.driver_name,
          vehicle_number: data.vehicle_number || prevRide.vehicle_number,
          driver_phone: data.driver_phone || prevRide.driver_phone,
          pickup: data.pickup || prevRide.pickup,
          dropoff: data.dropoff || prevRide.dropoff,
          fare: data.fare || data.estimated_fare || prevRide.fare,
        }
      })
    })

    WebSocketService.on("driver_availability_changed", (data) => {
      console.log("[MapScreen] driver_availability_changed:", data)

      if (data.driver_id && data.is_available === false) {
        setNearbyDrivers((prevDrivers) => prevDrivers.filter((d) => d.id !== data.driver_id))
      } else {
        updateLocationAndFetchDrivers()
      }

      const currentRideState = useUserStore.getState().currentRide
      if (currentRideState && currentRideState.status === "pending" && data.is_available) {
        console.log("[MapScreen] Driver became available - triggering retry assign")
        rideAPI.retryAssign(currentRideState.id).catch(console.error)
      }
    })

    WebSocketService.on("connected", (data) => {
      console.log("WebSocket connected")
      setWsHealth(true, null)

      const localRide = useUserStore.getState().currentRide

      if (localRide && localRide.id) {
        // Server sent connected event - check if it includes active_ride info
        if (data && data.active_ride) {
          const serverRideId = data.active_ride.ride_id
          const serverStatus = data.active_ride.status

          console.log(`[MapScreen] Server active_ride: ${serverRideId} status: ${serverStatus}`)

          // Check if server ride matches local ride
          if (String(serverRideId) === String(localRide.id)) {
            // Check if server says ride is terminal
            const TERMINAL_STATUSES = ["completed", "cancelled", "no_driver_found"]
            if (TERMINAL_STATUSES.includes(serverStatus)) {
              console.log(`[MapScreen] Server reports ride is terminal (${serverStatus}) - clearing local state`)

              if (serverStatus === "completed") {
                const completedRide = { ...localRide, status: "completed" }
                clearRide()
                WebSocketService.clearRoomState()
                stopPendingPolling()
                hasJoinedRideRef.current = false
                navigation.navigate("RideSummary", { ride: completedRide })
              } else {
                clearRide()
                WebSocketService.clearRoomState()
                stopPendingPolling()
                hasJoinedRideRef.current = false
                Alert.alert(
                  serverStatus === "cancelled" ? "Ride Cancelled" : "No Driver Found",
                  serverStatus === "cancelled" ? "This ride was cancelled." : "No drivers were available.",
                )
              }
              return
            }
          }
        } else if (data && !data.active_ride) {
          // This means the ride ended while we were offline
          console.log("[MapScreen] Server reports no active ride but we have local ride - validating...")

          // Trigger validation to confirm and handle terminal state
          validateAndSyncRide(localRide.id, "connected_no_active_ride").catch(console.error)
        }
      }
    })

    WebSocketService.on("error", (error) => {
      console.error("WebSocket error:", error?.message || error)
    })

    WebSocketService.on("no_driver_found", (data) => {
      console.log("[MapScreen] no_driver_found received:", data)
      stopPendingPolling()
      clearRide()
      WebSocketService.clearRoomState()
      Alert.alert("No Driver Available", data.message || "No drivers are available right now. Please try again later.")
    })

    WebSocketService.on("ride_cancelled", (data) => {
      console.log("[MapScreen] ride_cancelled received:", data)
      stopPendingPolling()
      clearRide()
      WebSocketService.clearRoomState()
      hasJoinedRideRef.current = false

      const cancelledBy = data.cancelled_by === "driver" ? "The driver" : "You"
      Alert.alert("Ride Cancelled", `${cancelledBy} cancelled the ride.${data.reason ? ` Reason: ${data.reason}` : ""}`)
    })
  }

  const handleRequestRide = async () => {
    if (!dropoffLocation || !dropoffLocation.latitude || !dropoffLocation.longitude) {
      showToast("Please select a destination from the suggestions", "error")
      return
    }

    setRequesting(true)
    try {
      // Use reverse geocoding address if available, otherwise fallback
      const pickupPlaceName = pickupLocation?.address || pickupLocation?.place_name || "Current Location"
      const dropoffPlaceName = dropoffLocation?.place_name || dropoffLocation?.address || "Destination"

      const rideRequest = {
        pickup_address: pickupPlaceName,
        pickup_latitude: pickupLocation.latitude,
        pickup_longitude: pickupLocation.longitude,
        pickup_place_name: pickupPlaceName,
        dropoff_address: dropoffLocation.address,
        dropoff_latitude: dropoffLocation.latitude,
        dropoff_longitude: dropoffLocation.longitude,
        dropoff_place_name: dropoffPlaceName,
        rider_notes: null,
        auto_assign: true,
      }

      const response = await rideAPI.requestRide(rideRequest)

      const ride = response.data.ride || response.data
      const rideId = ride.id || ride._id || ride.ride_id

      const routePoints = await fetchRoutePolyline(
        { latitude: pickupLocation.latitude, longitude: pickupLocation.longitude },
        { latitude: dropoffLocation.latitude, longitude: dropoffLocation.longitude },
      )
      setRouteCoordinates(routePoints)

      setCurrentRide({
        ...ride,
        id: rideId,
        ride_id: rideId,
        status: ride.status || "pending",
        driver_name: ride.driver?.name || ride.driver?.full_name || null,
        vehicle_number: ride.driver?.vehicle_plate || ride.driver?.vehicle_model || null,
        driver_phone: ride.driver?.phone || null,
        fare: ride.estimated_fare || ride.final_fare || 0,
        pickup: {
          latitude: pickupLocation.latitude,
          longitude: pickupLocation.longitude,
          address: pickupPlaceName,
          place_name: pickupPlaceName,
        },
        dropoff: {
          latitude: dropoffLocation.latitude,
          longitude: dropoffLocation.longitude,
          address: dropoffLocation.address,
          place_name: dropoffPlaceName,
        },
      })

      setShowRideRequest(false)

      if (response.data.driver_assigned && ride.driver) {
        if (token && rideId) {
          hasJoinedRideRef.current = false
          setTimeout(() => {
            WebSocketService.joinRide(rideId).catch((e) => console.error("Join after request failed:", e))
          }, 1000)
        }
      } else if (!response.data.driver_assigned || ride.status === "pending" || !ride.driver) {
        console.log("[MapScreen] Ride pending - starting polling for driver assignment")
        startPendingPolling(rideId)
      }

      showToast("Ride requested successfully! Finding you a driver...")
    } catch (error) {
      showToast(error.response?.data?.detail || "Failed to request ride", "error")
    } finally {
      setRequesting(false)
    }
  }

  const handleCancelRide = async (reason, reasonDetail) => {
    if (!currentRide) return

    try {
      await rideAPI.cancelRide(currentRide.id, reason, reasonDetail)
      WebSocketService.leaveRide(currentRide.id)
      WebSocketService.clearRoomState()
      hasJoinedRideRef.current = false
      stopPendingPolling()
      setRouteCoordinates([])
      clearRide()
      showToast("Ride cancelled successfully")
    } catch (error) {
      showToast("Failed to cancel ride", "error")
      throw error
    }
  }

  const reverseGeocode = async (latitude, longitude) => {
    try {
      const results = await Location.reverseGeocodeAsync({ latitude, longitude })
      if (results && results.length > 0) {
        const addr = results[0]
        // Build a readable address string
        const parts = []
        if (addr.name) parts.push(addr.name)
        if (addr.street) parts.push(addr.street)
        if (addr.city) parts.push(addr.city)
        if (addr.region) parts.push(addr.region)
        return parts.length > 0 ? parts.join(", ") : null
      }
      return null
    } catch (error) {
      console.log("[MapScreen] Reverse geocode failed:", error)
      return null
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#000" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <ConnectionBanner wsHealthy={wsHealthy} wsError={wsError} />

      {toastMessage && (
        <Toast message={toastMessage} type={toastType} duration={2000} onDismiss={() => setToastMessage(null)} />
      )}

      <MapViewComponent
        mapRef={mapRef}
        userLocation={location}
        nearbyDrivers={nearbyDrivers}
        currentRide={currentRide}
        routeCoordinates={routeCoordinates}
      />

      {currentRide ? (
        <RideStatusCard ride={currentRide} onCancel={() => setShowCancelModal(true)} />
      ) : (
        <View style={styles.requestButton}>
          <TouchableOpacity style={styles.buttonPrimary} onPress={() => setShowRideRequest(true)}>
            <Text style={styles.buttonText}>Where to?</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.profileButton} onPress={logout}>
        <Text style={styles.profileButtonText}>Logout</Text>
      </TouchableOpacity>

      <CancelRideModal
        visible={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancelRide}
        isInProgress={currentRide?.status === "in_progress"}
        chargeInfo={null}
      />

      <Modal visible={showRideRequest} animationType="slide" transparent={true}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Request a Ride</Text>

            <DestinationSearch
              onPlaceSelected={(dest) => {
                setDropoffLocation(dest)
              }}
              placeholder="Where to?"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowRideRequest(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, requesting && styles.disabledButton]}
                onPress={handleRequestRide}
                disabled={requesting}
              >
                {requesting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmButtonText}>Confirm Ride</Text>
                )}
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
  },
  connectionBanner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "#ff9800",
    padding: 8,
    zIndex: 1000,
    alignItems: "center",
  },
  connectionBannerText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  requestButton: {
    position: "absolute",
    bottom: 30,
    left: 20,
    right: 20,
  },
  buttonPrimary: {
    backgroundColor: "#000",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  profileButton: {
    position: "absolute",
    top: 50,
    right: 20,
    backgroundColor: "#fff",
    padding: 10,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  profileButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  modalContainer: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "80%",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  modalButtons: {
    flexDirection: "row",
    marginTop: 20,
    gap: 10,
  },
  modalButton: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: "#f5f5f5",
  },
  cancelButtonText: {
    color: "#333",
    fontWeight: "600",
  },
  confirmButton: {
    backgroundColor: "#000",
  },
  confirmButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  disabledButton: {
    opacity: 0.6,
  },
})
