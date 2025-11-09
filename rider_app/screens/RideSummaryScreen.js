"use client"

import { useState } from "react"
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from "react-native"
import { useUserStore } from "../store/useUserStore"
import { rideAPI } from "../services/api"

export default function RideSummaryScreen({ route, navigation }) {
  const { ride } = route.params
  const [rating, setRating] = useState(0)
  const [feedback, setFeedback] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const { setCurrentRide } = useUserStore()

  const handleSubmitRating = async () => {
    if (rating === 0) {
      Alert.alert("Error", "Please select a rating")
      return
    }

    setSubmitting(true)
    try {
      await rideAPI.rateRide(ride.id, rating, feedback)
      setCurrentRide(null)
      navigation.goBack()
      Alert.alert("Success", "Thank you for your feedback!")
    } catch (error) {
      Alert.alert("Error", "Failed to submit rating")
    } finally {
      setSubmitting(false)
    }
  }

  const handleSkip = () => {
    setCurrentRide(null)
    navigation.goBack()
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Ride Complete</Text>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.label}>Distance</Text>
            <Text style={styles.value}>{((ride.distance || 0) / 1000).toFixed(1)} km</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.label}>Duration</Text>
            <Text style={styles.value}>{Math.floor((ride.duration || 0) / 60)} min</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.label}>Total Amount</Text>
            <Text style={styles.amount}>ETB {(ride.fare || 0).toFixed(2)}</Text>
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

        <View style={styles.feedbackContainer}>
          <Text style={styles.feedbackLabel}>Additional feedback (optional)</Text>
          <Text style={styles.feedbackText}>Help us improve by sharing your experience</Text>
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
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Submit</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a1a",
  },
  content: {
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 24,
    textAlign: "center",
  },
  summaryCard: {
    backgroundColor: "#2a2a2a",
    borderRadius: 12,
    padding: 20,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: "#333",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  label: {
    color: "#999",
    fontSize: 14,
    fontWeight: "500",
  },
  value: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  amount: {
    color: "#FF6B35",
    fontSize: 18,
    fontWeight: "700",
  },
  divider: {
    height: 1,
    backgroundColor: "#333",
  },
  ratingTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 16,
    textAlign: "center",
  },
  ratingContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 32,
  },
  starButton: {
    padding: 8,
  },
  star: {
    fontSize: 32,
    color: "#333",
  },
  starActive: {
    color: "#FF6B35",
  },
  feedbackContainer: {
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    padding: 16,
    marginBottom: 32,
  },
  feedbackLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  feedbackText: {
    color: "#999",
    fontSize: 12,
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
  },
  skipButton: {
    flex: 1,
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#333",
  },
  skipButtonText: {
    color: "#999",
    fontSize: 16,
    fontWeight: "600",
  },
  submitButton: {
    flex: 1,
    backgroundColor: "#FF6B35",
    borderRadius: 8,
    paddingVertical: 14,
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
})
