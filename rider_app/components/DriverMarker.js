import { View, Text, StyleSheet } from "react-native"
import { Marker } from "react-native-maps"

export default function DriverMarker({ driver, onPress }) {
  return (
    <Marker
      coordinate={{
        latitude: driver.location.coordinates[1],
        longitude: driver.location.coordinates[0],
      }}
      onPress={onPress}
    >
      <View style={styles.markerContainer}>
        <View style={styles.marker}>
          <Text style={styles.markerText}>🚕</Text>
        </View>
        <View style={styles.callout}>
          <Text style={styles.driverName}>{driver.name}</Text>
          <Text style={styles.rating}>⭐ {driver.rating.toFixed(1)}</Text>
        </View>
      </View>
    </Marker>
  )
}

const styles = StyleSheet.create({
  markerContainer: {
    alignItems: "center",
  },
  marker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#4CAF50",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  markerText: {
    fontSize: 24,
  },
  callout: {
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 4,
  },
  driverName: {
    fontSize: 12,
    fontWeight: "600",
    color: "#333",
  },
  rating: {
    fontSize: 11,
    color: "#FF6B35",
    marginTop: 2,
  },
})
