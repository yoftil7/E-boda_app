import React from "react"
import { StyleSheet, View, Text } from "react-native"
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps"

export default function MapViewComponent({ mapRef, userLocation, nearbyDrivers, currentRide, routeCoordinates }) {
  if (!userLocation) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Loading map...</Text>
      </View>
    )
  }

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
      showsUserLocation={true}
      showsMyLocationButton={true}
      showsCompass={true}
      onMapReady={() => console.log("[v0] Map ready - Google Maps tiles should now load")}
      onMapLoaded={() => console.log("[v0] Map loaded successfully")}
      onError={(error) => console.error("[v0] Map error:", error)}
    >
      {/* User Location Marker */}
      <Marker
        coordinate={{
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
        }}
        title="Your Location"
        pinColor="#FF6B35"
      />

      {/* Nearby Drivers */}
      {nearbyDrivers && nearbyDrivers.length > 0 && nearbyDrivers.map((driver) => {
        const [longitude, latitude] = driver.location.coordinates
        console.log("[v0] Rendering driver marker:", driver.full_name, [latitude, longitude])
        return (
          <Marker
            key={driver.id}
            coordinate={{
              latitude: latitude,
              longitude: longitude,
            }}
            title={driver.full_name}
            description={`Rating: ${driver.rating} ⭐`}
            pinColor="#4CAF50"
          />
        )
      })}

      {/* Current Driver Marker (during active ride) */}
      {currentRide && currentRide.driver_location && (() => {
        const [longitude, latitude] = currentRide.driver_location.coordinates
        return (
          <Marker
            key="current-driver"
            coordinate={{
              latitude: latitude,
              longitude: longitude,
            }}
            title="Your Driver"
            description={currentRide.driver_name || "On the way"}
            pinColor="#2196F3"
          />
        )
      })()}

      {/* Route polyline if coordinates are provided */}
      {routeCoordinates && routeCoordinates.length > 0 && (
        <Polyline
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
