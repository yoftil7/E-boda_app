// idempotent joins, health tracking, and state recovery support

import { AppState, Platform } from "react-native"

class WebSocketService {
  constructor() {
    // Connection state
    this.ws = null
    this.token = null
    this.userId = null
    this.rideId = null

    // Health tracking
    this.connectedAt = null
    this.lastPong = null
    this.isHealthy = false
    this.isBackgroundClosed = false

    // Reconnect with exponential backoff
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.baseReconnectDelay = 1000
    this.maxReconnectDelay = 30000
    this.reconnectTimer = null
    this.isReconnecting = false
    this.reconnectPaused = false

    // Ping/Pong keepalive
    this.pingInterval = null
    this.pingIntervalMs = 15000
    this.pongTimeoutMs = 10000
    this.pongTimer = null

    // Room management (idempotent joins)
    this.joinedRooms = new Set()
    this.pendingJoins = new Set()
    this.joinPromises = new Map()

    // Event handlers
    this.handlers = {}
    this.getCurrentRideCallback = null
    this.onHealthChangeCallback = null
    this.onReconnectCallback = null
    this.onTerminalRideCallback = null
    this.onConnectRoomJoinCallback = null

    // AppState handling
    this.appState = AppState.currentState
    this.appStateSubscription = null

    this.startupTime = Date.now()
    this.startupStabilityMs = 1500 // Wait 1.5s after app launch before treating AppState changes as real
    this.lastAppStateChange = null
    this.appStateStableMs = 500 // AppState must be stable for 500ms
    this.isStartupPhase = true

    this._setupAppStateListener()

    // Location update throttling
    this.lastLocationUpdate = null
    this.locationThrottleMs = 300
    this.lastProcessedCoords = null

    this.isDisconnecting = false

    setTimeout(() => {
      this.isStartupPhase = false
      console.log("[WebSocket] Startup phase complete")
    }, this.startupStabilityMs)
  }

  _setupAppStateListener() {
    this.appStateSubscription = AppState.addEventListener("change", (nextAppState) => {
      const prevState = this.appState
      this.appState = nextAppState
      this.lastAppStateChange = Date.now()

      console.log(`[WebSocket] AppState changed: ${prevState} -> ${nextAppState}`)

      if (this.isStartupPhase) {
        console.log("[WebSocket] Ignoring AppState change during startup phase")
        return
      }

      if (prevState.match(/inactive|background/) && nextAppState === "active") {
        // App came to foreground
        this._handleForeground()
      } else if (nextAppState.match(/inactive|background/)) {
        // App went to background
        this._handleBackground()
      }
    })
  }

  isAppStateStable() {
    if (this.isStartupPhase) return false
    if (!this.lastAppStateChange) return true
    return Date.now() - this.lastAppStateChange >= this.appStateStableMs
  }

  waitForStartupComplete() {
    if (!this.isStartupPhase) {
      return Promise.resolve()
    }
    const remainingMs = this.startupStabilityMs - (Date.now() - this.startupTime)
    if (remainingMs <= 0) {
      this.isStartupPhase = false
      return Promise.resolve()
    }
    return new Promise((resolve) => setTimeout(resolve, remainingMs))
  }

  isReadyForValidation() {
    return !this.isStartupPhase && this.appState === "active"
  }

  _handleBackground() {
    console.log("[WebSocket] App backgrounded - pausing reconnects")
    this.reconnectPaused = true
    this.isBackgroundClosed = false

    this.pendingJoins.forEach((rideId) => {
      const jp = this.joinPromises.get(rideId)
      if (jp) {
        jp.reject(new Error("App backgrounded"))
        this.joinPromises.delete(rideId)
      }
    })
    this.pendingJoins.clear()
  }

  _handleForeground() {
    console.log("[WebSocket] App foregrounded - resuming connection management")
    this.reconnectPaused = false

    // The server-side room subscription was lost when connection dropped
    this.joinedRooms.clear()

    const needsReconnect = !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isHealthy

    if (needsReconnect) {
      console.log("[WebSocket] Connection unhealthy on foreground - triggering reconnect")
      this.isBackgroundClosed = true
      this._forceReconnect()
    } else {
      // Connection seems OK, send a ping to verify
      this._sendPing()
    }

    if (this.onReconnectCallback) {
      // Delay to let reconnect establish AND wait for stability
      setTimeout(() => {
        if (this.appState === "active" && this.isAppStateStable()) {
          this.onReconnectCallback("foreground_resume")
        } else {
          console.log("[WebSocket] Skipping reconnect callback - AppState not stable")
        }
      }, 600)
    }
  }

  _forceReconnect() {
    if (this.isDisconnecting) {
      console.log("[WebSocket] Already disconnecting, skipping")
      return
    }

    this.disconnect(false) // Don't clear state
    if (this.token && this.userId) {
      this.connect(this.userId, this.token, this.rideId)
    }
  }

  setGetCurrentRideCallback(callback) {
    this.getCurrentRideCallback = callback
  }

  setOnHealthChangeCallback(callback) {
    this.onHealthChangeCallback = callback
  }

  setOnReconnectCallback(callback) {
    this.onReconnectCallback = callback
  }

  setOnTerminalRideCallback(callback) {
    this.onTerminalRideCallback = callback
  }

  setOnConnectRoomJoinCallback(callback) {
    this.onConnectRoomJoinCallback = callback
  }

  async connect(userId, token, rideId = null) {
    console.log(`[WebSocket] Connect requested (userId: ${userId}, rideId: ${rideId})`)

    // Clear any pending reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    const getDefaultWsUrl = () => {
      if (Platform.OS === "android") {
        return "ws://10.0.2.2:8000/ws/ride"
      }
      return "ws://localhost:8000/ws/ride"
    }

    const WS_BASE_URL = process.env.EXPO_PUBLIC_WS_BASE_URL || getDefaultWsUrl()
    const url = `${WS_BASE_URL}?token=${token}`

    this.userId = userId
    this.token = token
    this.rideId = rideId
    this.isReconnecting = false

    if (this.ws) {
      try {
        this.ws.onclose = null // Remove handler to prevent double logging
        this.ws.close()
      } catch (e) {
        // Ignore close errors
      }
      this.ws = null
    }

    try {
      console.log("[WebSocket] Connecting...")
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        console.log("[WebSocket] Connected successfully")
        this.connectedAt = Date.now()
        this.lastPong = Date.now()
        this.isHealthy = true
        this.isBackgroundClosed = false
        this.reconnectAttempts = 0

        this._startPingInterval()
        this._notifyHealthChange(true)

        // Auto-join is removed; MapScreen will call joinRide after GET validation

        this.emit("connected")

        // Trigger reconnect callback for state recovery
        if (this.reconnectAttempts > 0 || this.isBackgroundClosed) {
          if (this.onReconnectCallback) {
            this.onReconnectCallback("reconnected")
          }
        }

        // Wait for startup phase to complete before attempting room join
        this._attemptPostConnectRoomJoin()
      }

      this.ws.onmessage = (event) => {
        this._handleMessage(event)
      }

      this.ws.onerror = (error) => {
        const sanitizedError = this._sanitizeError(error)
        console.error("[WebSocket] Error:", sanitizedError)
        this.isHealthy = false
        this._notifyHealthChange(false, sanitizedError)
        this.emit("error", { message: sanitizedError })
      }

      this.ws.onclose = (event) => {
        const reason = event.reason || "Connection closed"
        const code = event.code
        console.log(`[WebSocket] Disconnected (code: ${code}, reason: ${reason})`)

        this._stopPingInterval()
        this.isHealthy = false
        this._notifyHealthChange(false)

        this.pendingJoins.clear()
        this.joinPromises.forEach((p) => p.reject && p.reject(new Error("Connection closed")))
        this.joinPromises.clear()

        this._attemptReconnect()
      }
    } catch (error) {
      console.error("[WebSocket] Connection failed:", this._sanitizeError(error))
      this._attemptReconnect()
    }
  }

  _handleMessage(event) {
    try {
      const message = JSON.parse(event.data)

      if (!message || typeof message !== "object") {
        console.warn("[WebSocket] Invalid message format")
        return
      }

      const eventType = message.event_type || message.event || message.type

      if (!eventType) {
        return
      }

      // Handle pong - update health
      if (eventType === "pong") {
        this.lastPong = Date.now()
        this.isHealthy = true
        this._clearPongTimeout()
        return
      }

      // Handle ping from server
      if (eventType === "ping") {
        this.send("pong", { timestamp: new Date().toISOString() })
        return
      }

      if (eventType === "joined_ride") {
        const joinedRideId = message.ride_id
        if (joinedRideId) {
          const rideIdStr = String(joinedRideId)
          this.joinedRooms.add(rideIdStr)
          this.pendingJoins.delete(rideIdStr)
          this.rideId = joinedRideId
          console.log(`[WebSocket] Join confirmed for ride: ${joinedRideId}`)

          // Resolve join promise and clear timeout
          const joinPromise = this.joinPromises.get(rideIdStr)
          if (joinPromise) {
            if (joinPromise.timeoutId) {
              clearTimeout(joinPromise.timeoutId)
            }
            joinPromise.resolve(message)
            this.joinPromises.delete(rideIdStr)
          }
        }
      }

      if (eventType === "error") {
        const errorMessage = message.message || ""
        console.log(`[WebSocket] Error event: ${errorMessage}`)

        // Check if this is a "Cannot join ride with status" error
        if (errorMessage.includes("Cannot join ride with status")) {
          // Extract status from message
          const statusMatch = errorMessage.match(/status: (\w+)/)
          const rideStatus = statusMatch ? statusMatch[1] : "unknown"

          // Reject any pending join promises
          this.pendingJoins.forEach((rideId) => {
            const joinPromise = this.joinPromises.get(rideId)
            if (joinPromise) {
              joinPromise.reject(new Error(errorMessage))
              this.joinPromises.delete(rideId)
            }
          })
          this.pendingJoins.clear()

          // Notify callback about terminal ride
          if (this.onTerminalRideCallback) {
            this.onTerminalRideCallback(rideStatus, errorMessage)
          }
        }
      }

      // Handle left_ride
      if (eventType === "left_ride") {
        const leftRideId = message.ride_id
        if (leftRideId) {
          this.joinedRooms.delete(String(leftRideId))
        }
      }

      if (eventType === "connected" && message.data && message.data.active_ride) {
        const rideStatus = message.data.active_ride.status
        if (rideStatus === "completed" || rideStatus === "cancelled") {
          if (this.onTerminalRideCallback) {
            this.onTerminalRideCallback(rideStatus, "Ride is in terminal state")
          }
        }
      }

      const eventData = message.data || message

      // Invoke registered handlers
      if (this.handlers[eventType]) {
        this.handlers[eventType].forEach((handler) => {
          try {
            handler(eventData)
          } catch (handlerError) {
            console.error(`[WebSocket] Handler error for ${eventType}:`, handlerError)
          }
        })
      }
    } catch (error) {
      console.error("[WebSocket] Error parsing message:", error)
    }
  }

  _sanitizeError(error) {
    if (!error) return "Unknown error"

    if (typeof error === "string") return error

    if (error.message) {
      // Sanitize common native errors
      if (error.message.includes("Software caused connection abort")) {
        return "Connection interrupted (network change or app backgrounded)"
      }
      if (error.message.includes("no close frame")) {
        return "Connection lost unexpectedly"
      }
      if (error.message.includes("isTrusted")) {
        return "Connection error"
      }
      return error.message
    }

    return "Connection error"
  }

  _notifyHealthChange(healthy, error = null) {
    if (this.onHealthChangeCallback) {
      this.onHealthChangeCallback({ healthy, error, connectedAt: this.connectedAt })
    }
  }

  _startPingInterval() {
    this._stopPingInterval()

    this.pingInterval = setInterval(() => {
      this._sendPing()
    }, this.pingIntervalMs)
  }

  _sendPing() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send("ping", { timestamp: new Date().toISOString() })

      // Set pong timeout
      this._clearPongTimeout()
      this.pongTimer = setTimeout(() => {
        console.warn("[WebSocket] Pong timeout - connection may be unhealthy")
        this.isHealthy = false
        this._notifyHealthChange(false, "No response from server")
      }, this.pongTimeoutMs)
    }
  }

  _clearPongTimeout() {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer)
      this.pongTimer = null
    }
  }

  _stopPingInterval() {
    this._clearPongTimeout()
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  _attemptReconnect() {
    if (this.isReconnecting) return

    if (this.reconnectPaused) {
      console.log("[WebSocket] Reconnect paused (app backgrounded)")
      return
    }

    this._stopPingInterval()

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("[WebSocket] Max reconnect attempts reached - entering slow reconnect mode")
      // Continue trying with max delay
      this.reconnectAttempts = this.maxReconnectAttempts
    }

    this.reconnectAttempts++
    this.isReconnecting = true

    // Exponential backoff with jitter
    const exponentialDelay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay,
    )
    const jitter = Math.random() * 1000
    const delay = exponentialDelay + jitter

    console.log(`[WebSocket] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.isReconnecting = false

      if (this.reconnectPaused) {
        console.log("[WebSocket] Reconnect cancelled (app backgrounded)")
        return
      }

      if (this._shouldStopReconnecting()) {
        console.log("[WebSocket] Stopping reconnect - ride is stale or invalid")
        this.reconnectAttempts = 0
        return
      }

      if (this.token && this.userId) {
        this.connect(this.userId, this.token, this.rideId)
      }
    }, delay)
  }

  _shouldStopReconnecting() {
    // If we have a ride callback, check if ride is still valid
    if (this.getCurrentRideCallback) {
      const currentRide = this.getCurrentRideCallback()

      // No ride - allow reconnect for general connectivity
      if (!currentRide) {
        return false
      }

      // Terminal states - stop reconnecting for this ride
      if (currentRide.status === "completed" || currentRide.status === "cancelled") {
        this.rideId = null
        this.joinedRooms.clear()
        return false // Allow reconnect but clear ride context
      }
    }

    return false
  }

  stopReconnecting() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.isReconnecting = false
    this.reconnectAttempts = 0
  }

  clearRoomState() {
    this.joinedRooms.clear()
    this.pendingJoins.clear()
    this.joinPromises.forEach((p) => p.reject && p.reject(new Error("Room state cleared")))
    this.joinPromises.clear()
    this.rideId = null
  }

  joinRide(rideId) {
    const rideIdStr = String(rideId)

    if (this.reconnectPaused) {
      console.log(`[WebSocket] Join skipped - app is backgrounded`)
      return Promise.reject(new Error("App is backgrounded"))
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log(`[WebSocket] Join skipped - WS not connected`)
      return Promise.reject(new Error("WebSocket not connected"))
    }

    // Server will handle idempotency; we need to ensure room subscription exists after reconnect
    // Old logic: if (this.joinedRooms.has(rideIdStr)) return Promise.resolve(...)

    // Don't duplicate pending joins
    if (this.pendingJoins.has(rideIdStr)) {
      console.log(`[WebSocket] Join already pending for ride ${rideId}`)
      const existingPromise = this.joinPromises.get(rideIdStr)
      if (existingPromise) {
        return existingPromise.promise
      }
      return Promise.resolve({ event_type: "joined_ride", ride_id: rideId, message: "Join pending" })
    }

    console.log(`[WebSocket] Sending join_ride for ${rideId}`)

    let resolveJoin, rejectJoin
    const joinPromise = new Promise((resolve, reject) => {
      resolveJoin = resolve
      rejectJoin = reject
    })

    this.joinPromises.set(rideIdStr, {
      promise: joinPromise,
      resolve: resolveJoin,
      reject: rejectJoin,
    })

    this.pendingJoins.add(rideIdStr)
    this.send("join_ride", { ride_id: rideId })

    const timeoutId = setTimeout(() => {
      if (this.pendingJoins.has(rideIdStr) && !this.reconnectPaused) {
        console.log(`[WebSocket] Join timeout for ride ${rideId}`)
        this.pendingJoins.delete(rideIdStr)
        const jp = this.joinPromises.get(rideIdStr)
        if (jp) {
          jp.reject(new Error("Join timeout"))
          this.joinPromises.delete(rideIdStr)
        }
      }
    }, 10000)

    this.joinPromises.get(rideIdStr).timeoutId = timeoutId

    return joinPromise
  }

  leaveRide(rideId) {
    const rideIdStr = String(rideId)
    this.joinedRooms.delete(rideIdStr)
    this.pendingJoins.delete(rideIdStr)
    this.joinPromises.delete(rideIdStr)
    this.send("leave_ride", { ride_id: rideId })
  }

  isJoinedToRoom(rideId = null) {
    if (rideId) {
      return this.joinedRooms.has(String(rideId))
    }
    return this.joinedRooms.size > 0
  }

  // Throttle location updates to prevent UI churn
  shouldProcessLocationUpdate(data) {
    const now = Date.now()

    if (!this.lastLocationUpdate) {
      this.lastLocationUpdate = { time: now, lat: data.latitude, lng: data.longitude }
      return true
    }

    // Time-based throttle
    if (now - this.lastLocationUpdate.time < this.locationThrottleMs) {
      return false
    }

    // Dedupe identical coordinates
    const latDiff = Math.abs(data.latitude - this.lastLocationUpdate.lat)
    const lngDiff = Math.abs(data.longitude - this.lastLocationUpdate.lng)

    if (latDiff < 0.00001 && lngDiff < 0.00001) {
      return false // Same location, skip
    }

    this.lastLocationUpdate = { time: now, lat: data.latitude, lng: data.longitude }
    return true
  }

  on(event, handler) {
    if (!this.handlers[event]) {
      this.handlers[event] = []
    }
    // Prevent duplicate handlers
    if (!this.handlers[event].includes(handler)) {
      this.handlers[event].push(handler)
    }
  }

  off(event, handler) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter((h) => h !== handler)
    }
  }

  send(event, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ event_type: event, ...data }))
      } catch (e) {
        console.error("[WebSocket] Send error:", e)
      }
    } else {
      console.warn("[WebSocket] Cannot send - connection not open")
    }
  }

  emit(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach((handler) => {
        try {
          handler(data)
        } catch (e) {
          console.error(`[WebSocket] Emit handler error for ${event}:`, e)
        }
      })
    }
  }

  getConnectionHealth() {
    return {
      isConnected: this.ws?.readyState === WebSocket.OPEN,
      isHealthy: this.isHealthy,
      connectedAt: this.connectedAt,
      lastPong: this.lastPong,
      reconnectAttempts: this.reconnectAttempts,
      joinedRooms: Array.from(this.joinedRooms),
    }
  }

  disconnect(clearState = true) {
    if (this.isDisconnecting) {
      return
    }
    this.isDisconnecting = true

    console.log("[WebSocket] Disconnecting...")

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this._stopPingInterval()
    this.isReconnecting = false

    if (clearState) {
      this.joinedRooms.clear()
      this.pendingJoins.clear()
      this.joinPromises.clear()
      this.reconnectAttempts = 0
    }

    if (this.ws) {
      try {
        this.ws.onclose = null // Remove handler to prevent reconnect loop
        this.ws.close(1000, "Client disconnect")
      } catch (e) {
        // Ignore
      }
      this.ws = null
    }

    this.isHealthy = false
    this.connectedAt = null
    this.lastPong = null

    setTimeout(() => {
      this.isDisconnecting = false
    }, 100)
  }

  destroy() {
    this.disconnect(true)
    if (this.appStateSubscription) {
      this.appStateSubscription.remove()
      this.appStateSubscription = null
    }
    this.handlers = {}
  }

  async _attemptPostConnectRoomJoin() {
    // Wait for startup phase to complete
    await this.waitForStartupComplete()

    // Add small delay to ensure connection is stable
    await new Promise((resolve) => setTimeout(resolve, 300))

    // Check if still connected
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log("[WebSocket] Post-connect room join skipped - WS not open")
      return
    }

    // Check if app is in foreground
    if (this.appState !== "active") {
      console.log("[WebSocket] Post-connect room join skipped - app not active")
      return
    }

    // Use callback to get persisted ride and join if needed
    if (this.onConnectRoomJoinCallback) {
      try {
        await this.onConnectRoomJoinCallback()
      } catch (e) {
        console.log("[WebSocket] Post-connect room join callback error:", e.message)
      }
    }
  }
}

export default new WebSocketService()
