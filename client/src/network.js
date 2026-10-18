// Socket.IO Network Manager for Online 1v1 Arena Matches
// Supports Clock Offset Sync, Single Listener Registration, Reconnection States, and Weapon Synchronization
import { io } from 'socket.io-client';
import { CONFIG } from './config.js';

export class NetworkManager {
  constructor() {
    this.socket = null;
    this.connectionState = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
    this.roomCode = null;
    this.playerNumber = null;
    this.playerName = 'Player 1';
    this.pingMs = 0;
    this.serverClockOffset = 0; // Local time + offset = Server time
    this.pingInterval = null;
    this.hasRegisteredListeners = false;

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
    this.onDisconnect = null;
  }

  setConnectionState(state) {
    this.connectionState = state;
    if (this.onConnectionStatusChange) {
      this.onConnectionStatusChange(state);
    }
  }

  connect(serverUrl = CONFIG.NETWORK.SERVER_URL) {
    if (this.socket && (this.socket.connected || this.connectionState === 'connecting')) {
      return;
    }

    this.setConnectionState('connecting');

    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 4000,
      timeout: 10000
    });

    this.registerSocketListeners();
  }

  registerSocketListeners() {
    if (!this.socket || this.hasRegisteredListeners) return;
    this.hasRegisteredListeners = true;

    this.socket.on('connect', () => {
      this.setConnectionState('connected');
      this.startPingMonitor();
    });

    this.socket.on('reconnect_attempt', () => {
      this.setConnectionState('reconnecting');
    });

    this.socket.on('reconnect', () => {
      this.setConnectionState('connected');
    });

    this.socket.on('reconnect_failed', () => {
      this.setConnectionState('disconnected');
      if (this.onDisconnect) this.onDisconnect('Connection to server lost. Please try again.');
    });

    this.socket.on('disconnect', (reason) => {
      this.setConnectionState(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
      this.stopPingMonitor();
      if (this.onDisconnect && reason === 'io client disconnect') {
        this.onDisconnect(reason);
      }
    });

    this.socket.on('server_shutdown', (data) => {
      this.setConnectionState('disconnected');
      if (this.onOpponentLeft) {
        this.onOpponentLeft({ message: data?.message || 'Server restarting. Returning to menu...' });
      } else if (this.onDisconnect) {
        this.onDisconnect(data?.message || 'Server restarting. Returning to menu...');
      }
    });

    this.socket.on('match_countdown', (data) => {
      if (this.onMatchCountdown) this.onMatchCountdown(data);
    });

    this.socket.on('match_start', (data) => {
      this.roomCode = data.roomCode;
      if (this.onMatchStart) this.onMatchStart(data);
    });

    this.socket.on('world_state', (data) => {
      if (this.onWorldState) this.onWorldState(data);
    });

    this.socket.on('hit_confirmed', (data) => {
      if (this.onHitConfirmed) this.onHitConfirmed(data);
    });

    this.socket.on('damage_taken', (data) => {
      if (this.onDamageTaken) this.onDamageTaken(data);
    });

    this.socket.on('kill_cam', (data) => {
      if (this.onKillCam) this.onKillCam(data);
    });

    this.socket.on('kill_cam_end', (data) => {
      if (this.onKillCamEnd) this.onKillCamEnd(data);
    });

    this.socket.on('player_killed', (data) => {
      if (this.onPlayerKilled) this.onPlayerKilled(data);
    });

    this.socket.on('player_respawned', (data) => {
      if (this.onPlayerRespawned) this.onPlayerRespawned(data);
    });

    this.socket.on('match_over', (data) => {
      if (this.onMatchOver) this.onMatchOver(data);
    });

    this.socket.on('match_restarted', (data) => {
      if (this.onMatchRestarted) this.onMatchRestarted(data);
    });

    this.socket.on('rematch_update', (data) => {
      if (this.onRematchUpdate) this.onRematchUpdate(data);
    });

    this.socket.on('opponent_left', (data) => {
      if (this.onOpponentLeft) this.onOpponentLeft(data);
    });

    this.socket.on('opponent_switch_weapon', (data) => {
      if (this.onOpponentSwitchWeapon) this.onOpponentSwitchWeapon(data);
    });

    this.socket.on('pong_check', (payload) => {
      const now = Date.now();
      const sentTime = typeof payload === 'number' ? payload : payload.clientTimestamp;
      const rtt = Math.max(1, now - sentTime);
      this.pingMs = rtt;

      if (payload && typeof payload === 'object' && payload.serverTimestamp) {
        // Calculate clock offset between local machine and game server
        this.serverClockOffset = payload.serverTimestamp - (sentTime + rtt / 2);
      }

      if (this.onPingUpdate) this.onPingUpdate(this.pingMs);
    });
  }

  startPingMonitor() {
    this.stopPingMonitor();
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.connected) {
        this.socket.emit('ping_check', Date.now());
      }
    }, 2000);
  }

  stopPingMonitor() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
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

  sendPlayerUpdate(playerData) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('player_update', playerData);
    }
  }

  sendSwitchWeapon(weaponId) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('player_switch_weapon', weaponId);
    }
  }

  sendShoot(shootData) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('player_shoot', shootData);
    }
  }

  sendRematch() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('rematch');
    }
  }

  disconnect() {
    this.stopPingMonitor();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.hasRegisteredListeners = false;
      this.setConnectionState('disconnected');
    }
  }
}
