"use client"

import { useState } from "react"
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ActivityIndicator, ScrollView } from "react-native"

const CANCEL_REASONS = [
  "Driver is far away",
  "Accidental request",
  "Changed my mind",
  "Found alternative transport",
  "Other",
]

export default function CancelRideModal({ visible, onClose, onConfirm, isInProgress = false, chargeInfo = null }) {
  const [selectedReason, setSelectedReason] = useState("")
  const [reasonDetail, setReasonDetail] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const handleConfirm = async () => {
    if (!selectedReason) return

    setSubmitting(true)
    try {
      await onConfirm(selectedReason, selectedReason === "Other" ? reasonDetail : "")
      handleClose()
    } catch (error) {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    setSelectedReason("")
    setReasonDetail("")
    setSubmitting(false)
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>Cancel Ride</Text>

            {isInProgress && chargeInfo?.charge_applicable && (
              <View style={styles.warningBox}>
                <Text style={styles.warningTitle}>⚠️ Cancellation Fee</Text>
                <Text style={styles.warningText}>
                  A cancellation fee of ETB {chargeInfo.charge_amount} will be charged to your account.
                </Text>
              </View>
            )}

            <Text style={styles.subtitle}>Please select a reason:</Text>

            {CANCEL_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason}
                style={[styles.reasonButton, selectedReason === reason && styles.reasonButtonSelected]}
                onPress={() => setSelectedReason(reason)}
              >
                <View style={[styles.radio, selectedReason === reason && styles.radioSelected]} />
                <Text style={[styles.reasonText, selectedReason === reason && styles.reasonTextSelected]}>
                  {reason}
                </Text>
              </TouchableOpacity>
            ))}

            {selectedReason === "Other" && (
              <TextInput
                style={styles.input}
                placeholder="Please specify..."
                placeholderTextColor="#999"
                value={reasonDetail}
                onChangeText={setReasonDetail}
                multiline
                numberOfLines={3}
              />
            )}

            <View style={styles.buttonContainer}>
              <TouchableOpacity style={styles.cancelButton} onPress={handleClose} disabled={submitting}>
                <Text style={styles.cancelButtonText}>Go Back</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmButton, (!selectedReason || submitting) && styles.buttonDisabled]}
                onPress={handleConfirm}
                disabled={!selectedReason || submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmButtonText}>Confirm Cancel</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
  },
  content: {
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#000",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 16,
  },
  warningBox: {
    backgroundColor: "#FFF3E0",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#FF9800",
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#E65100",
    marginBottom: 8,
  },
  warningText: {
    fontSize: 14,
    color: "#E65100",
    lineHeight: 20,
  },
  reasonButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    marginBottom: 12,
  },
  reasonButtonSelected: {
    backgroundColor: "#000",
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#999",
    marginRight: 12,
  },
  radioSelected: {
    borderColor: "#fff",
    backgroundColor: "#FF6B35",
  },
  reasonText: {
    fontSize: 16,
    color: "#000",
    fontWeight: "500",
  },
  reasonTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  input: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: "#000",
    textAlignVertical: "top",
    marginTop: 8,
    marginBottom: 16,
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
  },
  confirmButton: {
    flex: 1,
    backgroundColor: "#F44336",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  confirmButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
})
