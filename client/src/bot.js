// Finite-State Machine AI Bot for Practice Mode with Throttled 10Hz LoS Raycasts & 160x160 Waypoints
import {
  Vector3,
  Ray,
  MeshBuilder,
  Color3
} from '@babylonjs/core';
import { CONFIG } from './config.js';

export const BOT_STATE = {
  PATROL: 'patrol',
  CHASE: 'chase',
  STRAFE: 'strafe',
  TAKE_COVER: 'take_cover'
};

export class BotAI {
  constructor(scene, character, player, audioManager, difficulty = 'medium') {
    this.scene = scene;
    this.character = character;
    this.player = player;
    this.audio = audioManager;

    this.setDifficulty(difficulty);

    this.state = BOT_STATE.PATROL;
    this.stateTimer = 0;
    this.reactionTimer = 0;
    this.lastShotTime = 0;
    this.strafeDirection = 1;
    this.strafeChangeTimer = 0;

    // Movement & Kinematics
    this.velocity = new Vector3(0, 0, 0);
    this.targetWaypoint = null;
    this.targetCoverMesh = null;

    // Performance: Throttled Line-of-Sight check (10 Hz, not every frame!)
    this.losTimer = 0;
    this.cachedLoS = false;

    // Pre-allocated Tracer Mesh for Bot shots (no GC!)
    this.tracerMesh = MeshBuilder.CreateLines(
      'botTracerMesh',
      { points: [new Vector3(0, 0, 0), new Vector3(0, 0, 1)], updatable: true },
      this.scene
    );
    this.tracerMesh.color = new Color3(1.0, 0.45, 0.2);
    this.tracerMesh.isPickable = false;
    this.tracerMesh.isVisible = false;
    this.tracerTimer = 0;

    // 160x160 Arena Tactical Waypoints
    this.waypoints = [
      new Vector3(-45, 0, -45),
      new Vector3(45, 0, -45),
      new Vector3(-45, 0, 45),
      new Vector3(45, 0, 45),
      new Vector3(0, 4.5, 48),    // North sniper watchtower
      new Vector3(0, 4.5, -48),   // South sniper watchtower
      new Vector3(50, 3.5, 0),    // East flank bunker
      new Vector3(-50, 3.5, 0),   // West flank bunker
      new Vector3(0, 1.8, 0),     // Center courtyard hub
      new Vector3(-25, 0, 25),
      new Vector3(25, 0, -25),
      new Vector3(0, 0, 35),      // Tower approaches
      new Vector3(0, 0, -35),
      new Vector3(-35, 0, 0),
      new Vector3(35, 0, 0)
    ];

    this.pickNextWaypoint();
  }

  setDifficulty(diffKey) {
    this.difficultyKey = diffKey;
    this.config = CONFIG.BOT.DIFFICULTIES[diffKey] || CONFIG.BOT.DIFFICULTIES.medium;
  }

  pickNextWaypoint() {
    const idx = Math.floor(Math.random() * this.waypoints.length);
    this.targetWaypoint = this.waypoints[idx].clone();
  }

  update(deltaTime, coverMeshes = []) {
    if (!this.character.isAlive) return;

    const dt = Math.min(0.05, Math.max(0.001, deltaTime / 1000));
    const botPos = this.character.position;
    const playerPos = this.player.camera.position;

    const toPlayer = playerPos.subtract(botPos);
    const distToPlayer = Math.hypot(toPlayer.x, toPlayer.z);

    // Performance: Throttled LoS check running at ~8-10 Hz instead of every frame
    this.losTimer += dt;
    if (this.losTimer >= 0.12) {
      this.losTimer = 0;
      this.cachedLoS = this.checkLineOfSight(botPos, playerPos);
    }
    const hasLoS = this.cachedLoS;

    // Decay tracer visibility
    if (this.tracerTimer > 0) {
      this.tracerTimer -= dt;
      if (this.tracerTimer <= 0) {
        this.tracerMesh.isVisible = false;
      }
    }

    this.updateFSM(dt, distToPlayer, hasLoS, coverMeshes);
    this.updateAiming(dt, toPlayer, hasLoS, playerPos);

    if (hasLoS && this.player.isAlive) {
      this.reactionTimer += dt * 1000;
      if (this.reactionTimer >= this.config.reactionTimeMs) {
        this.attemptShoot(botPos, playerPos);
      }
    } else {
      this.reactionTimer = 0;
    }

    this.applyMovement(dt);
  }

  checkLineOfSight(fromPos, toPos) {
    const eyeFrom = new Vector3(fromPos.x, fromPos.y + 1.5, fromPos.z);
    const eyeTo = new Vector3(toPos.x, toPos.y, toPos.z);
    const dir = eyeTo.subtract(eyeFrom);
    const len = dir.length();
    if (len < 0.1) return true;

    const ray = new Ray(eyeFrom, dir.normalize(), len);

    // Filtered pick predicate: skip enemy hitboxes, check only world cover/colliders
    const pick = this.scene.pickWithRay(ray, mesh => {
      if (!mesh.isPickable) return false;
      if (mesh.metadata && mesh.metadata.isHitbox) return false;
      return mesh.checkCollisions;
    });

    if (pick && pick.hit && pick.distance < len - 0.5) {
      return false;
    }

    return true;
  }

  updateFSM(dt, distToPlayer, hasLoS, coverMeshes) {
    this.stateTimer += dt;
    this.strafeChangeTimer += dt;

    if (this.character.health < this.config.coverThresholdHp && coverMeshes.length > 0) {
      if (this.state !== BOT_STATE.TAKE_COVER) {
        this.state = BOT_STATE.TAKE_COVER;
        this.stateTimer = 0;
        this.findNearestCover(coverMeshes);
      }
    }

    switch (this.state) {
      case BOT_STATE.TAKE_COVER:
        if (this.targetCoverMesh) {
          const coverPos = this.targetCoverMesh.position;
          const awayDir = coverPos.subtract(this.player.camera.position).normalize();
          const safeSpot = coverPos.add(new Vector3(awayDir.x * 2.5, 0, awayDir.z * 2.5));
          this.moveTo(safeSpot, this.config.strafeSpeed);

          const distToSafe = Math.hypot(this.character.position.x - safeSpot.x, this.character.position.z - safeSpot.z);
          if (distToSafe < 1.2 || this.stateTimer > 4.0) {
            this.state = hasLoS ? BOT_STATE.STRAFE : BOT_STATE.CHASE;
            this.stateTimer = 0;
          }
        } else {
          this.state = BOT_STATE.CHASE;
        }
        break;

      case BOT_STATE.STRAFE:
        if (!hasLoS) {
          this.state = BOT_STATE.CHASE;
          this.stateTimer = 0;
          break;
        }

        if (this.strafeChangeTimer > 1.2 + Math.random() * 0.8) {
          this.strafeDirection *= -1;
          this.strafeChangeTimer = 0;
        }

        const toPlayer = this.player.camera.position.subtract(this.character.position);
        const forward = new Vector3(toPlayer.x, 0, toPlayer.z).normalize();
        const right = new Vector3(-forward.z, 0, forward.x);

        let wishDir = right.scale(this.strafeDirection);
        if (distToPlayer > 30) {
          wishDir = wishDir.add(forward.scale(0.5)).normalize();
        } else if (distToPlayer < 12) {
          wishDir = wishDir.subtract(forward.scale(0.6)).normalize();
        }

        this.velocity.x = wishDir.x * this.config.strafeSpeed;
        this.velocity.z = wishDir.z * this.config.strafeSpeed;
        break;

      case BOT_STATE.CHASE:
        if (hasLoS && distToPlayer < 35) {
          this.state = BOT_STATE.STRAFE;
          this.stateTimer = 0;
          break;
        }

        this.moveTo(this.player.camera.position, this.config.strafeSpeed * 1.1);

        if (this.stateTimer > 6.0 && !hasLoS) {
          this.state = BOT_STATE.PATROL;
          this.pickNextWaypoint();
          this.stateTimer = 0;
        }
        break;

      case BOT_STATE.PATROL:
      default:
        if (hasLoS) {
          this.state = BOT_STATE.STRAFE;
          this.stateTimer = 0;
          break;
        }

        if (this.targetWaypoint) {
          this.moveTo(this.targetWaypoint, this.config.strafeSpeed * 0.7);
          const distToWp = Math.hypot(
            this.character.position.x - this.targetWaypoint.x,
            this.character.position.z - this.targetWaypoint.z
          );
          if (distToWp < 2.0 || this.stateTimer > 7.0) {
            this.pickNextWaypoint();
            this.stateTimer = 0;
          }
        }
        break;
    }
  }

  moveTo(targetPos, speed) {
    const dx = targetPos.x - this.character.position.x;
    const dz = targetPos.z - this.character.position.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.1) {
      this.velocity.x = (dx / len) * speed;
      this.velocity.z = (dz / len) * speed;
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
  }

  findNearestCover(coverMeshes) {
    let closest = null;
    let minDist = 999;
    for (const c of coverMeshes) {
      const d = Vector3.Distance(this.character.position, c.position);
      if (d < minDist && d > 2.0) {
        minDist = d;
        closest = c;
      }
    }
    this.targetCoverMesh = closest;
  }

  updateAiming(dt, toPlayer, hasLoS, playerPos) {
    let targetAngle = this.character.rootNode.rotation.y;
    if (hasLoS || this.state === BOT_STATE.STRAFE) {
      targetAngle = Math.atan2(toPlayer.x, toPlayer.z);
      this.character.setAimTarget(playerPos);
    } else {
      if (Math.hypot(this.velocity.x, this.velocity.z) > 0.1) {
        targetAngle = Math.atan2(this.velocity.x, this.velocity.z);
      }
      this.character.aimPitch = 0;
    }

    this.character.rootNode.rotation.y = this.character.lerpAngle(
      this.character.rootNode.rotation.y,
      targetAngle,
      this.config.turnRate * dt
    );
  }

  attemptShoot(botPos, playerPos) {
    const now = performance.now();
    if (now - this.lastShotTime < this.config.fireBurstIntervalMs) return;

    this.lastShotTime = now;

    if (!this.player.isAlive || this.player.isProtected) return;

    // Sniper audio and muzzle flash
    this.audio.playSniperShot();
    this.character.triggerShotVisual();

    const muzzleOrigin = this.character.getMuzzleWorldPosition();
    let targetAim = playerPos.clone();

    const isMiss = Math.random() < this.config.missChance;

    if (isMiss) {
      const jitterDist = 1.0 + Math.random() * 2.2;
      const angle = Math.random() * Math.PI * 2;
      targetAim.x += Math.cos(angle) * jitterDist;
      targetAim.y += (Math.random() - 0.5) * jitterDist;
      targetAim.z += Math.sin(angle) * jitterDist;
    }

    const shotDir = targetAim.subtract(muzzleOrigin).normalize();
    const endPoint = muzzleOrigin.add(shotDir.scale(80));

    // Update pooled tracer
    this.showTracer(muzzleOrigin, isMiss ? endPoint : playerPos);

    if (!isMiss) {
      const isHeadshot = Math.random() < 0.20;
      const part = isHeadshot ? 'head' : 'body';
      const damage = isHeadshot ? CONFIG.WEAPONS.SNIPER.HEAD_DAMAGE : CONFIG.WEAPONS.SNIPER.BODY_DAMAGE;

      this.player.takeDamage(damage, botPos, part);
    }
  }

  showTracer(startPoint, endPoint) {
    this.tracerMesh = MeshBuilder.CreateLines(
      'botTracerMesh',
      { points: [startPoint, endPoint], instance: this.tracerMesh }
    );
    this.tracerMesh.isVisible = true;
    this.tracerTimer = 0.08;
  }

  applyMovement(dt) {
    const pos = this.character.rootNode.position;

    pos.x += this.velocity.x * dt;
    pos.z += this.velocity.z * dt;

    const limit = (CONFIG.GAME.MAP_SIZE / 2) - 2.0;
    pos.x = Math.max(-limit, Math.min(limit, pos.x));
    pos.z = Math.max(-limit, Math.min(limit, pos.z));

    this.character.position.copyFrom(pos);

    const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.character.update(dt * 1000, currentSpeed);
  }

  dispose() {
    if (this.tracerMesh) {
      this.tracerMesh.dispose();
      this.tracerMesh = null;
    }
  }
}
