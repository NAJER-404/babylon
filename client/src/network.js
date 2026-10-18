// Socket.IO Network Manager for Online 1v1 Arena Matches
// Supports WebSocket-First Transport with Polling Fallback, App-Level EMA Ping & Clock Offset,
// Volatile Compact 30Hz Updates, Event Logging, Server Hitbox Subscriptions & Artificial Lag Simulator
import { io } from 'socket.io-client';
import { CONFIG } from './config.js';

export class NetworkManager {
  constructor() {
    this.socket = null;
    this.connectionState = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
    this.roomCode = null;
    this.playerNumber = null;
    this.playerName = 'Player 1';

    // Latency & Clock Synchronization (Part 1)
    this.pingMs = 0;
    this.smoothedPing = 0;
    this.maxPing = 0;
    this.jitter = 0;
    this.serverClockOffset = 0; // Local wall time + offset = Server wall time
    this.pingInterval = null;
    this.fallbackTimer = null;
    this.hasRegisteredListeners = false;

    // Packet metrics (Part 0)
    this.packetsInCounter = 0;
    this.packetsOutCounter = 0;
    this.ppsIn = 0;
    this.ppsOut = 0;
    this.ppsInterval = null;

    // Last 5 server events (Part 0)
    this.recentEvents = [];

    // Dev-only artificial latency and packet loss (Part 5)
    this.simulatedLatencyMs = 0;
    this.simulatedPacketLoss = 0;

    // Callbacks
    this.onConnectionStatusChange = null;
    this.onMatchCountdown = null;
    this.onMatchStart = null;
    this.onWorldState = null;
    this.onHitConfirmed = null;
    this.onDamageTaken = null;
    this.onKillCam = null;
    this.onKillCamEnd = null;
    this.onPlayerKilled = null;
    this.onPlayerRespawned = null;
    this.onMatchOver = null;
    this.onMatchRestarted = null;
    this.onRematchUpdate = null;
    this.onOpponentLeft = null;
    this.onOpponentSwitchWeapon = null;
    this.onPingUpdate = null;
    this.onPositionCorrection = null;
    this.onDebugServerHitboxes = null;
    this.onDisconnect = null;

    this.startPacketRateMonitor();
  }

  setConnectionState(state) {
    this.connectionState = state;
    if (this.onConnectionStatusChange) {
      this.onConnectionStatusChange(state);
    }
  }

  logEvent(text) {
    const timeStr = new Date().toTimeString().slice(0, 8);
    this.recentEvents.unshift({ time: timeStr, text });
    if (this.recentEvents.length > 5) {
      this.recentEvents.pop();
    }
  }

  setSimulatedNetwork(latencyMs, packetLossRate) {
    this.simulatedLatencyMs = Math.max(0, Number(latencyMs) || 0);
    this.simulatedPacketLoss = Math.max(0, Math.min(0.5, Number(packetLossRate) || 0));
    console.log(`[Network Simulator] Latency: ${this.simulatedLatencyMs}ms, Packet Loss: ${(this.simulatedPacketLoss * 100).toFixed(0)}%`);
  }

  connect(serverUrl = CONFIG.NETWORK.SERVER_URL) {
    if (this.socket && (this.socket.connected || this.connectionState === 'connecting')) {
      return;
    }

    this.setConnectionState('connecting');

    // 1. WebSocket-first with NO polling delay (Part 1)
    this.socket = io(serverUrl, {
      transports: ['websocket'],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 4000,
      timeout: 8000
    });

    // 2. Fallback to polling transport if websocket fails to connect after 4s (Part 1)
    clearTimeout(this.fallbackTimer);
    this.fallbackTimer = setTimeout(() => {
      if (this.socket && !this.socket.connected) {
        console.warn('[Network] WebSocket connection timed out after 4s. Attempting HTTP polling fallback...');
        this.socket.io.opts.transports = ['polling', 'websocket'];
        this.socket.connect();
      }
    }, 4000);

    this.registerSocketListeners();
  }

  registerSocketListeners() {
    if (!this.socket || this.hasRegisteredListeners) return;
    this.hasRegisteredListeners = true;

    this.socket.on('connect', () => {
      clearTimeout(this.fallbackTimer);
      this.setConnectionState('connected');
      this.logEvent(`Connected via ${this.socket.io?.engine?.transport?.name || 'websocket'}`);
      this.startPingMonitor();
    });

    this.socket.on('reconnect_attempt', () => {
      this.setConnectionState('reconnecting');
      this.logEvent('Reconnecting...');
    });

    this.socket.on('reconnect', () => {
      this.setConnectionState('connected');
      this.logEvent('Reconnected to server');
    });

    this.socket.on('reconnect_failed', () => {
      this.setConnectionState('disconnected');
      this.logEvent('Reconnection failed');
      if (this.onDisconnect) this.onDisconnect('Connection to server lost. Please try again.');
    });

    this.socket.on('disconnect', (reason) => {
      this.setConnectionState(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
      this.logEvent(`Disconnected (${reason})`);
      this.stopPingMonitor();
      if (this.onDisconnect && reason === 'io client disconnect') {
        this.onDisconnect(reason);
      }
    });

    this.socket.on('server_shutdown', (data) => {
      this.setConnectionState('disconnected');
      this.logEvent('Server restarting');
      if (this.onOpponentLeft) {
        this.onOpponentLeft({ message: data?.message || 'Server restarting. Returning to menu...' });
      } else if (this.onDisconnect) {
        this.onDisconnect(data?.message || 'Server restarting. Returning to menu...');
      }
    });

    // Helper to receive with simulated lag / loss
    const receiveWithSim = (callback, eventName) => (data) => {
      this.packetsInCounter++;
      if (this.simulatedPacketLoss > 0 && Math.random() < this.simulatedPacketLoss) {
        return; // drop packet
      }
      if (this.simulatedLatencyMs > 0) {
        setTimeout(() => callback(data), this.simulatedLatencyMs / 2);
      } else {
        callback(data);
      }
    };

    this.socket.on('match_countdown', (data) => {
      this.logEvent(`Countdown: ${data.count}`);
      if (this.onMatchCountdown) this.onMatchCountdown(data);
    });

    this.socket.on('match_start', (data) => {
      this.roomCode = data.roomCode;
      this.logEvent('Match Started');
      if (this.onMatchStart) this.onMatchStart(data);
    });

    this.socket.on('world_state', receiveWithSim((data) => {
      if (this.onWorldState) this.onWorldState(data);
    }, 'world_state'));

    this.socket.on('hit_confirmed', (data) => {
      this.logEvent(`Hit: ${data.part} (${data.damage} dmg)`);
      if (this.onHitConfirmed) this.onHitConfirmed(data);
    });

    this.socket.on('damage_taken', (data) => {
      this.logEvent(`Took ${data.damage} dmg (${data.newHealth} HP left)`);
      if (this.onDamageTaken) this.onDamageTaken(data);
    });

    this.socket.on('kill_cam', (data) => {
      this.logEvent(`KillCam: ${data.weaponType} on ${data.hitPart}`);
      if (this.onKillCam) this.onKillCam(data);
    });

    this.socket.on('kill_cam_end', (data) => {
      this.logEvent('KillCam concluded');
      if (this.onKillCamEnd) this.onKillCamEnd(data);
    });

    this.socket.on('player_killed', (data) => {
      this.logEvent('Player eliminated');
      if (this.onPlayerKilled) this.onPlayerKilled(data);
    });

    this.socket.on('player_respawned', (data) => {
      this.logEvent('Player respawned');
      if (this.onPlayerRespawned) this.onPlayerRespawned(data);
    });

    this.socket.on('match_over', (data) => {
      this.logEvent(`Match Over. Winner: Player ${data.winnerNumber}`);
      if (this.onMatchOver) this.onMatchOver(data);
    });

    this.socket.on('match_restarted', (data) => {
      this.logEvent('Match Restarted');
      if (this.onMatchRestarted) this.onMatchRestarted(data);
    });

    this.socket.on('rematch_update', (data) => {
      this.logEvent(`Rematch ready: Player ${data.playerNumber}`);
      if (this.onRematchUpdate) this.onRematchUpdate(data);
    });

    this.socket.on('opponent_left', (data) => {
      this.logEvent('Opponent left room');
      if (this.onOpponentLeft) this.onOpponentLeft(data);
    });

    this.socket.on('opponent_switch_weapon', (data) => {
      if (this.onOpponentSwitchWeapon) this.onOpponentSwitchWeapon(data);
    });

    this.socket.on('position_correction', (data) => {
      this.logEvent('Server position correction');
      if (this.onPositionCorrection) this.onPositionCorrection(data);
    });

    this.socket.on('debug_server_hitboxes', (data) => {
      if (this.onDebugServerHitboxes) this.onDebugServerHitboxes(data);
    });

    // App-level ping and pong carrying timestamps with EMA smoothing (Part 1)
    this.socket.on('pong_check', (payload) => {
      this.packetsInCounter++;
      const nowPerf = performance.now();
      const nowWall = Date.now();
      const sentTime = typeof payload === 'number' ? payload : (payload.clientTimestamp || payload.t0);
      const rtt = Math.max(1, nowPerf - sentTime);
      this.pingMs = rtt;

      // Exponential Moving Average (EMA) smoothing
      if (this.smoothedPing === 0) {
        this.smoothedPing = rtt;
      } else {
        this.smoothedPing = 0.85 * this.smoothedPing + 0.15 * rtt;
      }

      // Track max ping with gentle decay and jitter
      this.maxPing = Math.max(this.maxPing * 0.96, rtt);
      this.jitter = Math.abs(rtt - this.smoothedPing);

      if (payload && typeof payload === 'object' && payload.serverTimestamp) {
        // Calculate clock offset between local wall clock and server clock
        this.serverClockOffset = payload.serverTimestamp - (nowWall - (rtt / 2));
      }

      if (this.onPingUpdate) {
        this.onPingUpdate({
          ping: Math.round(this.smoothedPing),
          rawPing: Math.round(rtt),
          maxPing: Math.round(this.maxPing),
          jitter: Math.round(this.jitter)
        });
      }
    });
  }

  startPingMonitor() {
    this.stopPingMonitor();
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.connected) {
        this.packetsOutCounter++;
        this.socket.emit('ping_check', {
          clientTimestamp: performance.now(),
          wallTime: Date.now()
        });
      }
    }, 1500);
  }

  stopPingMonitor() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  startPacketRateMonitor() {
    if (this.ppsInterval) clearInterval(this.ppsInterval);
    this.ppsInterval = setInterval(() => {
      this.ppsIn = this.packetsInCounter;
      this.ppsOut = this.packetsOutCounter;
      this.packetsInCounter = 0;
      this.packetsOutCounter = 0;
    }, 1000);
  }

  // Get current server-estimated timestamp
  getEstimatedServerTime() {
    return Date.now() + this.serverClockOffset;
  }

  createRoom(playerName) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        this.connect();
      }

      const timeoutId = setTimeout(() => {
        reject(new Error('Cannot connect to server (5s timeout)'));
      }, 5000);

      this.packetsOutCounter++;
      this.socket.emit('create_room', { playerName }, (res) => {
        clearTimeout(timeoutId);
        if (res && res.success) {
          this.roomCode = res.roomCode;
          this.playerNumber = res.playerNumber;
          this.playerName = res.playerName;
          resolve(res);
        } else {
          reject(new Error(res?.error || 'Failed to create room'));
        }
      });
    });
  }

  cancelRoom() {
    return new Promise((resolve) => {
      if (!this.socket || !this.socket.connected) {
        this.roomCode = null;
        resolve({ success: true });
        return;
      }
      this.packetsOutCounter++;
      this.socket.emit('cancel_room', () => {
        this.roomCode = null;
        resolve({ success: true });
      });
      setTimeout(() => {
        this.roomCode = null;
        resolve({ success: true });
      }, 800);
    });
  }

  joinRoom(roomCode, playerName) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        this.connect();
      }

      const timeoutId = setTimeout(() => {
        reject(new Error('Cannot connect to server (5s timeout)'));
      }, 5000);

      this.packetsOutCounter++;
      this.socket.emit('join_room', { roomCode, playerName }, (res) => {
        clearTimeout(timeoutId);
        if (res && res.success) {
          this.roomCode = res.roomCode;
          this.playerNumber = res.playerNumber;
          this.playerName = res.playerName;
          resolve(res);
        } else {
          reject(new Error(res?.error || 'Failed to join room'));
        }
      });
    });
  }

  // Compact volatile 30 Hz player state updates (Part 1)
  sendPlayerUpdate(compactData) {
    if (!this.socket || !this.socket.connected) return;

    const emitUpdate = () => {
      this.packetsOutCounter++;
      this.socket.volatile.emit('player_update', compactData);
    };

    if (this.simulatedPacketLoss > 0 && Math.random() < this.simulatedPacketLoss) {
      return; // drop
    }

    if (this.simulatedLatencyMs > 0) {
      setTimeout(emitUpdate, this.simulatedLatencyMs / 2);
    } else {
      emitUpdate();
    }
  }

  sendSwitchWeapon(weaponId) {
    if (this.socket && this.socket.connected) {
      this.packetsOutCounter++;
      this.socket.emit('player_switch_weapon', weaponId);
    }
  }

  // Reliable emission with shotId & server-estimated timestamp (Part 2)
  sendShoot(shootData) {
    if (!this.socket || !this.socket.connected) return;

    shootData.estimatedServerTime = this.getEstimatedServerTime();
    shootData.shotId = shootData.shotId || `shot_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    const emitShoot = () => {
      this.packetsOutCounter++;
      this.socket.emit('player_shoot', shootData);
    };

    if (this.simulatedPacketLoss > 0 && Math.random() < this.simulatedPacketLoss) {
      return;
    }

    if (this.simulatedLatencyMs > 0) {
      setTimeout(emitShoot, this.simulatedLatencyMs / 2);
    } else {
      emitShoot();
    }
  }

  sendRematch() {
    if (this.socket && this.socket.connected) {
      this.packetsOutCounter++;
      this.socket.emit('rematch');
    }
  }

  setDebugHitboxesSubscription(enabled) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('debug_subscribe_hitboxes', !!enabled);
    }
  }

  disconnect() {
    this.stopPingMonitor();
    clearTimeout(this.fallbackTimer);
    if (this.ppsInterval) clearInterval(this.ppsInterval);
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.hasRegisteredListeners = false;
      this.setConnectionState('disconnected');
    }
  }
}
