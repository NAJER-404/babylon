// Server-side Room, Player & Combat Lifecycle Manager for Babylon 1v1 Arena FPS
// Supports Sniper, Combat Knife, Synchronized Dual Kill Cam, and 3-2-1 Match Countdown

const SPAWN_POINTS = [
  { x: -62, y: 1.2, z: -62, rotY: Math.PI / 4 },       // Spawn 1: SW Red corner
  { x: 62, y: 1.2, z: 62, rotY: (5 * Math.PI) / 4 },   // Spawn 2: NE Blue corner
  { x: -62, y: 1.2, z: 62, rotY: (7 * Math.PI) / 4 },  // Spawn 3: NW fallback
  { x: 62, y: 1.2, z: -62, rotY: (3 * Math.PI) / 4 }   // Spawn 4: SE fallback
];

const WIN_SCORE = 10;
const BODY_DAMAGE = 100;
const HEAD_DAMAGE = 200;
const LEG_DAMAGE = 80;
const MELEE_DAMAGE = 100;
const MELEE_MAX_DISTANCE = 2.5; // 2.2m reach + 0.3m network tolerance
const KILL_CAM_DURATION_MS = 3500; // 3.5s synchronized kill cam replay
const RESPAWN_DELAY_AFTER_KILLCAM_MS = 1200; // Fast respawn after replay ends
const SPAWN_PROTECTION_MS = 2000;
const ROOM_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomCode -> roomData
    this.playerToRoom = new Map(); // socketId -> roomCode

    // Periodically clean inactive rooms every 5 minutes
    setInterval(() => this.cleanupInactiveRooms(), 5 * 60 * 1000);
  }

  // Generates 4-letter uppercase code excluding ambiguous chars (no 0/O, no 1/I)
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // 24 letters
    let code = '';
    let attempts = 0;
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
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
    // If player already in a room, leave it first
    this.leaveCurrentRoom(socket.id);

    const playerName = this.sanitizeName(rawName, 'Player 1');
    const roomCode = this.generateRoomCode();

    const player = {
      socketId: socket.id,
      playerNumber: 1,
      name: playerName,
      health: 100,
      kills: 0,
      deaths: 0,
      isAlive: true,
      isProtected: false,
      protectedUntil: 0,
      position: { ...SPAWN_POINTS[0] },
      rotation: { x: 0, y: SPAWN_POINTS[0].rotY },
      activeWeapon: 'sniper',
      isScoped: false,
      rematchReady: false,
      lastActiveTime: Date.now()
    };

    const room = {
      code: roomCode,
      status: 'waiting', // 'waiting' | 'countdown' | 'playing' | 'killcam' | 'ended'
      players: new Map([[socket.id, player]]),
      playerList: [player],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      startTime: null,
      countdownTimer: null,
      killCamTimer: null,
      respawnTimers: new Map()
    };

    this.rooms.set(roomCode, room);
    this.playerToRoom.set(socket.id, roomCode);
    socket.join(roomCode);

    return {
      roomCode,
      playerNumber: 1,
      playerName,
      spawn: SPAWN_POINTS[0]
    };
  }

  cancelRoom(socketId) {
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
    if (!rawCode || typeof rawCode !== 'string') {
      return { error: 'Invalid room code format' };
    }

    const cleanCode = rawCode.trim().toUpperCase();
    if (cleanCode.length !== 4) {
      return { error: 'Room code must be exactly 4 letters' };
    }

    const room = this.rooms.get(cleanCode);
    if (!room) {
      return { error: 'Room not found' };
    }

    if (room.players.size >= 2 || room.status !== 'waiting') {
      return { error: 'Room is already full or in match' };
    }

    // Leave any prior room
    this.leaveCurrentRoom(socket.id);

    let playerName = this.sanitizeName(rawName, 'Player 2');
    const p1 = room.playerList[0];

    // If identical names, disambiguate cleanly
    if (playerName.toLowerCase() === p1.name.toLowerCase()) {
      playerName = `${playerName} (2)`;
    }

    const player = {
      socketId: socket.id,
      playerNumber: 2,
      name: playerName,
      health: 100,
      kills: 0,
      deaths: 0,
      isAlive: true,
      isProtected: false,
      protectedUntil: 0,
      position: { ...SPAWN_POINTS[1] },
      rotation: { x: 0, y: SPAWN_POINTS[1].rotY },
      activeWeapon: 'sniper',
      isScoped: false,
      rematchReady: false,
      lastActiveTime: Date.now()
    };

    room.players.set(socket.id, player);
    room.playerList.push(player);
    room.lastActivity = Date.now();
    this.playerToRoom.set(socket.id, cleanCode);
    socket.join(cleanCode);

    // Start 3-2-1 Synchronized Countdown Sequence
    this.startMatchCountdown(room);

    return {
      roomCode: cleanCode,
      playerNumber: 2,
      playerName,
      spawn: SPAWN_POINTS[1]
    };
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

    // Broadcast count 3 immediately
    this.io.to(room.code).emit('match_countdown', {
      count: 3,
      ...matchInfo
    });

    room.countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        this.io.to(room.code).emit('match_countdown', {
          count,
          ...matchInfo
        });
      } else {
        clearInterval(room.countdownTimer);
        room.countdownTimer = null;
        room.status = 'playing';
        room.startTime = Date.now();
        room.lastActivity = Date.now();

        // Release both players simultaneously
        this.io.to(room.code).emit('match_start', {
          ...matchInfo,
          serverTimestamp: Date.now()
        });
      }
    }, 1000);
  }

  updatePlayer(socketId, data) {
    const roomCode = this.playerToRoom.get(socketId);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const player = room.players.get(socketId);
    if (!player || !player.isAlive) return;

    room.lastActivity = Date.now();
    player.lastActiveTime = Date.now();

    if (data.position && typeof data.position.x === 'number') {
      player.position.x = data.position.x;
      player.position.y = data.position.y;
      player.position.z = data.position.z;
    }
    if (data.rotation && typeof data.rotation.y === 'number') {
      player.rotation.x = data.rotation.x || 0;
      player.rotation.y = data.rotation.y;
    }
    if (data.activeWeapon) {
      player.activeWeapon = data.activeWeapon;
    }
    if (data.isScoped !== undefined) {
      player.isScoped = !!data.isScoped;
    }
    player.lastClientTimestamp = data.timestamp;
  }

  switchWeapon(socketId, weaponId) {
    const roomCode = this.playerToRoom.get(socketId);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const player = room.players.get(socketId);
    if (!player) return;

    player.activeWeapon = weaponId === 'knife' ? 'knife' : 'sniper';
    socket.to(roomCode).emit('opponent_switch_weapon', {
      socketId,
      playerNumber: player.playerNumber,
      weaponId: player.activeWeapon
    });
  }

  handleShoot(socketId, shootData) {
    const roomCode = this.playerToRoom.get(socketId);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const shooter = room.players.get(socketId);
    if (!shooter || !shooter.isAlive) return;

    // Find the opponent
    let target = null;
    for (const [id, p] of room.players) {
      if (id !== socketId) {
        target = p;
        break;
      }
    }

    if (!target || !target.isAlive) return;

    const now = Date.now();
    room.lastActivity = now;

    // Check target spawn protection
    if (target.isProtected && now < target.protectedUntil) {
      return;
    } else if (target.isProtected && now >= target.protectedUntil) {
      target.isProtected = false;
    }

    const weaponType = shootData.weaponType || shooter.activeWeapon || 'sniper';

    // 1. MELEE KNIFE ATTACK
    if (weaponType === 'knife') {
      const dist = Math.hypot(
        shooter.position.x - target.position.x,
        shooter.position.y - target.position.y,
        shooter.position.z - target.position.z
      );

      if (dist <= MELEE_MAX_DISTANCE) {
        // Lethal knife hit
        const hitPoint = {
          x: target.position.x,
          y: target.position.y + 1.2,
          z: target.position.z
        };

        this.applyDamageAndCheckKill(
          room,
          shooter,
          target,
          MELEE_DAMAGE,
          'body',
          hitPoint,
          'knife',
          shootData
        );
      }
      return;
    }

    // 2. SNIPER HITSCAN RAYCAST
    const { origin, direction } = shootData;
    if (!origin || !direction) return;

    const hitResult = this.checkHit(origin, direction, target.position);
    if (hitResult.hit) {
      let damage = BODY_DAMAGE;
      if (hitResult.part === 'head') {
        damage = HEAD_DAMAGE;
      } else if (hitResult.part === 'legs') {
        damage = LEG_DAMAGE;
      }

      this.applyDamageAndCheckKill(
        room,
        shooter,
        target,
        damage,
        hitResult.part,
        hitResult.point,
        'sniper',
        shootData
      );
    }
  }

  applyDamageAndCheckKill(room, shooter, target, damage, hitPart, hitPoint, weaponType, shootData) {
    target.health = Math.max(0, target.health - damage);

    // Confirm hit to shooter
    this.io.to(shooter.socketId).emit('hit_confirmed', {
      part: hitPart,
      damage,
      targetHealth: target.health,
      hitPoint,
      weaponType
    });

    // Notify victim of damage taken
    this.io.to(target.socketId).emit('damage_taken', {
      damage,
      newHealth: target.health,
      attackerPosition: shooter.position,
      part: hitPart,
      weaponType
    });

    // Check for elimination
    if (target.health <= 0) {
      target.isAlive = false;
      shooter.kills += 1;
      target.deaths += 1;

      const killId = `kill_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const serverTimestamp = Date.now();

      // Broadcast SYNCHRONIZED Kill Cam to BOTH clients!
      this.io.to(room.code).emit('kill_cam', {
        killId,
        serverTimestamp,
        durationMs: KILL_CAM_DURATION_MS,
        shooterId: shooter.socketId,
        shooterNumber: shooter.playerNumber,
        victimId: target.socketId,
        victimNumber: target.playerNumber,
        origin: shootData.origin || shooter.position,
        hitPoint,
        hitPart,
        weaponType
      });

      // After kill cam replay concludes, apply scores and trigger respawn
      setTimeout(() => {
        if (!this.rooms.has(room.code)) return;

        const scores = {
          p1Kills: room.playerList[0].kills,
          p2Kills: room.playerList[1].kills
        };

        // Notify both clients that kill replay has finished and scores update
        this.io.to(room.code).emit('kill_cam_end', {
          killId,
          killerId: shooter.socketId,
          killerNumber: shooter.playerNumber,
          victimId: target.socketId,
          victimNumber: target.playerNumber,
          hitPart,
          scores
        });

        this.io.to(room.code).emit('player_killed', {
          killerId: shooter.socketId,
          killerNumber: shooter.playerNumber,
          victimId: target.socketId,
          victimNumber: target.playerNumber,
          hitPart,
          scores
        });

        // Check victory condition
        if (shooter.kills >= WIN_SCORE) {
          room.status = 'ended';
          this.io.to(room.code).emit('match_over', {
            winnerNumber: shooter.playerNumber,
            winnerName: shooter.name,
            finalScores: scores
          });
        } else {
          this.scheduleRespawn(room, target, shooter);
        }
      }, KILL_CAM_DURATION_MS);
    }
  }

  scheduleRespawn(room, victim, killer) {
    const timerId = setTimeout(() => {
      if (!this.rooms.has(room.code)) return;

      // Select spawn point furthest from killer
      let bestSpawn = SPAWN_POINTS[0];
      let maxDistSq = -1;

      for (const sp of SPAWN_POINTS) {
        const dx = sp.x - killer.position.x;
        const dz = sp.z - killer.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > maxDistSq) {
          maxDistSq = distSq;
          bestSpawn = sp;
        }
      }

      victim.position = { x: bestSpawn.x, y: bestSpawn.y, z: bestSpawn.z };
      victim.rotation = { x: 0, y: bestSpawn.rotY };
      victim.health = 100;
      victim.isAlive = true;
      victim.isProtected = true;
      victim.protectedUntil = Date.now() + SPAWN_PROTECTION_MS;

      this.io.to(room.code).emit('player_respawned', {
        socketId: victim.socketId,
        playerNumber: victim.playerNumber,
        spawn: bestSpawn,
        protectedDurationMs: SPAWN_PROTECTION_MS
      });

      // Clear protection after SPAWN_PROTECTION_MS (2 seconds)
      setTimeout(() => {
        if (victim.isAlive) {
          victim.isProtected = false;
        }
      }, SPAWN_PROTECTION_MS);

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
    this.io.to(roomCode).emit('rematch_update', {
      playerNumber: player.playerNumber,
      ready: true
    });

    // If both players have accepted rematch, reset match state completely
    const allReady = Array.from(room.players.values()).every(p => p.rematchReady);
    if (allReady && room.players.size === 2) {
      room.playerList.forEach((p, idx) => {
        p.health = 100;
        p.kills = 0;
        p.deaths = 0;
        p.isAlive = true;
        p.isProtected = false;
        p.rematchReady = false;
        p.activeWeapon = 'sniper';
        p.position = { ...SPAWN_POINTS[idx] };
        p.rotation = { x: 0, y: SPAWN_POINTS[idx].rotY };
      });
      room.status = 'playing';
      room.startTime = Date.now();
      room.lastActivity = Date.now();

      this.io.to(roomCode).emit('match_restarted', {
        roomCode,
        players: room.playerList.map((p, idx) => ({
          socketId: p.socketId,
          playerNumber: p.playerNumber,
          name: p.name,
          spawn: SPAWN_POINTS[idx]
        }))
      });
    }
  }

  handleDisconnect(socketId) {
    const roomCode = this.playerToRoom.get(socketId);
    if (!roomCode) return;

    const room = this.rooms.get(roomCode);
    this.playerToRoom.delete(socketId);

    if (room) {
      room.players.delete(socketId);
      this.clearRoomTimers(room);

      if (room.players.size === 0) {
        this.rooms.delete(roomCode);
      } else {
        // Notify remaining opponent
        this.io.to(roomCode).emit('opponent_left', {
          message: 'Opponent left the match'
        });
        room.status = 'ended';
      }
    }
  }

  leaveCurrentRoom(socketId) {
    const existingCode = this.playerToRoom.get(socketId);
    if (existingCode) {
      this.handleDisconnect(socketId);
    }
  }

  clearRoomTimers(room) {
    if (room.countdownTimer) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
    }
    if (room.killCamTimer) {
      clearTimeout(room.killCamTimer);
      room.killCamTimer = null;
    }
    for (const timerId of room.respawnTimers.values()) {
      clearTimeout(timerId);
    }
    room.respawnTimers.clear();
  }

  cleanupInactiveRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (now - room.lastActivity > ROOM_INACTIVITY_TIMEOUT_MS) {
        this.clearRoomTimers(room);
        for (const pid of room.players.keys()) {
          this.playerToRoom.delete(pid);
        }
        this.rooms.delete(code);
      }
    }
  }

  // Hitbox math: Head (sphere), Body (cylinder), Legs (lower cylinder)
  checkHit(origin, direction, targetPos) {
    const len = Math.hypot(direction.x, direction.y, direction.z);
    if (len === 0) return { hit: false };
    const dx = direction.x / len;
    const dy = direction.y / len;
    const dz = direction.z / len;
    const dir = { x: dx, y: dy, z: dz };

    // 1. Head Hitbox: Sphere at y + 1.55, radius 0.40
    const headCenter = { x: targetPos.x, y: targetPos.y + 1.55, z: targetPos.z };
    const headHit = this.intersectRaySphere(origin, dir, headCenter, 0.40);

    // 2. Body / Torso Hitbox: Cylinder from y + 0.85 to y + 1.45, radius 0.50
    const bodyHit = this.intersectRayCylinder(origin, dir, targetPos.x, targetPos.z, targetPos.y + 0.85, targetPos.y + 1.45, 0.50);

    // 3. Legs Hitbox: Cylinder from y + 0.05 to y + 0.85, radius 0.45
    const legsHit = this.intersectRayCylinder(origin, dir, targetPos.x, targetPos.z, targetPos.y + 0.05, targetPos.y + 0.85, 0.45);

    let hits = [];
    if (headHit.hit) hits.push({ part: 'head', t: headHit.t, point: headHit.point });
    if (bodyHit.hit) hits.push({ part: 'body', t: bodyHit.t, point: bodyHit.point });
    if (legsHit.hit) hits.push({ part: 'legs', t: legsHit.t, point: legsHit.point });

    if (hits.length === 0) return { hit: false };

    // Pick hit closest to ray origin
    hits.sort((a, b) => a.t - b.t);
    return {
      hit: true,
      part: hits[0].part,
      point: hits[0].point
    };
  }

  intersectRaySphere(orig, dir, center, radius) {
    const mx = orig.x - center.x;
    const my = orig.y - center.y;
    const mz = orig.z - center.z;

    const b = mx * dir.x + my * dir.y + mz * dir.z;
    const c = (mx * mx + my * my + mz * mz) - radius * radius;

    if (c > 0 && b > 0) return { hit: false };

    const disc = b * b - c;
    if (disc < 0) return { hit: false };

    const t = -b - Math.sqrt(disc);
    if (t < 0.2 || t > 180) return { hit: false };

    return {
      hit: true,
      t,
      point: {
        x: orig.x + dir.x * t,
        y: orig.y + dir.y * t,
        z: orig.z + dir.z * t
      }
    };
  }

  intersectRayCylinder(orig, dir, cx, cz, minY, maxY, radius) {
    const ox = orig.x - cx;
    const oz = orig.z - cz;

    const a = dir.x * dir.x + dir.z * dir.z;
    if (a < 1e-6) return { hit: false };

    const b = 2 * (ox * dir.x + oz * dir.z);
    const c = ox * ox + oz * oz - radius * radius;

    const disc = b * b - 4 * a * c;
    if (disc < 0) return { hit: false };

    const sqrtDisc = Math.sqrt(disc);
    const t1 = (-b - sqrtDisc) / (2 * a);
    const t2 = (-b + sqrtDisc) / (2 * a);

    let t = t1 > 0.2 ? t1 : (t2 > 0.2 ? t2 : -1);
    if (t < 0.2 || t > 180) return { hit: false };

    const hitY = orig.y + dir.y * t;
    if (hitY >= minY && hitY <= maxY) {
      return {
        hit: true,
        t,
        point: {
          x: orig.x + dir.x * t,
          y: hitY,
          z: orig.z + dir.z * t
        }
      };
    }

    return { hit: false };
  }

  broadcastTick() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.status !== 'playing' && room.status !== 'countdown') continue;

      const playersData = [];
      for (const p of room.playerList) {
        playersData.push({
          socketId: p.socketId,
          playerNumber: p.playerNumber,
          name: p.name,
          position: p.position,
          rotation: p.rotation,
          activeWeapon: p.activeWeapon,
          isScoped: p.isScoped,
          health: p.health,
          kills: p.kills,
          deaths: p.deaths,
          isAlive: p.isAlive,
          isProtected: p.isProtected && now < p.protectedUntil
        });
      }

      this.io.to(code).emit('world_state', {
        timestamp: now,
        players: playersData
      });
    }
  }
}
