import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import cors from 'cors';
import { RoomManager } from './rooms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV !== 'production';
const PORT = process.env.PORT || 3000;
const MAX_TOTAL_ROOMS = 100;

const allowedOrigins = [];
if (isDev) {
  allowedOrigins.push('http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000');
}
if (process.env.CLIENT_ORIGIN) {
  allowedOrigins.push(process.env.CLIENT_ORIGIN);
}

const app = express();
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS origin policy blocked request'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '512kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  perMessageDeflate: false,
  httpCompression: false,
  pingInterval: 5000,
  pingTimeout: 10000
});

const roomManager = new RoomManager(io);

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    activeRooms: roomManager.rooms.size,
    uptime: Math.round(process.uptime()),
    timestamp: Date.now()
  });
});

app.post('/api/client-log', (req, res) => {
  console.log('[CLIENT ERROR REPORT]:', JSON.stringify(req.body));
  res.json({ ok: true });
});

const clientDistPath = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(clientDistPath)) {
  console.log(`[Static Host] Serving production client from: ${clientDistPath}`);
  app.use('/assets', express.static(path.join(clientDistPath, 'assets'), { maxAge: '1y', immutable: true }));
  app.use(express.static(clientDistPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
} else {
  console.log(`[Static Host] client/dist not detected. Vite dev server can be used for development.`);
}

const roomRequestRateMap = new Map();
const playerUpdateRateMap = new Map();

function checkRoomRateLimit(socketId) {
  const now = Date.now();
  let timestamps = roomRequestRateMap.get(socketId) || [];
  timestamps = timestamps.filter(t => now - t < 10000);
  if (timestamps.length >= 5) {
    roomRequestRateMap.set(socketId, timestamps);
    return false;
  }
  timestamps.push(now);
  roomRequestRateMap.set(socketId, timestamps);
  return true;
}

function checkUpdateRateLimit(socketId, maxPerSec = 50) {
  const now = Date.now();
  let record = playerUpdateRateMap.get(socketId);
  if (!record || now - record.windowStart > 1000) {
    record = { windowStart: now, count: 1 };
    playerUpdateRateMap.set(socketId, record);
    return true;
  }
  record.count++;
  return record.count <= maxPerSec;
}

io.on('connection', (socket) => {
  const handlePing = (clientTime, callback) => {
    const serverTime = Date.now();
    const cTime = typeof clientTime === 'number' ? clientTime : (clientTime?.clientTime ?? clientTime?.clientTimestamp ?? clientTime?.wallTime ?? Date.now());
    if (typeof callback === 'function') {
      callback({ clientTime: cTime, serverTime });
    } else {
      socket.emit('pong', { clientTime: cTime, serverTime });
      socket.emit('pong_check', { clientTime: cTime, serverTime });
    }
  };
  socket.on('ping', handlePing);
  socket.on('ping_check', handlePing);

  // --- NEW: Matchmaking ---
  socket.on('find_match', (data) => {
    if (!checkRoomRateLimit(socket.id)) return;
    const playerName = data?.playerName || 'Player';
    roomManager.addToMatchmaking(socket, playerName);
  });

  socket.on('cancel_find_match', () => {
    roomManager.removeFromMatchmaking(socket.id);
  });
  // --------------------------

  const handleCreateRoom = (data, callback) => {
    try {
      if (!checkRoomRateLimit(socket.id)) {
        const err = 'Too many requests. Please wait a few seconds.';
        if (typeof callback === 'function') callback({ success: false, error: err });
        else socket.emit('room_error', { message: err });
        return;
      }
      if (roomManager.rooms.size >= MAX_TOTAL_ROOMS) {
        const err = 'Server is currently at maximum room capacity. Please try again later.';
        if (typeof callback === 'function') callback({ success: false, error: err });
        else socket.emit('room_error', { message: err });
        return;
      }
      const rawName = data?.playerName;
      if (rawName !== undefined && typeof rawName !== 'string') {
        const err = 'Invalid player name format';
        if (typeof callback === 'function') callback({ success: false, error: err });
        return;
      }
      const playerName = rawName || 'Player 1';
      const result = roomManager.createRoom(socket, playerName);
      if (typeof callback === 'function') callback({ success: true, ...result });
      else socket.emit('room_created', result);
    } catch (err) {
      if (typeof callback === 'function') callback({ success: false, error: err.message });
      else socket.emit('room_error', { message: err.message });
    }
  };
  socket.on('create_room', handleCreateRoom);
  socket.on('createRoom', handleCreateRoom);

  const handleCancelRoom = (callback) => {
    try {
      const result = roomManager.cancelRoom(socket.id);
      if (typeof callback === 'function') callback(result);
    } catch (err) {
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  };
  socket.on('cancel_room', handleCancelRoom);
  socket.on('cancelRoom', handleCancelRoom);

  const handleJoinRoom = (data, callback) => {
    try {
      if (!checkRoomRateLimit(socket.id)) {
        const err = 'Too many requests. Please wait a few seconds.';
        if (typeof callback === 'function') callback({ success: false, error: err });
        else socket.emit('join_error', { message: err });
        return;
      }
      const roomCode = data?.roomCode;
      const playerName = data?.playerName || 'Player 2';
      if (!roomCode || typeof roomCode !== 'string' || !/^[A-Za-z]{4}$/.test(roomCode.trim())) {
        const err = 'Invalid room code format. Must be 4 letters.';
        if (typeof callback === 'function') callback({ success: false, error: err });
        else socket.emit('join_error', { message: err });
        return;
      }
      if (typeof playerName !== 'string' || playerName.length > 20) {
        const err = 'Invalid player name';
        if (typeof callback === 'function') callback({ success: false, error: err });
        else socket.emit('join_error', { message: err });
        return;
      }
      const result = roomManager.joinRoom(socket, roomCode, playerName);
      if (result.error) {
        if (typeof callback === 'function') callback({ success: false, error: result.error });
        else socket.emit('join_error', { message: result.error });
      } else {
        if (typeof callback === 'function') callback({ success: true, ...result });
        else socket.emit('room_joined', result);
      }
    } catch (err) {
      if (typeof callback === 'function') callback({ success: false, error: err.message });
      else socket.emit('join_error', { message: err.message });
    }
  };
  socket.on('join_room', handleJoinRoom);
  socket.on('joinRoom', handleJoinRoom);

  const handlePlayerState = (data) => {
    if (!checkUpdateRateLimit(socket.id, 60)) return;
    if (!data || typeof data !== 'object') return;
    roomManager.updatePlayerState(socket.id, data);
  };
  socket.on('state', handlePlayerState);
  socket.on('player_update', handlePlayerState);

  socket.on('player_switch_weapon', (weaponId) => {
    if (weaponId !== 'sniper' && weaponId !== 'knife') return;
    roomManager.switchWeapon(socket.id, weaponId);
  });

  socket.on('player_shoot', (shootData) => {
    if (!checkUpdateRateLimit(socket.id, 20)) return;
    if (!shootData || typeof shootData !== 'object') return;
    roomManager.handleShoot(socket.id, shootData);
  });

  socket.on('debug_subscribe_hitboxes', (enabled) => {
    roomManager.setDebugHitboxesSubscription(socket.id, !!enabled);
  });

  socket.on('rematch', () => {
    roomManager.handleRematch(socket.id);
  });

  socket.on('disconnect', () => {
    roomRequestRateMap.delete(socket.id);
    playerUpdateRateMap.delete(socket.id);
    roomManager.handleDisconnect(socket.id);
  });
});

const TICK_INTERVAL_MS = 33.333;
let nextTickTarget = Date.now() + TICK_INTERVAL_MS;

function scheduleNextServerTick() {
  const now = Date.now();
  try {
    roomManager.broadcastTick();
  } catch (err) {
    console.error('[Server Tick Error]:', err);
  }
  nextTickTarget += TICK_INTERVAL_MS;
  if (now - nextTickTarget > 100) nextTickTarget = now + TICK_INTERVAL_MS;
  const delay = Math.max(1, Math.min(50, nextTickTarget - now));
  setTimeout(scheduleNextServerTick, delay);
}
scheduleNextServerTick();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Babylon Arena Server] Initialized`);
  console.log(`[Environment] NODE_ENV = ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Host] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[Tick Rate] Broadcasting at ~${Math.round(1000 / TICK_INTERVAL_MS)} Hz (drift-corrected)`);
  console.log(`[Capacity] Max active rooms: ${MAX_TOTAL_ROOMS}`);
});

function gracefulShutdown(signal) {
  console.log(`\n[Server] Received ${signal}. Notifying active players and closing sockets...`);
  io.emit('server_shutdown', { message: 'Server is restarting for an update. Returning to menu...' });
  io.close(() => {
    server.close(() => {
      console.log('[Server] HTTP and Socket.IO shutdown completed cleanly.');
      process.exit(0);
    });
  });
  setTimeout(() => { console.error('[Server] Forced shutdown timeout exceeded. Exiting.'); process.exit(1); }, 4000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));