"use client"

import React, { useEffect } from "react"
import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { useUserStore } from "./store/useUserStore"
import LoginScreen from "./screens/LoginScreen"
import RegisterScreen from "./screens/RegisterScreen"
import MapScreen from "./screens/MapScreen"
import RideSummaryScreen from "./screens/RideSummaryScreen"
import * as SecureStore from "expo-secure-store"

const Stack = createNativeStackNavigator()

export default function App() {
  const { user, setUser, setToken } = useUserStore()
  const [isLoading, setIsLoading] = React.useState(true)

  useEffect(() => {
    bootstrapAsync()
  }, [])

  const bootstrapAsync = async () => {
    try {
      const token = await SecureStore.getItemAsync("userToken")
      if (token) {
        setToken(token)
        // Validate token by fetching user data
        const userStr = await SecureStore.getItemAsync("userData")
        if (userStr) {
          setUser(JSON.parse(userStr))
        }
      }
    } catch (e) {
      console.error("Failed to restore token", e)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return null
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animationEnabled: true,
        }}
      >
        {user && user.id ? (
          <>
            <Stack.Screen name="Map" component={MapScreen} />
            <Stack.Screen name="RideSummary" component={RideSummaryScreen} options={{ presentation: "modal" }} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ animationEnabled: false }} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}
