"use client"

import { useEffect, useRef } from "react"
import { Text, StyleSheet, Animated, Dimensions, Platform } from "react-native"

const { width } = Dimensions.get("window")

export default function Toast({ message, type = "success", duration = 2000, onDismiss }) {
  const opacity = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(-100)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start()

    const hideTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -100,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        if (onDismiss) onDismiss()
      })
    }, duration)

    return () => clearTimeout(hideTimer)
  }, [duration, onDismiss, opacity, translateY])

  const backgroundColor = type === "success" ? "#4CAF50" : type === "error" ? "#F44336" : "#FF9800"

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity,
          backgroundColor,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents="box-none"
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 50,
    left: (width - width * 0.9) / 2,
    width: width * 0.9,
    padding: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 15,
    zIndex: 999999,
  },
  text: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
})
