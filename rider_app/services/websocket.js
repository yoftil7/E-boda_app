class WebSocketService {
  constructor() {
    this.ws = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 3000
    this.handlers = {}
    this.userId = null
    this.rideId = null
    this.token = null // Store token properly for reconnection
  }

  connect(userId, token, rideId = null) {
    const WS_BASE_URL = process.env.EXPO_PUBLIC_WS_BASE_URL || "ws://10.0.2.2:8000/ws/ride"
    const url = `${WS_BASE_URL}?token=${token}`

    this.userId = userId
    this.rideId = rideId
    this.token = token // Store token properly for reconnection

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        console.log("[WebSocket] Connected")
        this.reconnectAttempts = 0

        if (rideId) {
          this.joinRide(rideId)
        }

        this.emit("connected")
      }

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data)
        console.log("[WebSocket] Message received:", message)

        const { event: eventType, data } = message
        if (this.handlers[eventType]) {
          this.handlers[eventType].forEach((handler) => handler(data))
        }
      }

      this.ws.onerror = (error) => {
        console.error("[WebSocket] Error:", error)
        this.emit("error", error)
      }

      this.ws.onclose = () => {
        console.log("[WebSocket] Disconnected")
        this.attemptReconnect()
      }
    } catch (error) {
      console.error("[WebSocket] Connection failed:", error)
      this.attemptReconnect()
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      console.log(`[WebSocket] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
      setTimeout(() => {
        this.connect(this.userId, this.token, this.rideId)
      }, this.reconnectDelay)
    }
  }

  joinRide(rideId) {
    this.send("join_ride", { ride_id: rideId })
  }

  on(event, handler) {
    if (!this.handlers[event]) {
      this.handlers[event] = []
    }
    this.handlers[event].push(handler)
  }

  off(event, handler) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter((h) => h !== handler)
    }
  }

  send(event, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }))
    }
  }

  emit(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach((handler) => handler(data))
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

export default new WebSocketService()
