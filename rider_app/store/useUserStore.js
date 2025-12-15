import { create } from "zustand"
import * as SecureStore from "expo-secure-store"
import AsyncStorage from "@react-native-async-storage/async-storage"

const RIDE_PERSIST_KEY = "@eboda_current_ride"

const normalizeDriverLocation = (location) => {
  if (!location) return null

  // Handle GeoJSON format
  if (location.coordinates && Array.isArray(location.coordinates)) {
    const lat = Number(location.coordinates[1])
    const lng = Number(location.coordinates[0])
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      return { latitude: lat, longitude: lng }
    }
    return null
  }

  // Handle flat format
  const lat = Number(location.latitude)
  const lng = Number(location.longitude)
  if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
    return { latitude: lat, longitude: lng }
  }

  return null
}

const safelyMergeRide = (prevRide, newData) => {
  if (!newData) return prevRide
  if (!prevRide) return newData

  // Normalize incoming driver_location
  const newDriverLocation = normalizeDriverLocation(newData.driver_location)
  const prevDriverLocation = prevRide.driver_location

  return {
    ...prevRide,
    ...newData,
    // Preserve driver_location: use new if valid, otherwise keep previous
    driver_location: newDriverLocation || prevDriverLocation || null,
    // Preserve other critical fields unless explicitly provided with non-null values
    driver_name: newData.driver_name || prevRide.driver_name,
    vehicle_number: newData.vehicle_number || prevRide.vehicle_number,
    driver_phone: newData.driver_phone || prevRide.driver_phone,
    pickup: newData.pickup || prevRide.pickup,
    dropoff: newData.dropoff || prevRide.dropoff,
    fare: newData.fare || newData.estimated_fare || prevRide.fare,
  }
}

const persistRideState = async (ride) => {
  if (!ride) {
    await AsyncStorage.removeItem(RIDE_PERSIST_KEY)
    return
  }

  if (ride.status === "completed" || ride.status === "cancelled") {
    await AsyncStorage.removeItem(RIDE_PERSIST_KEY)
    return
  }

  try {
    const minimalRide = {
      id: ride.id || ride.ride_id,
      ride_id: ride.ride_id || ride.id,
      status: ride.status,
      driver_id: ride.driver_id,
      driver_name: ride.driver_name,
      vehicle_number: ride.vehicle_number,
      driver_location: ride.driver_location,
      pickup: ride.pickup,
      dropoff: ride.dropoff,
      fare: ride.fare,
      last_update: Date.now(),
    }
    await AsyncStorage.setItem(RIDE_PERSIST_KEY, JSON.stringify(minimalRide))
  } catch (e) {
    console.error("[Store] Failed to persist ride:", e)
  }
}

const loadPersistedRide = async () => {
  try {
    const data = await AsyncStorage.getItem(RIDE_PERSIST_KEY)
    if (!data) return null

    const ride = JSON.parse(data)

    // Check if ride is stale (more than 2 hours old) or completed/cancelled
    const isStale = Date.now() - ride.last_update > 2 * 60 * 60 * 1000
    const isTerminal = ["completed", "cancelled", "no_driver_found"].includes(ride.status)

    if (isStale || isTerminal) {
      await AsyncStorage.removeItem(RIDE_PERSIST_KEY)
      return null
    }

    // Return ride data WITHOUT setting state - caller must validate first
    return ride
  } catch (e) {
    console.error("[Store] Failed to load persisted ride:", e)
    return null
  }
}

const validatePersistedRide = async (ride, getRideApi) => {
  if (!ride || !ride.id) return null

  try {
    const response = await getRideApi(ride.id)
    const serverRide = response.data

    // If server says ride is terminal, clear it
    if (serverRide.status === "completed" || serverRide.status === "cancelled") {
      await AsyncStorage.removeItem(RIDE_PERSIST_KEY)
      return null
    }

    // Return merged ride with server state
    return {
      ...ride,
      ...serverRide,
      id: serverRide.id || serverRide._id || ride.id,
      status: serverRide.status,
    }
  } catch (error) {
    // If 404, ride doesn't exist - clear it
    if (error.response?.status === 404) {
      await AsyncStorage.removeItem(RIDE_PERSIST_KEY)
      return null
    }
    // For other errors, return cached ride but mark as unvalidated
    return { ...ride, _validated: false }
  }
}

export const useUserStore = create((set, get) => ({
  user: null,
  token: null,
  currentRide: null,
  nearbyDrivers: [],

  wsHealthy: true,
  wsError: null,

  setUser: (user) => set({ user }),
  setToken: (token) => set({ token }),

  setWsHealth: (healthy, error = null) => set({ wsHealthy: healthy, wsError: error }),

  setCurrentRide: (rideOrUpdater) => {
    const currentRide = get().currentRide

    let newRide
    if (typeof rideOrUpdater === "function") {
      newRide = rideOrUpdater(currentRide)
    } else if (rideOrUpdater === null) {
      newRide = null
    } else {
      // Direct value - use safe merge if there's an existing ride
      newRide = currentRide ? safelyMergeRide(currentRide, rideOrUpdater) : rideOrUpdater
    }

    // Normalize driver_location if present
    if (newRide && newRide.driver_location !== undefined) {
      const normalized = normalizeDriverLocation(newRide.driver_location)
      if (normalized) {
        newRide.driver_location = normalized
      } else if (currentRide?.driver_location) {
        // Keep previous valid location
        newRide.driver_location = currentRide.driver_location
      }
    }

    set({ currentRide: newRide })

    persistRideState(newRide)
  },

  setNearbyDrivers: (drivers) => set({ nearbyDrivers: drivers }),

  clearRide: () => {
    set({ currentRide: null })
    persistRideState(null)
  },

  loadPersistedRide: async () => {
    const ride = await loadPersistedRide()
    // DO NOT set state here - MapScreen must validate via GET first
    return ride
  },

  logout: async () => {
    await SecureStore.deleteItemAsync("userToken")
    await SecureStore.deleteItemAsync("userData")
    await AsyncStorage.removeItem(RIDE_PERSIST_KEY)
    set({ user: null, token: null, currentRide: null })
  },

  login: async (userData, token) => {
    await SecureStore.setItemAsync("userToken", token)
    await SecureStore.setItemAsync("userData", JSON.stringify(userData))
    set({ user: userData, token })
  },
}))
