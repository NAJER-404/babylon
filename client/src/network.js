// Socket.IO Network Manager for Online 1v1 Arena Matches
// Supports WebSocket-First Transport with Polling Fallback, App-Level EMA Ping & Clock Offset,
// Volatile Compact 30Hz Updates, Event Logging, Server Hitbox Subscriptions & Artificial Lag Simulator
import { io } from 'socket.io-client';
import { CONFIG } from './config.js';

export class NetworkManager {
  constructor() {
    this.socket = null;
    this.connectionState = 'disconnected';
    this.roomCode = null;
    this.playerNumber = null;
    this.playerName = 'Player 1';

    // Section A: Identity
    this.localId = null;
    this.remoteId = null;
    this.matchStartServerTime = 0;
    this.matchDuration = 600;

    // Latency & Clock Synchronization (Part 1 & Section H)
    this.pingMs = 0;
    this.smoothedPing = 0;
    this.maxPing = 0;
    this.jitter = 0;
    this.serverClockOffset = 0; 
    this.pingInterval = null;
    this.fallbackTimer = null;
    this.hasRegisteredListeners = false;

    // Background 30 Hz Send Loop (Dedicated Web Worker + Fallback)
    this.sendWorker = null;
    this.sendIntervalFallback = null;
    this.getUpdatePayload = null;
    this.onBackgroundTick = null;
    this.lastPeriodicSendTime = 0;

    // Packet & Telemetry metrics (Section J)
    this.packetsInCounter = 0;
    this.packetsOutCounter = 0;
    this.sendRateCounter = 0;
    this.sendRate = 0;
    this.snapshotCounter = 0;
    this.snapshotsPerSecond = 0;
    this.lastSnapshotReceivedTime = 0;
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

    // Matchmaking Callbacks
    this.onMatchFound = null;
    this.onMatchmakingStatus = null;
    this.onMatchmakingCancelled = null;
    this.onPlayerJoinedLate = null; // <--- NEW: Late Join Callback

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

    this.socket = io(serverUrl, {
      transports: ['websocket'],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 4000,
      timeout: 8000
    });

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

    // Matchmaking Listeners
    this.socket.on('matchmaking_status', (data) => {
      if (this.onMatchmakingStatus) this.onMatchmakingStatus(data);
    });

    this.socket.on('match_found', (data) => {
      this.roomCode = data.roomCode;
      this.playerNumber = data.playerNumber;
      this.playerName = data.playerName;
      if (this.onMatchFound) this.onMatchFound(data);
    });

    this.socket.on('matchmaking_cancelled', () => {
      if (this.onMatchmakingCancelled) this.onMatchmakingCancelled();
    });

    // --- NEW: Late Join Listener ---
    this.socket.on('player_joined_late', (data) => {
      if (this.onPlayerJoinedLate) this.onPlayerJoinedLate(data);
    });
    // -------------------------------

    const receiveWithSim = (callback, eventName) => (data) => {
      this.packetsInCounter++;
      if (this.simulatedPacketLoss > 0 && Math.random() < this.simulatedPacketLoss) {
        return; 
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
      this.localId = data.localId || this.socket?.id;
      this.remoteId = data.remoteId || null;
      this.matchStartServerTime = data.matchStartServerTime || data.serverTimestamp || Date.now();
      this.matchDuration = data.duration || 600;
      this.logEvent('Match Started');
      if (this.onMatchStart) this.onMatchStart(data);
    });

    const handleSnapshot = receiveWithSim((data) => {
      this.snapshotCounter++;
      this.lastSnapshotReceivedTime = Date.now();
      if (this.onWorldState) this.onWorldState(data);
    }, 'state');

    this.socket.on('state', handleSnapshot);
    this.socket.on('world_state', handleSnapshot);

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
      if (this.onServerHitboxes) this.onServerHitboxes(data);
    });

    this.socket.on('shot_result', (data) => {
      if (data) {
        const reasonStr = data.hit ? `HIT (${data.part || '?'}) dist:${data.distance || 0}m` : `MISS: ${data.reason || '?'}`;
        this.logEvent(`Shot: ${reasonStr}`);
      }
      if (this.onShotResult) this.onShotResult(data);
    });

    this.socket.on('pong', (payload) => this.handlePong(payload));
    this.socket.on('pong_check', (payload) => this.handlePong(payload));
  }

  handlePong(payload, fallbackSentTime) {
    this.packetsInCounter++;
    const now = Date.now();
    let sentTime = fallbackSentTime;
    let serverTime = now;

    if (typeof payload === 'number') {
      sentTime = payload;
    } else if (payload && typeof payload === 'object') {
      sentTime = payload.clientTime ?? payload.clientTimestamp ?? payload.wallTime ?? fallbackSentTime ?? now;
      serverTime = payload.serverTime ?? payload.serverTimestamp ?? now;
    }

    const rtt = Math.max(1, now - sentTime);
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > 5000) {
      return;
    }

    this.pingMs = rtt;
    if (this.smoothedPing === 0) {
      this.smoothedPing = rtt;
    } else {
      this.smoothedPing = 0.85 * this.smoothedPing + 0.15 * rtt;
    }

    this.maxPing = Math.max(this.maxPing * 0.95, rtt);
    this.jitter = Math.abs(rtt - this.smoothedPing);
    this.serverClockOffset = serverTime - (sentTime + (rtt / 2));

    if (this.onPingUpdate) {
      this.onPingUpdate(Math.round(this.smoothedPing), Math.round(this.jitter));
    }
  }

  startPingMonitor() {
    this.stopPingMonitor();
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.connected) {
        const clientSend = Date.now();
        this.packetsOutCounter++;
        this.socket.emit('ping', clientSend, (res) => {
          this.handlePong(res, clientSend);
        });
        this.socket.emit('ping_check', {
          clientTimestamp: performance.now(),
          wallTime: clientSend
        });
      }
    }, 1000);
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
      this.sendRate = this.sendRateCounter;
      this.snapshotsPerSecond = this.snapshotCounter;
      this.packetsInCounter = 0;
      this.packetsOutCounter = 0;
      this.sendRateCounter = 0;
      this.snapshotCounter = 0;
    }, 1000);
  }

  getLastSnapshotAgeMs() {
    if (!this.lastSnapshotReceivedTime) return 0;
    return Math.max(0, Date.now() - this.lastSnapshotReceivedTime);
  }

  getEstimatedServerTime() {
    return Date.now() + this.serverClockOffset;
  }

  // Matchmaking Methods
  findMatch(playerName) {
    if (!this.socket || !this.socket.connected) {
      this.connect();
    }
    this.packetsOutCounter++;
    this.socket.emit('find_match', { playerName });
  }

  cancelFindMatch() {
    if (this.socket && this.socket.connected) {
      this.packetsOutCounter++;
      this.socket.emit('cancel_find_match');
    }
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

  startSendLoop(getUpdatePayload, onBackgroundTick = null) {
    this.stopSendLoop();
    this.getUpdatePayload = getUpdatePayload;
    this.onBackgroundTick = onBackgroundTick;
    this.lastPeriodicSendTime = Date.now();

    try {
      const workerBlob = new Blob([
        `let timer = null;
         self.onmessage = function(e) {
           if (e.data === 'start') {
             if (timer) clearInterval(timer);
             timer = setInterval(function() {
               self.postMessage('tick');
             }, 33.333);
           } else if (e.data === 'stop') {
             if (timer) {
               clearInterval(timer);
               timer = null;
             }
           }
         };`
      ], { type: 'application/javascript' });

      const workerUrl = URL.createObjectURL(workerBlob);
      this.sendWorker = new Worker(workerUrl);
      this.sendWorker.onmessage = () => {
        this.emitPeriodicStateUpdate();
      };
      this.sendWorker.postMessage('start');
    } catch (e) {
      console.warn('[Network] Inline Worker timer creation failed, relying on interval fallback:', e);
    }

    this.sendIntervalFallback = setInterval(() => {
      if (Date.now() - this.lastPeriodicSendTime >= 30) {
        this.emitPeriodicStateUpdate();
      }
    }, 33.333);
  }

  stopSendLoop() {
    if (this.sendWorker) {
      try {
        this.sendWorker.postMessage('stop');
        this.sendWorker.terminate();
      } catch (e) {}
      this.sendWorker = null;
    }
    if (this.sendIntervalFallback) {
      clearInterval(this.sendIntervalFallback);
      this.sendIntervalFallback = null;
    }
    this.getUpdatePayload = null;
    this.onBackgroundTick = null;
  }

  emitPeriodicStateUpdate() {
    if (typeof this.onBackgroundTick === 'function') {
      try {
        this.onBackgroundTick();
      } catch (e) {}
    }
    if (!this.socket || !this.socket.connected) return;
    if (typeof this.getUpdatePayload === 'function') {
      const state = this.getUpdatePayload();
      if (state) {
        this.lastPeriodicSendTime = Date.now();
        this.sendPlayerUpdate(state);
      }
    }
  }

  sendPlayerUpdate(compactData) {
    if (!this.socket || !this.socket.connected) return;

    const emitUpdate = () => {
      this.packetsOutCounter++;
      this.sendRateCounter++;
      this.socket.volatile.emit('state', compactData);
      this.socket.volatile.emit('player_update', compactData);
    };

    if (this.simulatedPacketLoss > 0 && Math.random() < this.simulatedPacketLoss) {
      return;
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
    this.stopSendLoop();
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