import { create } from "zustand"
import * as SecureStore from "expo-secure-store"

export const useUserStore = create((set) => ({
  user: null,
  token: null,
  currentRide: null,
  nearbyDrivers: [],

  setUser: (user) => set({ user }),
  setToken: (token) => set({ token }),
  setCurrentRide: (ride) => set({ currentRide: ride }),
  setNearbyDrivers: (drivers) => set({ nearbyDrivers: drivers }),

  logout: async () => {
    await SecureStore.deleteItemAsync("userToken")
    await SecureStore.deleteItemAsync("userData")
    set({ user: null, token: null, currentRide: null })
  },

  login: async (userData, token) => {
    await SecureStore.setItemAsync("userToken", token)
    await SecureStore.setItemAsync("userData", JSON.stringify(userData))
    set({ user: userData, token })
  },
}))
