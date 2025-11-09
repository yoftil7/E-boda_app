import axios from "axios"
import * as SecureStore from "expo-secure-store"

const API_BASE_URL = process.env.API_BASE_URL || "http://10.0.2.2:8000"

console.log("[v0] API Base URL:", API_BASE_URL)

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
})

// Add token to requests
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync("userToken")
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export const authAPI = {
  login: (email, password) => api.post("/auth/login", { email, password }),
  register: (name, email, password, phone) => api.post("/auth/register", { name, email, password, phone }),
}

export const rideAPI = {
  requestRide: (pickup, dropoff) => api.post("/rides/request", { pickup, dropoff }),
  getNearbyDrivers: (latitude, longitude, radius_km = 5) =>
    api.get(`/rides/nearby-drivers`, {
      params: { latitude, longitude, radius_km },
    }),
  getRideStatus: (rideId) => api.get(`/rides/${rideId}`),
  cancelRide: (rideId) => api.post(`/rides/${rideId}/cancel`),
  completeRide: (rideId) => api.post(`/rides/${rideId}/complete`),
  rateRide: (rideId, rating, feedback) => api.post(`/rides/${rideId}/rate`, { rating, feedback }),
}

export const userAPI = {
  updateLocation: (latitude, longitude) =>
    api.put("/auth/me/location", null, {
      params: { latitude, longitude },
    }),
  getProfile: () => api.get("/auth/me"),
  updateProfile: (data) => api.put("/auth/me", data),
}

export default api
