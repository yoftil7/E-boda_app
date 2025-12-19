"use client"

import { useState } from "react"
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native"
import { useUserStore } from "../store/useUserStore"
import { rideAPI } from "../services/api"
import Toast from "../components/Toast"

export default function RideSummaryScreen({ route, navigation }) {
  const { ride } = route.params
  const [rating, setRating] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const { clearRide } = useUserStore()
  const [toastMessage, setToastMessage] = useState(null)
  const [toastType, setToastType] = useState("success")

  const handleSubmitRating = async () => {
    if (rating === 0) {
      setToastMessage("Please select a rating")
      setToastType("error")
      return
    }

    setSubmitting(true)
    try {
      await rideAPI.rateRide(ride.id, rating, "")
      console.log("[v0-complete] Rating submitted successfully")
      setToastMessage("Thank you for your rating!")
      setToastType("success")
      setTimeout(handleRequestAnother, 1500)
    } catch (error) {
      console.error("[v0-complete] Failed to submit rating:", error)
      setToastMessage("Failed to submit rating, but you can still continue")
      setToastType("error")
      setTimeout(handleRequestAnother, 1500)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRequestAnother = () => {
    console.log("[v0-complete] Clearing state and returning to home")
    clearRide()
    navigation.navigate("Map")
  }

  const handleSkip = () => {
    handleRequestAnother()
  }

  const distanceKm = ride.distance_km || (ride.distance ? ride.distance / 1000 : 0)

  let durationMin = ride.duration_minutes || 0
  if (!durationMin && ride.started_at && ride.completed_at) {
    try {
      const started = new Date(ride.started_at)
      const completed = new Date(ride.completed_at)
      // Validate dates are valid and completed is after started
      if (!isNaN(started.getTime()) && !isNaN(completed.getTime()) && completed > started) {
        durationMin = Math.max(1, Math.round((completed - started) / 60000))
      }
    } catch (e) {
      console.log("[RideSummary] Error parsing timestamps:", e)
    }
  }
  // Fallback to legacy duration field
  if (!durationMin && ride.duration) {
    durationMin = Math.floor(ride.duration / 60)
  }
  // Final fallback: if still 0 and ride was in_progress at some point, show at least 1 min
  if (!durationMin && (ride.started_at || ride.status === "completed")) {
    durationMin = 1
  }

  const finalFare = ride.final_fare || ride.fare || ride.estimated_fare || 0

  const pickupAddress =
    ride.pickup?.place_name ||
    ride.pickup?.address ||
    ride.pickup_place_name ||
    ride.pickup_address ||
    "Pickup Location"
  const dropoffAddress =
    ride.dropoff?.place_name ||
    ride.dropoff?.address ||
    ride.dropoff_place_name ||
    ride.dropoff_address ||
    "Dropoff Location"

  return (
    <View style={styles.container}>
      {toastMessage && (
        <Toast message={toastMessage} type={toastType} duration={2000} onDismiss={() => setToastMessage(null)} />
      )}

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Ride Completed</Text>
        <Text style={styles.subtitle}>You have arrived at your destination</Text>

        <View style={styles.fareCard}>
          <Text style={styles.fareLabel}>Total Fare</Text>
          <Text style={styles.fareAmount}>ETB {finalFare.toFixed(2)}</Text>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.label}>Distance</Text>
            <Text style={styles.value}>{distanceKm.toFixed(1)} km</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.label}>Duration</Text>
            <Text style={styles.value}>{durationMin} min</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.label}>Driver</Text>
            <Text style={styles.value}>{ride.driver_name || "Unknown"}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.label}>Vehicle</Text>
            <Text style={styles.value}>{ride.vehicle_number || "N/A"}</Text>
          </View>
        </View>

        <View style={styles.routeCard}>
          <View style={styles.routeItem}>
            <View style={styles.routeDot} />
            <Text style={styles.routeText} numberOfLines={2}>
              {pickupAddress}
            </Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeItem}>
            <View style={[styles.routeDot, styles.routeDotEnd]} />
            <Text style={styles.routeText} numberOfLines={2}>
              {dropoffAddress}
            </Text>
          </View>
        </View>

        <Text style={styles.ratingTitle}>How was your ride?</Text>

        <View style={styles.ratingContainer}>
          {[1, 2, 3, 4, 5].map((star) => (
            <TouchableOpacity key={star} onPress={() => setRating(star)} style={styles.starButton}>
              <Text style={[styles.star, rating >= star && styles.starActive]}>★</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
            <Text style={styles.skipButtonText}>Skip</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.buttonDisabled]}
            onPress={handleSubmitRating}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Submit Rating</Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.requestAnotherButton} onPress={handleRequestAnother}>
          <Text style={styles.requestAnotherText}>Request Another Ride</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: "#000",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 32,
    textAlign: "center",
  },
  fareCard: {
    backgroundColor: "#000",
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    alignItems: "center",
  },
  fareLabel: {
    color: "#999",
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 8,
  },
  fareAmount: {
    color: "#fff",
    fontSize: 48,
    fontWeight: "700",
  },
  summaryCard: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  label: {
    color: "#666",
    fontSize: 15,
    fontWeight: "500",
  },
  value: {
    color: "#000",
    fontSize: 16,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: "#e0e0e0",
  },
  routeCard: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: 20,
    marginBottom: 32,
  },
  routeItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  routeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#000",
    marginRight: 12,
  },
  routeDotEnd: {
    backgroundColor: "#FF6B35",
  },
  routeLine: {
    width: 2,
    height: 24,
    backgroundColor: "#ccc",
    marginLeft: 5,
    marginVertical: 4,
  },
  routeText: {
    flex: 1,
    color: "#000",
    fontSize: 14,
    fontWeight: "500",
  },
  ratingTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#000",
    marginBottom: 16,
    textAlign: "center",
  },
  ratingContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 24,
  },
  starButton: {
    padding: 8,
  },
  star: {
    fontSize: 36,
    color: "#e0e0e0",
  },
  starActive: {
    color: "#FFD700",
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  skipButton: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  skipButtonText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
  },
  submitButton: {
    flex: 1,
    backgroundColor: "#000",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  requestAnotherButton: {
    backgroundColor: "#FF6B35",
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    marginTop: 8,
  },
  requestAnotherText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
})
