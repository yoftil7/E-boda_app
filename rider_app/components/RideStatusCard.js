import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native"

export default function RideStatusCard({ ride, onCancel }) {
  const getStatusDisplay = () => {
    switch (ride.status) {
      case "pending":
        return { text: "Finding Driver...", color: "#FF9800" }
      case "accepted":
        return { text: "Driver Arriving", color: "#2196F3" }
      case "in_progress":
        return { text: "Ride in Progress", color: "#4CAF50" }
      case "completed":
        return { text: "Ride Completed", color: "#8BC34A" }
      default:
        return { text: ride.status, color: "#999" }
    }
  }

  const status = getStatusDisplay()

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.statusIndicator}>
          <ActivityIndicator color={status.color} />
        </View>
        <Text style={styles.statusText}>{status.text}</Text>
      </View>

      <View style={styles.divider} />

      {ride.status !== "pending" && (
        <>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Driver</Text>
            <Text style={styles.value}>{ride.driver_name}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Vehicle</Text>
            <Text style={styles.value}>{ride.vehicle_number}</Text>
          </View>

          <View style={styles.divider} />
        </>
      )}

      <View style={styles.infoRow}>
        <Text style={styles.label}>Estimated Fare</Text>
        <Text style={styles.fare}>ETB {(ride.fare || 0).toFixed(2)}</Text>
      </View>

      {ride.status === "pending" && (
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel Ride</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    bottom: 20,
    left: 16,
    right: 16,
    backgroundColor: "#2a2a2a",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#333",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  statusIndicator: {
    marginRight: 12,
  },
  statusText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: "#333",
    marginVertical: 12,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  label: {
    color: "#999",
    fontSize: 12,
    fontWeight: "500",
  },
  value: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  fare: {
    color: "#FF6B35",
    fontSize: 16,
    fontWeight: "700",
  },
  cancelButton: {
    backgroundColor: "#FF6B35",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 12,
  },
  cancelText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
})
