import { StyleSheet } from "react-native"
import MapView, { Marker, Circle } from "react-native-maps"

export default function MapViewComponent({ mapRef, userLocation, nearbyDrivers, currentRide }) {
  if (!userLocation) return null

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      initialRegion={{
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
      }}
      showsUserLocation={true}
      showsMyLocationButton={true}
    >
      {/* User Location Circle */}
      <Circle
        center={userLocation}
        radius={500}
        strokeColor="#FF6B35"
        fillColor="rgba(255, 107, 53, 0.1)"
        strokeWidth={2}
      />

      {/* Nearby Drivers */}
      {nearbyDrivers &&
        nearbyDrivers.map((driver) => (
          <Marker
            key={driver.id}
            coordinate={{
              latitude: driver.location.coordinates[1],
              longitude: driver.location.coordinates[0],
            }}
            title={driver.name}
            description={`Rating: ${driver.rating}`}
            pinColor="#4CAF50"
          />
        ))}

      {/* Current Driver Marker */}
      {currentRide && currentRide.driver_location && (
        <Marker
          coordinate={{
            latitude: currentRide.driver_location.coordinates[1],
            longitude: currentRide.driver_location.coordinates[0],
          }}
          title="Your Driver"
          description={currentRide.driver_name}
          pinColor="#2196F3"
        />
      )}
    </MapView>
  )
}

const styles = StyleSheet.create({
  map: {
    ...StyleSheet.absoluteFillObject,
  },
})
