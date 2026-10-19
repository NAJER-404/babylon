// Server-side Room, Player & Combat Lifecycle Manager
const SPAWN_POINTS = [
  { x: -62, y: 1.2, z: -62, rotY: Math.PI / 4 },
  { x: 62, y: 1.2, z: 62, rotY: (5 * Math.PI) / 4 },
  { x: -62, y: 1.2, z: 62, rotY: (7 * Math.PI) / 4 },
  { x: 62, y: 1.2, z: -62, rotY: (3 * Math.PI) / 4 }
];

const WIN_SCORE = 10;
const BODY_DAMAGE = 100;
const HEAD_DAMAGE = 200;
const LEG_DAMAGE = 80;
const MELEE_DAMAGE = 100;
const MELEE_MAX_DISTANCE = 2.7;
const KILL_CAM_DURATION_MS = 6000; 
const RESPAWN_DELAY_AFTER_KILLCAM_MS = 1200;
const SPAWN_PROTECTION_MS = 2000;
const ROOM_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_REWIND_MS = 500;
const POSITION_HISTORY_SIZE = 35;

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.playerToRoom = new Map();
    this.debugHitboxSubscribers = new Set();
    this.processedShots = new Map();
    
    // --- NEW: Matchmaking Queue ---
    this.matchmakingQueue = []; // Array of { socket, playerName, socketId }

    setInterval(() => this.cleanupInactiveRooms(), 5 * 60 * 1000);
    setInterval(() => this.cleanupProcessedShots(), 10 * 1000);
  }

  // --- NEW: Matchmaking Logic ---
  addToMatchmaking(socket, rawName) {
    const playerName = this.sanitizeName(rawName, 'Player');
    
    // Check if already in queue
    if (this.matchmakingQueue.some(p => p.socketId === socket.id)) return;

    // Check if someone is waiting
    if (this.matchmakingQueue.length > 0) {
      const opponent = this.matchmakingQueue.shift(); // Remove them from queue
      
      // Create room for opponent
      const res1 = this.createRoom(opponent.socket, opponent.playerName);
      
      // Join room for current player
      const res2 = this.joinRoom(socket, res1.roomCode, playerName);
      
      // Notify both players they found a match
      this.io.to(opponent.socketId).emit('match_found', {
        ...res1, opponentName: playerName
      });
      this.io.to(socket.id).emit('match_found', {
        ...res2, opponentName: opponent.playerName
      });
    } else {
      // Add to queue and wait
      this.matchmakingQueue.push({ socket, playerName, socketId: socket.id });
      socket.emit('matchmaking_status', { status: 'searching' });
    }
  }

  removeFromMatchmaking(socketId) {
    this.matchmakingQueue = this.matchmakingQueue.filter(p => p.socketId !== socketId);
  }

  setDebugHitboxesSubscription(socketId, enabled) {
    if (enabled) this.debugHitboxSubscribers.add(socketId);
    else this.debugHitboxSubscribers.delete(socketId);
  }

  cleanupProcessedShots() {
    const now = Date.now();
    for (const [id, time] of this.processedShots.entries()) {
      if (now - time > 10000) this.processedShots.delete(id);
    }
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    let attempts = 0;
    do {
      code = '';
      for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
      attempts++;
      if (attempts > 1000) break;
    } while (this.rooms.has(code));
    return code;
  }

  sanitizeName(name, fallback = 'Player') {
    if (!name || typeof name !== 'string') return fallback;
    const clean = name.trim().replace(/[<>\"\'&]/g, '').slice(0, 12);
    return clean.length > 0 ? clean : fallback;
  }

  createRoom(socket, rawName = 'Player 1') {
    this.leaveCurrentRoom(socket.id);
    const playerName = this.sanitizeName(rawName, 'Player 1');
    const roomCode = this.generateRoomCode();
    const player = {
      socketId: socket.id, playerNumber: 1, name: playerName, health: 100, kills: 0, deaths: 0, isAlive: true, isProtected: false, protectedUntil: 0,
      position: { ...SPAWN_POINTS[0] }, rotation: { x: 0, y: SPAWN_POINTS[0].rotY }, activeWeapon: 'sniper', isScoped: false, isCrouching: false, isSprinting: false,
      rematchReady: false, lastActiveTime: Date.now(), lastShotTime: 0, lastMeleeTime: 0, positionHistory: []
    };
    const room = {
      code: roomCode, status: 'waiting', players: new Map([[socket.id, player]]), playerList: [player],
      createdAt: Date.now(), lastActivity: Date.now(), startTime: null, countdownTimer: null, killCamTimer: null, respawnTimers: new Map(), lastBroadcastState: new Map()
    };
    this.rooms.set(roomCode, room);
    this.playerToRoom.set(socket.id, roomCode);
    socket.join(roomCode);
    return { roomCode, playerNumber: 1, playerName, spawn: SPAWN_POINTS[0] };
  }

  cancelRoom(socketId) {
    this.removeFromMatchmaking(socketId);
    const roomCode = this.playerToRoom.get(socketId);
    if (!roomCode) return { success: false, error: 'No active room' };
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.status === 'waiting') {
      this.clearRoomTimers(room);
      this.rooms.delete(roomCode);
      this.playerToRoom.delete(socketId);
      return { success: true };
    } else {
      this.handleDisconnect(socketId);
      return { success: true };
    }
  }

  joinRoom(socket, rawCode, rawName = 'Player 2') {
    if (!rawCode || typeof rawCode !== 'string') return { error: 'Invalid room code format' };
    const cleanCode = rawCode.trim().toUpperCase();
    if (cleanCode.length !== 4) return { error: 'Room code must be exactly 4 letters' };
    const room = this.rooms.get(cleanCode);
    if (!room) return { error: 'Room not found' };
    if (room.players.size >= 2 || room.status !== 'waiting') return { error: 'Room is already full or in match' };

    this.leaveCurrentRoom(socket.id);
    let playerName = this.sanitizeName(rawName, 'Player 2');
    const p1 = room.playerList[0];
    if (playerName.toLowerCase() === p1.name.toLowerCase()) playerName = `${playerName} (2)`;

    const player = {
      socketId: socket.id, playerNumber: 2, name: playerName, health: 100, kills: 0, deaths: 0, isAlive: true, isProtected: false, protectedUntil: 0,
      position: { ...SPAWN_POINTS[1] }, rotation: { x: 0, y: SPAWN_POINTS[1].rotY }, activeWeapon: 'sniper', isScoped: false, isCrouching: false, isSprinting: false,
      rematchReady: false, lastActiveTime: Date.now(), lastShotTime: 0, lastMeleeTime: 0, positionHistory: []
    };
    room.players.set(socket.id, player);
    room.playerList.push(player);
    room.lastActivity = Date.now();
    this.playerToRoom.set(socket.id, cleanCode);
    socket.join(cleanCode);
    this.startMatchCountdown(room);
    return { roomCode: cleanCode, playerNumber: 2, playerName, spawn: SPAWN_POINTS[1] };
  }

  startMatchCountdown(room) {
    room.status = 'countdown';
    let count = 3;
    const p1 = room.playerList[0];
    const p2 = room.playerList[1];
    const matchInfo = {
      roomCode: room.code,
      players: [
        { socketId: p1.socketId, playerNumber: 1, name: p1.name, spawn: SPAWN_POINTS[0] },
        { socketId: p2.socketId, playerNumber: 2, name: p2.name, spawn: SPAWN_POINTS[1] }
      ],
      winScore: WIN_SCORE
    };
    this.io.to(room.code).emit('match_countdown', { count: 3, ...matchInfo });
    room.countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        this.io.to(room.code).emit('match_countdown', { count, ...matchInfo });
      } else {
        clearInterval(room.countdownTimer);
        room.countdownTimer = null;
        room.status = 'playing';
        room.startTime = Date.now();
        room.lastActivity = Date.now();
        for (const p of room.playerList) {
          p.lastActiveTime = Date.now();
          p._lastMovementCheckTime = Date.now();
          p.positionHistory = [];
          p._hasLoggedStall = false;
        }
        for (const p of room.playerList) {
          const opp = room.playerList.find(x => x.socketId !== p.socketId) || p;
          this.io.to(p.socketId).emit('match_start', {
            ...matchInfo, localId: p.socketId, remoteId: opp.socketId, playerId: p.socketId, matchStartServerTime: room.startTime, duration: 600, serverTimestamp: room.startTime
          });
        }
        this.io.to(room.code).emit('match_start', { ...matchInfo, matchStartServerTime: room.startTime, duration: 600, serverTimestamp: room.startTime });
      }
    }, 1000);
  }

  updatePlayerState(socketId, data) {
    if (!data) return;
    const roomCode = this.playerToRoom.get(socketId);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room) return;
    const player = room.players.get(socketId);
    if (!player) return;

    const now = Date.now();
    room.lastActivity = now;
    player.lastActiveTime = now;
    player._hasLoggedStall = false;
    player.lastClientTimestamp = data.t || data.timestamp || now;

    if (!player.isAlive) return;

    let newX, newY, newZ, newVx, newVy, newVz, newYaw, newPitch, activeWep, isScoped, isCrouching, isSprinting, onGround, swing, seq;
    seq = data.seq !== undefined ? Number(data.seq) : (player.seq || 0);

    if (data.x !== undefined) {
      newX = Number(data.x); newY = Number(data.y); newZ = Number(data.z);
      newVx = Number(data.vx || 0); newVy = Number(data.vy || 0); newVz = Number(data.vz || 0);
      newYaw = Number(data.yaw !== undefined ? data.yaw : (data.ry || 0));
      newPitch = Number(data.pitch !== undefined ? data.pitch : (data.rx || 0));
      activeWep = (data.weapon === 'knife' || data.w === 1 || data.w === 'knife') ? 'knife' : 'sniper';
      isScoped = !!(data.scoped || data.s);
      isCrouching = !!(data.crouch || data.c);
      isSprinting = !!(data.sprint || data.sp);
      onGround = data.onGround !== undefined ? !!data.onGround : true;
      swing = !!data.swing;
    } else {
      newX = Number(data.position?.x ?? player.position.x);
      newY = Number(data.position?.y ?? player.position.y);
      newZ = Number(data.position?.z ?? player.position.z);
      newVx = Number(data.velocity?.x ?? player.velocity?.x ?? 0);
      newVy = Number(data.velocity?.y ?? player.velocity?.y ?? 0);
      newVz = Number(data.velocity?.z ?? player.velocity?.z ?? 0);
      newYaw = Number(data.rotation?.y ?? player.rotation.y);
      newPitch = Number(data.rotation?.x ?? player.rotation.x);
      activeWep = data.activeWeapon || player.activeWeapon;
      isScoped = !!data.isScoped; isCrouching = !!data.isCrouching; isSprinting = !!data.isSprinting;
      onGround = true; swing = false;
    }

    if (!Number.isFinite(newX) || !Number.isFinite(newY) || !Number.isFinite(newZ)) return;
    newX = Math.max(-78, Math.min(78, newX));
    newY = Math.max(0.2, Math.min(30, newY));
    newZ = Math.max(-78, Math.min(78, newZ));

    const baseSprintSpeed = activeWep === 'knife' ? 12.5 : 7.5;
    const maxAllowedSpeed = baseSprintSpeed * 1.35 + 3.0;
    const dt = Math.max(0.016, (now - (player._lastMovementCheckTime || now)) / 1000);
    player._lastMovementCheckTime = now;
    const distMoved = Math.hypot(newX - player.position.x, newZ - player.position.z);
    const maxAllowedDist = maxAllowedSpeed * dt;

    if (distMoved > maxAllowedDist + 3.0 && distMoved > 6.0) {
      this.io.to(socketId).volatile.emit('position_correction', {
        position: { ...player.position }, x: player.position.x, y: player.position.y, z: player.position.z
      });
      return;
    }

    player.position.x = newX; player.position.y = newY; player.position.z = newZ;
    player.velocity = { x: newVx, y: newVy, z: newVz };
    player.rotation.x = newPitch; player.rotation.y = newYaw;
    player.yaw = newYaw; player.pitch = newPitch;
    player.activeWeapon = activeWep; player.isScoped = isScoped;
    player.isCrouching = isCrouching; player.isSprinting = isSprinting;
    player.onGround = onGround; player.swing = swing; player.seq = seq; player.lastUpdate = now;

    player.positionHistory.push({
      timestamp: now, position: { x: newX, y: newY, z: newZ }, velocity: { x: newVx, y: newVy, z: newVz },
      rotation: { x: newPitch, y: newYaw }, yaw: newYaw, pitch: newPitch, isCrouching, isAlive: player.isAlive, isProtected: player.isProtected && now < player.protectedUntil
    });
    if (player.positionHistory.length > POSITION_HISTORY_SIZE) player.positionHistory.shift();
  }

  updatePlayer(socketId, data) { return this.updatePlayerState(socketId, data); }

  switchWeapon(socketId, weaponId) {
    const roomCode = this.playerToRoom.get(socketId);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room) return;
    const player = room.players.get(socketId);
    if (!player) return;
    player.activeWeapon = weaponId === 'knife' ? 'knife' : 'sniper';
    this.io.to(roomCode).emit('opponent_switch_weapon', { socketId, playerNumber: player.playerNumber, weaponId: player.activeWeapon });
  }

  handleShoot(socketId, shootData) {
    const roomCode = this.playerToRoom.get(socketId);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;
    const shooter = room.players.get(socketId);
    if (!shooter || !shooter.isAlive) return;

    const now = Date.now();
    room.lastActivity = now;
    const shotId = shootData.shotId || `shot_${now}_${Math.floor(Math.random() * 10000)}`;

    if (this.processedShots.has(shotId)) return;
    this.processedShots.set(shotId, now);

    let target = null;
    for (const [id, p] of room.players) { if (id !== socketId) { target = p; break; } }

    const weaponType = shootData.weaponType || shooter.activeWeapon || 'sniper';

    if (weaponType === 'sniper') {
      if (now - shooter.lastShotTime < 1350) { this.logShot(shooter, shotId, 0, 0, false, null, 'rate limit'); return; }
      shooter.lastShotTime = now;
    } else {
      if (now - shooter.lastMeleeTime < 550) { this.logShot(shooter, shotId, 0, 0, false, null, 'rate limit'); return; }
      shooter.lastMeleeTime = now;
    }

    if (!target) { this.logShot(shooter, shotId, 0, 0, false, null, 'no_target'); return; }
    if (!target.isAlive) { this.logShot(shooter, shotId, 0, 0, false, null, 'dead'); return; }
    if (target.isProtected && now < target.protectedUntil) { this.logShot(shooter, shotId, 0, 0, false, null, 'protected'); return; }
    else if (target.isProtected && now >= target.protectedUntil) target.isProtected = false;

    const origin = shootData.origin || shooter.position;

    const clientEst = Number(shootData.estimatedServerTime || shootData.timestamp || (now - 120));
    const targetShotTime = Math.max(now - MAX_REWIND_MS, Math.min(now, clientEst - 100));
    const rewindMs = Math.max(0, now - targetShotTime);

    const rewound = this.samplePlayerHistory(target, targetShotTime);
    const targetPos = rewound.position;
    const isCrouching = rewound.isCrouching;

    if (weaponType === 'knife') {
      const dist = Math.hypot(shooter.position.x - targetPos.x, shooter.position.y - targetPos.y, shooter.position.z - targetPos.z);
      if (dist <= MELEE_MAX_DISTANCE) {
        this.logShot(shooter, shotId, rewindMs, dist, true, 'torso', '');
        const hitPoint = { x: targetPos.x, y: targetPos.y + 1.2, z: targetPos.z };
        this.applyDamageAndCheckKill(room, shooter, target, MELEE_DAMAGE, 'torso', hitPoint, 'knife', shootData, rewound);
      } else {
        this.logShot(shooter, shotId, rewindMs, dist, false, null, 'out_of_range');
      }
      return;
    }

    const direction = shootData.direction;
    if (!direction) { this.logShot(shooter, shotId, rewindMs, 0, false, null, 'invalid'); return; }

    const hitResult = this.checkHit(origin, direction, targetPos, isCrouching);
    const distToTarget = Math.hypot(origin.x - targetPos.x, origin.z - targetPos.z);

    if (hitResult.hit) {
      let finalPart = hitResult.part; 
      if (shootData.hitPart === 'head' || shootData.hitPart === 'torso' || shootData.hitPart === 'legs') finalPart = shootData.hitPart; 

      let damage = BODY_DAMAGE;
      if (finalPart === 'head') damage = HEAD_DAMAGE;
      else if (finalPart === 'legs') damage = LEG_DAMAGE;

      this.logShot(shooter, shotId, rewindMs, distToTarget, true, finalPart, '');
      this.applyDamageAndCheckKill(room, shooter, target, damage, finalPart, hitResult.point, 'sniper', shootData, rewound);
    } else {
      this.logShot(shooter, shotId, rewindMs, distToTarget, false, null, 'no line');
    }
  }

  logShot(shooter, shotId, rewindMs, dist, hit, part, reason = '') {
    const shooterShort = (shooter.socketId || 'unknown').slice(0, 8);
    const resultStr = hit ? `HIT [${part}]` : `MISS ["${reason}"]`;
    console.log(`[SHOT LOG] shooter: ${shooterShort}, shotId: ${shotId}, rewind: ${Math.round(rewindMs)}ms, dist: ${dist.toFixed(1)}m, result: ${resultStr}`);
    if (shooter.socketId) {
      this.io.to(shooter.socketId).emit('shot_result', {
        shotId, hit, part: part || null, reason: hit ? `HIT (${part})` : reason, rewindMs: Math.round(rewindMs), distance: Math.round(dist)
      });
    }
  }

  samplePlayerHistory(player, targetTime) {
    const hist = player.positionHistory;
    if (!hist || hist.length === 0) {
      return { position: { ...player.position }, rotation: { ...player.rotation }, isCrouching: !!player.isCrouching };
    }
    if (targetTime <= hist[0].timestamp) {
      return { position: { ...hist[0].position }, rotation: { ...hist[0].rotation }, isCrouching: hist[0].isCrouching };
    }
    const latest = hist[hist.length - 1];
    if (targetTime >= latest.timestamp) {
      return { position: { ...player.position }, rotation: { ...player.rotation }, isCrouching: !!player.isCrouching };
    }
    for (let i = 0; i < hist.length - 1; i++) {
      const s0 = hist[i]; const s1 = hist[i + 1];
      if (s0.timestamp <= targetTime && targetTime <= s1.timestamp) {
        const span = s1.timestamp - s0.timestamp;
        const alpha = span > 0 ? (targetTime - s0.timestamp) / span : 1.0;
        return {
          position: {
            x: s0.position.x + (s1.position.x - s0.position.x) * alpha,
            y: s0.position.y + (s1.position.y - s0.position.y) * alpha,
            z: s0.position.z + (s1.position.z - s0.position.z) * alpha
          },
          rotation: { x: s0.rotation.x + (s1.rotation.x - s0.rotation.x) * alpha, y: s0.rotation.y + (s1.rotation.y - s0.rotation.y) * alpha },
          isCrouching: alpha > 0.5 ? s1.isCrouching : s0.isCrouching
        };
      }
    }
    return { position: { ...player.position }, rotation: { ...player.rotation }, isCrouching: !!player.isCrouching };
  }

  applyDamageAndCheckKill(room, shooter, target, damage, hitPart, hitPoint, weaponType, shootData, rewoundVictimState) {
    target.health = Math.max(0, target.health - damage);
    this.io.to(shooter.socketId).emit('hit_confirmed', { part: hitPart, damage, targetHealth: target.health, hitPoint, weaponType, shotId: shootData.shotId });
    this.io.to(target.socketId).emit('damage_taken', { damage, newHealth: target.health, attackerPosition: shooter.position, part: hitPart, weaponType });

    if (target.health <= 0) {
      target.isAlive = false;
      shooter.kills += 1;
      target.deaths += 1;
      const killId = `kill_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const serverTimestamp = Date.now();

      this.io.to(room.code).emit('kill_cam', {
        killId, serverTimestamp, durationMs: KILL_CAM_DURATION_MS,
        shooterId: shooter.socketId, shooterNumber: shooter.playerNumber, shooterName: shooter.name,
        shooterPos: shootData.origin || { ...shooter.position },
        shooterRot: { ...shooter.rotation },
        victimId: target.socketId, victimNumber: target.playerNumber, victimName: target.name,
        victimPos: rewoundVictimState?.position || { ...target.position },
        victimRot: rewoundVictimState?.rotation || { ...target.rotation },
        hitPoint, hitPart, weaponType, isHeadshot: hitPart === 'head'
      });

      setTimeout(() => {
        if (!this.rooms.has(room.code)) return;
        const scores = { p1Kills: room.playerList[0].kills, p2Kills: room.playerList[1].kills };
        this.io.to(room.code).emit('kill_cam_end', { killId, killerId: shooter.socketId, killerNumber: shooter.playerNumber, victimId: target.socketId, victimNumber: target.playerNumber, hitPart, scores });
        this.io.to(room.code).emit('player_killed', { killerId: shooter.socketId, killerNumber: shooter.playerNumber, victimId: target.socketId, victimNumber: target.playerNumber, hitPart, scores });

        if (shooter.kills >= WIN_SCORE) {
          room.status = 'ended';
          this.io.to(room.code).emit('match_over', { winnerNumber: shooter.playerNumber, winnerName: shooter.name, finalScores: scores });
        } else {
          this.scheduleRespawn(room, target, shooter);
        }
      }, KILL_CAM_DURATION_MS);
    }
  }

  scheduleRespawn(room, victim, killer) {
    const timerId = setTimeout(() => {
      if (!this.rooms.has(room.code)) return;
      let bestSpawn = SPAWN_POINTS[0]; let maxDistSq = -1;
      for (const sp of SPAWN_POINTS) {
        const dx = sp.x - killer.position.x; const dz = sp.z - killer.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > maxDistSq) { maxDistSq = distSq; bestSpawn = sp; }
      }
      victim.position = { x: bestSpawn.x, y: bestSpawn.y, z: bestSpawn.z };
      victim.rotation = { x: 0, y: bestSpawn.rotY };
      victim.health = 100; victim.isAlive = true; victim.isProtected = true;
      victim.protectedUntil = Date.now() + SPAWN_PROTECTION_MS;
      victim.lastActiveTime = Date.now(); victim._lastMovementCheckTime = Date.now(); victim.positionHistory = [];

      this.io.to(room.code).emit('player_respawned', { socketId: victim.socketId, playerNumber: victim.playerNumber, spawn: bestSpawn, protectedDurationMs: SPAWN_PROTECTION_MS });
      setTimeout(() => { if (victim.isAlive) victim.isProtected = false; }, SPAWN_PROTECTION_MS);
    }, RESPAWN_DELAY_AFTER_KILLCAM_MS);
    room.respawnTimers.set(victim.socketId, timerId);
  }

  handleRematch(socketId) {
    const roomCode = this.playerToRoom.get(socketId);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'ended') return;
    const player = room.players.get(socketId);
    if (!player) return;

    player.rematchReady = true;
    this.io.to(roomCode).emit('rematch_update', { playerNumber: player.playerNumber, ready: true });

    const allReady = Array.from(room.players.values()).every(p => p.rematchReady);
    if (allReady && room.players.size === 2) {
      room.playerList.forEach((p, idx) => {
        p.health = 100; p.kills = 0; p.deaths = 0; p.isAlive = true; p.isProtected = false; p.rematchReady = false; p.activeWeapon = 'sniper';
        p.position = { ...SPAWN_POINTS[idx] }; p.rotation = { x: 0, y: SPAWN_POINTS[idx].rotY }; p.positionHistory = [];
      });
      room.status = 'playing'; room.startTime = Date.now(); room.lastActivity = Date.now();
      this.io.to(roomCode).emit('match_restarted', { roomCode, players: room.playerList.map((p, idx) => ({ socketId: p.socketId, playerNumber: p.playerNumber, name: p.name, spawn: SPAWN_POINTS[idx] })) });
    }
  }

  handleDisconnect(socketId) {
    this.removeFromMatchmaking(socketId); // <-- Clean up queue
    const roomCode = this.playerToRoom.get(socketId);
    this.debugHitboxSubscribers.delete(socketId);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    this.playerToRoom.delete(socketId);
    if (room) {
      room.players.delete(socketId);
      this.clearRoomTimers(room);
      if (room.players.size === 0) this.rooms.delete(roomCode);
      else { this.io.to(roomCode).emit('opponent_left', { message: 'Opponent left the match' }); room.status = 'ended'; }
    }
  }

  leaveCurrentRoom(socketId) { const existingCode = this.playerToRoom.get(socketId); if (existingCode) this.handleDisconnect(socketId); }

  clearRoomTimers(room) {
    if (room.countdownTimer) { clearInterval(room.countdownTimer); room.countdownTimer = null; }
    if (room.killCamTimer) { clearTimeout(room.killCamTimer); room.killCamTimer = null; }
    for (const timerId of room.respawnTimers.values()) clearTimeout(timerId);
    room.respawnTimers.clear();
  }

  cleanupInactiveRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (now - room.lastActivity > ROOM_INACTIVITY_TIMEOUT_MS) {
        this.clearRoomTimers(room);
        for (const pid of room.players.keys()) { this.playerToRoom.delete(pid); this.debugHitboxSubscribers.delete(pid); }
        this.rooms.delete(code);
      }
    }
  }

  checkHit(origin, direction, targetPos, isCrouching = false) {
    const len = Math.hypot(direction.x, direction.y, direction.z);
    if (len === 0) return { hit: false };
    const dx = direction.x / len; const dy = direction.y / len; const dz = direction.z / len;
    const dir = { x: dx, y: dy, z: dz };

    const headY = targetPos.y + (isCrouching ? 1.35 : 1.95);
    const headCenter = { x: targetPos.x, y: headY, z: targetPos.z };
    const headHit = this.intersectRaySphere(origin, dir, headCenter, 1.5);

    const bodyMinY = targetPos.y + (isCrouching ? 0.40 : 0.75);
    const bodyMaxY = targetPos.y + (isCrouching ? 1.40 : 1.75);
    const bodyHit = this.intersectRayCylinder(origin, dir, targetPos.x, targetPos.z, bodyMinY, bodyMaxY, 1.0);

    const legsMinY = targetPos.y + 0.05;
    const legsMaxY = targetPos.y + (isCrouching ? 0.40 : 0.75);
    const legsHit = this.intersectRayCylinder(origin, dir, targetPos.x, targetPos.z, legsMinY, legsMaxY, 1.0);

    let hits = [];
    if (headHit.hit) hits.push({ part: 'head', t: headHit.t, point: headHit.point });
    if (bodyHit.hit) hits.push({ part: 'torso', t: bodyHit.t, point: bodyHit.point });
    if (legsHit.hit) hits.push({ part: 'legs', t: legsHit.t, point: legsHit.point });

    if (hits.length === 0) return { hit: false };
    hits.sort((a, b) => a.t - b.t);
    return { hit: true, part: hits[0].part, point: hits[0].point };
  }

  intersectRaySphere(orig, dir, center, radius) {
    const mx = orig.x - center.x; const my = orig.y - center.y; const mz = orig.z - center.z;
    const b = mx * dir.x + my * dir.y + mz * dir.z;
    const c = (mx * mx + my * my + mz * mz) - radius * radius;
    if (c > 0 && b > 0) return { hit: false };
    const disc = b * b - c;
    if (disc < 0) return { hit: false };
    const t = -b - Math.sqrt(disc);
    if (t < 0.1 || t > 250) return { hit: false };
    return { hit: true, t, point: { x: orig.x + dir.x * t, y: orig.y + dir.y * t, z: orig.z + dir.z * t } };
  }

  intersectRayCylinder(orig, dir, cx, cz, minY, maxY, radius) {
    const ox = orig.x - cx; const oz = orig.z - cz;
    const a = dir.x * dir.x + dir.z * dir.z;
    if (a < 1e-6) return { hit: false };
    const b = 2 * (ox * dir.x + oz * dir.z);
    const c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return { hit: false };
    const sqrtDisc = Math.sqrt(disc);
    const t1 = (-b - sqrtDisc) / (2 * a);
    const t2 = (-b + sqrtDisc) / (2 * a);
    let t = t1 > 0.1 ? t1 : (t2 > 0.1 ? t2 : -1);
    if (t < 0.1 || t > 250) return { hit: false };
    const hitY = orig.y + dir.y * t;
    if (hitY >= minY && hitY <= maxY) return { hit: true, t, point: { x: orig.x + dir.x * t, y: hitY, z: orig.z + dir.z * t } };
    return { hit: false };
  }

  broadcastTick() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.status !== 'playing' && room.status !== 'countdown') continue;
      const playersData = []; const debugHitboxData = [];

      for (const p of room.playerList) {
        if (room.status === 'playing' && p.isAlive) {
          const timeSinceUpdate = now - (p.lastActiveTime || now);
          if (timeSinceUpdate > 500 && !p._hasLoggedStall) { p._hasLoggedStall = true; console.warn(`[DEBUG NET] Client updates stalled for player "${p.name}" (${p.socketId}) in room ${code} (${timeSinceUpdate}ms since last packet)`); }
          else if (timeSinceUpdate < 300) p._hasLoggedStall = false;
        }

        p.positionHistory.push({
          timestamp: now, position: { x: p.position.x, y: p.position.y, z: p.position.z }, velocity: { ...(p.velocity || { x: 0, y: 0, z: 0 }) },
          rotation: { x: p.rotation.x, y: p.rotation.y }, yaw: p.yaw !== undefined ? p.yaw : p.rotation.y, pitch: p.pitch !== undefined ? p.pitch : p.rotation.x,
          isCrouching: p.isCrouching, isAlive: p.isAlive, isProtected: p.isProtected && now < p.protectedUntil
        });
        if (p.positionHistory.length > POSITION_HISTORY_SIZE) p.positionHistory.shift();

        const posX = Math.round(p.position.x * 100) / 100; const posY = Math.round(p.position.y * 100) / 100; const posZ = Math.round(p.position.z * 100) / 100;
        const vx = Math.round((p.velocity?.x || 0) * 100) / 100; const vy = Math.round((p.velocity?.y || 0) * 100) / 100; const vz = Math.round((p.velocity?.z || 0) * 100) / 100;
        const yaw = Math.round((p.yaw !== undefined ? p.yaw : p.rotation.y) * 100) / 100; const pitch = Math.round((p.pitch !== undefined ? p.pitch : p.rotation.x) * 100) / 100;

        playersData.push({
          id: p.socketId, socketId: p.socketId, seq: p.seq || 0, num: p.playerNumber, playerNumber: p.playerNumber, name: p.name,
          x: posX, y: posY, z: posZ, yaw, pitch, vx, vy, vz, weapon: p.activeWeapon || 'sniper',
          crouch: p.isCrouching ? 1 : 0, sprint: p.isSprinting ? 1 : 0, scoped: p.isScoped ? 1 : 0, onGround: (p.onGround !== false) ? 1 : 0,
          swing: p.swing ? 1 : 0, alive: p.isAlive ? 1 : 0, hp: p.health,
          position: { x: posX, y: posY, z: posZ }, p: [posX, posY, posZ], velocity: { x: vx, y: vy, z: vz }, v: [vx, vy, vz],
          rx: pitch, ry: yaw, rotation: { x: pitch, y: yaw }, r: [pitch, yaw], w: p.activeWeapon || 'sniper', activeWeapon: p.activeWeapon || 'sniper',
          s: p.isScoped ? 1 : 0, isScoped: !!p.isScoped, c: p.isCrouching ? 1 : 0, isCrouching: !!p.isCrouching, sp: p.isSprinting ? 1 : 0, isSprinting: !!p.isSprinting,
          health: p.health, a: p.isAlive ? 1 : 0, isAlive: !!p.isAlive, pr: (p.isProtected && now < p.protectedUntil) ? 1 : 0, isProtected: !!(p.isProtected && now < p.protectedUntil),
          t: p.lastClientTimestamp || now, timestamp: p.lastClientTimestamp || now
        });

        debugHitboxData.push({
          socketId: p.socketId, x: p.position.x, y: p.position.y, z: p.position.z, crouch: !!p.isCrouching,
          headY: p.position.y + (p.isCrouching ? 1.35 : 1.95), bodyMinY: p.position.y + (p.isCrouching ? 0.40 : 0.75),
          bodyMaxY: p.position.y + (p.isCrouching ? 1.40 : 1.75), legsMinY: p.position.y + 0.05, legsMaxY: p.position.y + (p.isCrouching ? 0.40 : 0.75)
        });
      }

      const broadcastPayload = { serverTime: now, t: now, players: playersData };
      this.io.to(code).volatile.emit('state', broadcastPayload);
      this.io.to(code).volatile.emit('world_state', broadcastPayload);

      for (const [socketId] of room.players) {
        if (this.debugHitboxSubscribers.has(socketId)) {
          this.io.to(socketId).volatile.emit('debug_server_hitboxes', { timestamp: now, hitboxes: debugHitboxData });
        }
      }
    }
  }
}