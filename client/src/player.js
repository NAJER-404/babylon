// First-Person Player Controller: Kinematics Tied to Active Weapon (Sniper vs Combat Knife)
// Centralized InputManager, Stamina, Deadzone Deceleration & Scope Integration
import {
  UniversalCamera,
  MeshBuilder,
  Vector3
} from '@babylonjs/core';
import { CONFIG } from './config.js';
import { inputManager } from './inputManager.js';

export class PlayerController {
  constructor(scene, canvas, audioManager) {
    this.scene = scene;
    this.canvas = canvas;
    this.audio = audioManager;

    // Movement kinematics
    this.velocity = new Vector3(0, 0, 0);
    this.isGrounded = true;
    this.isSprinting = false;
    this.isMoving = false;
    this.isCrouching = false;
    this.currentEyeHeight = CONFIG.PLAYER.EYE_HEIGHT;

    // Sprint Stamina System (5s endurance, 1.8s regen delay)
    this.stamina = CONFIG.PLAYER.SPRINT_STAMINA_MAX;
    this.staminaRegenDelayTimer = 0;

    // Camera look angles (radians)
    this.yaw = 0;
    this.pitch = 0;
    this.invertY = false;
    this.mouseSensitivity = CONFIG.PLAYER.DEFAULT_SENSITIVITY;
    this.baseFov = CONFIG.PLAYER.DEFAULT_FOV;
    this.isPointerLocked = false;

    // Head-bobbing
    this.bobTimer = 0;

    // Player stats
    this.health = CONFIG.GAME.MAX_HEALTH;
    this.isAlive = true;
    this.isProtected = false;
    this.protectedUntil = 0;
    this.playerNumber = 1;

    // Active weapon reference & Scope integration
    this.weaponSystem = null;
    this.isInputLocked = false;
    this.scopeOverlay = null;

    // Callbacks
    this.onShootCallback = null;
    this.onReloadCallback = null;
    this.onDamageCallback = null;
    this.onPointerLockChangeCallback = null;
    this.onStaminaChangeCallback = null;
    this.onSwitchWeaponCallback = null;

    this.setupCamera();
    this.setupInputs();
  }

  setupCamera() {
    this.camera = new UniversalCamera(
      'playerCamera',
      new Vector3(0, CONFIG.PLAYER.EYE_HEIGHT, 0),
      this.scene
    );
    this.camera.fov = CONFIG.PLAYER.DEFAULT_FOV;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 1200;

    this.colliderMesh = MeshBuilder.CreateBox(
      'playerCollider',
      {
        width: CONFIG.PLAYER.COLLIDER_RADIUS * 2,
        height: CONFIG.PLAYER.COLLIDER_HEIGHT,
        depth: CONFIG.PLAYER.COLLIDER_RADIUS * 2
      },
      this.scene
    );
    this.colliderMesh.position.set(0, CONFIG.PLAYER.COLLIDER_HEIGHT / 2, 0);
    this.colliderMesh.checkCollisions = true;
    this.colliderMesh.ellipsoid = new Vector3(
      CONFIG.PLAYER.COLLIDER_RADIUS,
      CONFIG.PLAYER.COLLIDER_HEIGHT / 2,
      CONFIG.PLAYER.COLLIDER_RADIUS
    );
    this.colliderMesh.isVisible = false;
    this.colliderMesh.isPickable = false;

    this.scene.activeCamera = this.camera;
    this.camera.inputs.clear();
  }

  setupInputs() {
    // 1. Pointer Lock Request
    this.canvas.addEventListener('click', () => {
      if (!this.isPointerLocked && this.isAlive && !this.isInputLocked) {
        this.requestPointerLock();
      }
    });

    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === this.canvas;
      if (!this.isPointerLocked) {
        inputManager.clearAll();
        if (this.scopeOverlay) {
          this.scopeOverlay.forceReset();
        }
      }
      if (this.onPointerLockChangeCallback) {
        this.onPointerLockChangeCallback(this.isPointerLocked);
      }
    });

    // 2. Mouse Look
    document.addEventListener('mousemove', (e) => {
      if (!this.isPointerLocked || !this.isAlive || this.isInputLocked) return;

      const movementX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
      const movementY = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
      const signY = this.invertY ? -1 : 1;

      let sens = this.mouseSensitivity;
      if (this.scopeOverlay && this.weaponSystem?.activeWeaponId === 'sniper') {
        sens *= this.scopeOverlay.getSensitivityScale();
      }

      this.yaw += movementX * sens;
      this.pitch += movementY * sens * signY;

      const maxPitch = 1.52;
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
    });

    // 3. Mouse Buttons
    inputManager.on('mousedown', (button) => {
      if (!this.isPointerLocked || this.isInputLocked || !this.isAlive) return;

      if (button === 0) { // Left Click = Fire Sniper or Slash Knife
        if (this.weaponSystem?.activeWeaponId === 'sniper') {
          if (this.scopeOverlay && !this.scopeOverlay.canShoot()) return;
        }
        if (this.onShootCallback) this.onShootCallback();
      } else if (button === 2) { // Right Click = Scope In (Sniper only!)
        if (this.weaponSystem?.activeWeaponId === 'sniper' && this.scopeOverlay) {
          this.scopeOverlay.setScoped(true);
        }
      }
    });

    inputManager.on('mouseup', (button) => {
      if (button === 2) { // Right Click Released = Scope Out
        if (this.scopeOverlay) {
          this.scopeOverlay.setScoped(false);
        }
      }
    });

    // 4. Mouse Wheel Weapon Switching
    inputManager.on('wheel', (delta) => {
      if (!this.isPointerLocked || this.isInputLocked || !this.isAlive) return;
      if (this.weaponSystem?.activeWeaponId === 'sniper') {
        this.attemptWeaponSwitch('knife');
      } else {
        this.attemptWeaponSwitch('sniper');
      }
    });

    // 5. Key Press Triggers
    inputManager.on('keydown', (code) => {
      if (this.isInputLocked && code !== 'Escape' && code !== 'Space') return;

      if (code === 'Digit1' || code === 'Numpad1' || code === 'Key1') {
        this.attemptWeaponSwitch('sniper');
      } else if (code === 'Digit2' || code === 'Numpad2' || code === 'Key2') {
        this.attemptWeaponSwitch('knife');
      } else if (code === 'KeyR') {
        if (this.weaponSystem?.activeWeaponId === 'sniper') {
          if (this.onReloadCallback) this.onReloadCallback();
        }
      } else if (code === 'Escape') {
        if (this.isPointerLocked) {
          this.exitPointerLock();
        }
      } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
        if (this.scopeOverlay && this.scopeOverlay.isScoped() && this.weaponSystem?.activeWeaponId === 'sniper') {
          this.scopeOverlay.setHoldingBreath(true);
        }
      }
    });

    inputManager.on('keyup', (code) => {
      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        if (this.scopeOverlay) {
          this.scopeOverlay.setHoldingBreath(false);
        }
      }
    });

    inputManager.on('cleared', () => {
      this.isMoving = false;
      this.isSprinting = false;
    });
  }

  setWeaponSystem(weaponSystem) {
    this.weaponSystem = weaponSystem;
  }

  attemptWeaponSwitch(targetId) {
    if (!this.weaponSystem || this.weaponSystem.activeWeaponId === targetId) return;
    if (this.weaponSystem.isEquipping || this.weaponSystem.isReloading || this.weaponSystem.isMeleeSwinging) return;

    // Scoping must be cancelled when switching
    if (this.scopeOverlay && this.scopeOverlay.isScoped()) {
      this.scopeOverlay.forceReset();
    }

    const switched = this.weaponSystem.switchWeapon(targetId);
    if (switched && this.onSwitchWeaponCallback) {
      this.onSwitchWeaponCallback(targetId);
    }
  }

  requestPointerLock() {
    this.canvas.requestPointerLock =
      this.canvas.requestPointerLock ||
      this.canvas.mozRequestPointerLock ||
      this.canvas.webkitRequestPointerLock;
    if (this.canvas.requestPointerLock) {
      this.canvas.requestPointerLock();
    }
  }

  exitPointerLock() {
    if (document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  setSensitivity(val) {
    this.mouseSensitivity = Math.max(0.0005, Math.min(0.006, val));
  }

  setFov(val) {
    this.baseFov = Math.max(0.8, Math.min(1.5, val));
  }

  setInvertY(val) {
    this.invertY = !!val;
  }

  setScopeOverlay(overlay) {
    this.scopeOverlay = overlay;
  }

  setInputLocked(locked) {
    this.isInputLocked = !!locked;
    if (this.isInputLocked) {
      inputManager.clearAll();
      this.velocity.set(0, 0, 0);
      this.isMoving = false;
      this.isSprinting = false;
      if (this.scopeOverlay) {
        this.scopeOverlay.forceReset();
      }
    }
  }

  spawnAt(spawnConfig, playerNumber = 1) {
    this.playerNumber = playerNumber;
    this.health = CONFIG.GAME.MAX_HEALTH;
    this.isAlive = true;
    this.isProtected = true;
    this.protectedUntil = performance.now() + CONFIG.GAME.SPAWN_PROTECTION_MS;

    inputManager.clearAll();
    this.velocity.set(0, 0, 0);
    this.stamina = CONFIG.PLAYER.SPRINT_STAMINA_MAX;
    this.isCrouching = false;
    this.isSprinting = false;
    this.isMoving = false;
    this.currentEyeHeight = CONFIG.PLAYER.EYE_HEIGHT;

    if (this.scopeOverlay) {
      this.scopeOverlay.forceReset();
    }

    this.yaw = spawnConfig.rotY !== undefined ? spawnConfig.rotY : 0;
    this.pitch = 0;

    const basePosY = spawnConfig.y || 0;
    const colliderY = basePosY + CONFIG.PLAYER.COLLIDER_HEIGHT / 2;
    this.colliderMesh.position.set(spawnConfig.x, colliderY, spawnConfig.z);

    const eyeY = basePosY + CONFIG.PLAYER.EYE_HEIGHT;
    this.camera.position.set(spawnConfig.x, eyeY, spawnConfig.z);

    this.audio.playRespawn();
  }

  takeDamage(amount, attackerPosition, hitPart = 'body') {
    if (!this.isAlive) return false;

    const now = performance.now();
    if (this.isProtected && now < this.protectedUntil) {
      return false;
    } else if (this.isProtected && now >= this.protectedUntil) {
      this.isProtected = false;
    }

    this.health = Math.max(0, this.health - amount);
    this.audio.playHurt();

    if (this.onDamageCallback) {
      this.onDamageCallback(amount, attackerPosition, hitPart, this.health);
    }

    if (this.health <= 0) {
      this.die();
    }

    return true;
  }

  die() {
    this.isAlive = false;
    this.health = 0;
    this.velocity.set(0, 0, 0);
    inputManager.clearAll();
    if (this.scopeOverlay) {
      this.scopeOverlay.forceReset();
    }
    this.audio.playDeath();
  }

  update(deltaTime, recoilCameraKick = 0) {
    const dt = Math.min(0.05, Math.max(0.001, deltaTime / 1000));
    const now = performance.now();

    // 1. Recoil kick application
    if (recoilCameraKick !== 0) {
      this.pitch -= recoilCameraKick;
    }

    // 2. Camera orientation
    let swayX = 0;
    let swayY = 0;
    if (this.scopeOverlay && this.weaponSystem?.activeWeaponId === 'sniper') {
      swayX = this.scopeOverlay.swayPitch;
      swayY = this.scopeOverlay.swayYaw;
    }
    this.camera.rotation.y = this.yaw + swayY;
    this.camera.rotation.x = this.pitch + swayX;

    // 3. FOV Interpolation
    let targetFov = this.baseFov;
    if (this.scopeOverlay && this.weaponSystem?.activeWeaponId === 'sniper') {
      const blend = this.scopeOverlay.getBlend();
      targetFov = (1.0 - blend) * this.baseFov + blend * CONFIG.WEAPONS.SNIPER.SCOPE_FOV;
    }
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1.0, 18.0 * dt);

    if (!this.isAlive || this.isInputLocked) {
      this.velocity.set(0, 0, 0);
      this.camera.position.x = this.colliderMesh.position.x;
      this.camera.position.y = this.colliderMesh.position.y - (CONFIG.PLAYER.COLLIDER_HEIGHT / 2) + this.currentEyeHeight;
      this.camera.position.z = this.colliderMesh.position.z;
      return;
    }

    if (this.isProtected && now >= this.protectedUntil) {
      this.isProtected = false;
    }

    // 4. Fixed Timestep Physics Simulation at 60 Hz (Part 4)
    const FIXED_DT = 1 / 60;
    const clampedDt = Math.min(0.1, dt);
    this.physicsAccumulator = (this.physicsAccumulator || 0) + clampedDt;

    while (this.physicsAccumulator >= FIXED_DT) {
      this.physicsStep(FIXED_DT);
      this.physicsAccumulator -= FIXED_DT;
    }

    this.currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    // 5. Head-bobbing
    const activeWep = this.weaponSystem?.activeWeaponId || 'sniper';
    const kinematics = CONFIG.PLAYER.KINEMATICS[activeWep] || CONFIG.PLAYER.KINEMATICS.sniper;
    const scopeBlend = (this.scopeOverlay && activeWep === 'sniper') ? this.scopeOverlay.getBlend() : 0;
    const isScoped = scopeBlend > 0.05;

    let bobOffset = 0;
    if (this.isGrounded && this.isMoving && !isScoped) {
      this.bobTimer += dt * CONFIG.PLAYER.HEADBOB_FREQ * (this.currentSpeed / (kinematics.WALK_SPEED || 4.5));
      bobOffset = Math.sin(this.bobTimer) * CONFIG.PLAYER.HEADBOB_AMP;
    } else {
      this.bobTimer = 0;
    }

    this.camera.position.x = this.colliderMesh.position.x;
    this.camera.position.y = this.colliderMesh.position.y - (CONFIG.PLAYER.COLLIDER_HEIGHT / 2) + this.currentEyeHeight + bobOffset;
    this.camera.position.z = this.colliderMesh.position.z;
  }

  physicsStep(dt) {
    // 1. Input Gathering
    let moveX = 0;
    let moveZ = 0;
    if (inputManager.isAnyKeyDown(['KeyW', 'ArrowUp'])) moveZ += 1;
    if (inputManager.isAnyKeyDown(['KeyS', 'ArrowDown'])) moveZ -= 1;
    if (inputManager.isAnyKeyDown(['KeyA', 'ArrowLeft'])) moveX -= 1;
    if (inputManager.isAnyKeyDown(['KeyD', 'ArrowRight'])) moveX += 1;

    const inputLen = Math.hypot(moveX, moveZ);
    this.isMoving = inputLen > 0.01;

    const isShiftHeld = inputManager.isAnyKeyDown(['ShiftLeft', 'ShiftRight']);
    const isCrouchHeld = inputManager.isAnyKeyDown(['KeyC', 'ControlLeft', 'ControlRight']);
    const isJumpPressed = inputManager.isKeyDown('Space');

    const activeWep = this.weaponSystem?.activeWeaponId || 'sniper';
    const kinematics = CONFIG.PLAYER.KINEMATICS[activeWep] || CONFIG.PLAYER.KINEMATICS.sniper;

    const scopeBlend = (this.scopeOverlay && activeWep === 'sniper') ? this.scopeOverlay.getBlend() : 0;
    const isScoped = scopeBlend > 0.05;

    this.isCrouching = isCrouchHeld;

    const canSprint = isShiftHeld && moveZ > 0 && !this.isCrouching && !isScoped && this.stamina > 0.1;
    this.isSprinting = canSprint;

    // 2. Stamina Depletion & Regeneration
    if (this.isSprinting && this.isMoving) {
      this.stamina = Math.max(0, this.stamina - dt);
      this.staminaRegenDelayTimer = CONFIG.PLAYER.SPRINT_STAMINA_REGEN_DELAY;
    } else {
      if (this.staminaRegenDelayTimer > 0) {
        this.staminaRegenDelayTimer -= dt;
      } else {
        this.stamina = Math.min(
          CONFIG.PLAYER.SPRINT_STAMINA_MAX,
          this.stamina + dt * CONFIG.PLAYER.SPRINT_STAMINA_REGEN_RATE
        );
      }
    }

    if (this.onStaminaChangeCallback) {
      this.onStaminaChangeCallback(this.stamina, CONFIG.PLAYER.SPRINT_STAMINA_MAX);
    }

    // 3. Camera Eye Height
    const targetHeight = this.isCrouching ? CONFIG.PLAYER.CROUCH_HEIGHT : CONFIG.PLAYER.EYE_HEIGHT;
    this.currentEyeHeight += (targetHeight - this.currentEyeHeight) * Math.min(1.0, 16.0 * dt);

    // 4. Calculate Desired Target Speed (Part 4: Melee knife walk 7.0 / sprint 12.5 / crouch 4.0)
    let targetSpeed = kinematics.WALK_SPEED;
    if (this.isCrouching) {
      targetSpeed = kinematics.CROUCH_SPEED;
    } else if (this.isSprinting) {
      targetSpeed = kinematics.SPRINT_SPEED;
    }

    // Knife is NEVER affected by sniper scope multiplier
    if (activeWep === 'sniper' && isScoped && this.scopeOverlay) {
      targetSpeed *= this.scopeOverlay.getMoveSpeedMultiplier();
    }

    // 5. World Space Movement Wish Direction
    let wishDir = new Vector3(0, 0, 0);
    if (this.isMoving) {
      const normX = moveX / inputLen;
      const normZ = moveZ / inputLen;
      const sinY = Math.sin(this.yaw);
      const cosY = Math.cos(this.yaw);

      wishDir.x = normX * cosY + normZ * sinY;
      wishDir.z = -normX * sinY + normZ * cosY;
    }

    const targetVx = wishDir.x * (this.isMoving ? targetSpeed : 0);
    const targetVz = wishDir.z * (this.isMoving ? targetSpeed : 0);

    // 6. Snappy Acceleration & Deceleration (Part 4: ~0.1s for knife)
    const baseAccel = kinematics.ACCELERATION || (this.isMoving ? CONFIG.PLAYER.ACCELERATION : CONFIG.PLAYER.DECELERATION);
    const accelRate = this.isGrounded
      ? baseAccel
      : baseAccel * (kinematics.AIR_CONTROL || 0.25);

    this.velocity.x += (targetVx - this.velocity.x) * Math.min(1.0, accelRate * dt);
    this.velocity.z += (targetVz - this.velocity.z) * Math.min(1.0, accelRate * dt);

    const deadzone = CONFIG.PLAYER.VELOCITY_DEADZONE || 0.01;
    if (!this.isMoving) {
      if (Math.abs(this.velocity.x) < deadzone) this.velocity.x = 0;
      if (Math.abs(this.velocity.z) < deadzone) this.velocity.z = 0;
    }

    // 7. Grounded Jump (Part 4: 2x sniper jump velocity for knife = 10.4)
    if (isJumpPressed && this.isGrounded && !this.isCrouching) {
      this.velocity.y = kinematics.JUMP_VELOCITY || CONFIG.PLAYER.JUMP_VELOCITY;
      this.isGrounded = false;
    }

    // 8. Gravity
    this.velocity.y += CONFIG.PLAYER.GRAVITY * dt;

    // 9. Move Player Collider Mesh
    const prevY = this.colliderMesh.position.y;
    const displacement = this.velocity.scale(dt);
    this.colliderMesh.moveWithCollisions(displacement);

    const actualDeltaY = this.colliderMesh.position.y - prevY;
    if (this.velocity.y < 0 && Math.abs(actualDeltaY) < Math.abs(displacement.y) * 0.5) {
      this.isGrounded = true;
      this.velocity.y = 0;
    } else if (actualDeltaY > 0 && this.isGrounded) {
      this.velocity.y = 0;
    } else if (Math.abs(actualDeltaY) > 0.05 && this.velocity.y < -1.0) {
      this.isGrounded = false;
    }

    const minColliderY = CONFIG.PLAYER.COLLIDER_HEIGHT / 2;
    if (this.colliderMesh.position.y < minColliderY) {
      this.colliderMesh.position.y = minColliderY;
      this.velocity.y = 0;
      this.isGrounded = true;
    }

    const arenaBound = (CONFIG.GAME.MAP_SIZE / 2) - 1.2;
    this.colliderMesh.position.x = Math.max(-arenaBound, Math.min(arenaBound, this.colliderMesh.position.x));
    this.colliderMesh.position.z = Math.max(-arenaBound, Math.min(arenaBound, this.colliderMesh.position.z));
  }

  applyPositionCorrection(correctedPos) {
    if (!correctedPos || !this.colliderMesh) return;
    const targetX = correctedPos.x !== undefined ? correctedPos.x : (correctedPos.position?.x ?? this.colliderMesh.position.x);
    const targetY = correctedPos.y !== undefined ? correctedPos.y : (correctedPos.position?.y ?? this.colliderMesh.position.y);
    const targetZ = correctedPos.z !== undefined ? correctedPos.z : (correctedPos.position?.z ?? this.colliderMesh.position.z);

    const dx = targetX - this.colliderMesh.position.x;
    const dz = targetZ - this.colliderMesh.position.z;
    const distErr = Math.hypot(dx, dz);

    if (distErr > 2.0) {
      // Smoothly snap to server authoritative position if discrepancy > 2 units (Part 4)
      this.colliderMesh.position.x = targetX;
      this.colliderMesh.position.y = targetY;
      this.colliderMesh.position.z = targetZ;
      this.camera.position.x = targetX;
      this.camera.position.y = targetY - (CONFIG.PLAYER.COLLIDER_HEIGHT / 2) + this.currentEyeHeight;
      this.camera.position.z = targetZ;
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
  }

  getMovementState() {
    return {
      isMoving: this.isMoving,
      isSprinting: this.isSprinting,
      isCrouching: this.isCrouching,
      isGrounded: this.isGrounded,
      isScoped: (this.scopeOverlay && this.weaponSystem?.activeWeaponId === 'sniper') ? this.scopeOverlay.isScoped() : false,
      speed: this.currentSpeed || Math.hypot(this.velocity.x, this.velocity.z)
    };
  }

  // Section B: 30 Hz Send State Payload (Dedicated Web Worker, heartbeat-safe)
  getSendState(seq = 0, clientTime = Date.now()) {
    const posX = Math.round(this.camera.position.x * 100) / 100;
    const posY = Math.round(this.camera.position.y * 100) / 100;
    const posZ = Math.round(this.camera.position.z * 100) / 100;
    const yaw = Math.round(this.yaw * 100) / 100;
    const pitch = Math.round(this.pitch * 100) / 100;
    const vx = Math.round((this.velocity?.x || 0) * 100) / 100;
    const vz = Math.round((this.velocity?.z || 0) * 100) / 100;

    const isKnife = this.weaponSystem?.activeWeaponId === 'knife';
    const isScoped = (this.scopeOverlay && !isKnife && this.scopeOverlay.isScoped()) ? 1 : 0;
    const swing = this.weaponSystem?.consumeMeleeSwing ? this.weaponSystem.consumeMeleeSwing() : 0;

    return {
      seq,
      t: clientTime,
      x: posX,
      y: posY,
      z: posZ,
      yaw,
      pitch,
      vx,
      vz,
      weapon: isKnife ? 'knife' : 'sniper',
      crouch: this.isCrouching ? 1 : 0,
      sprint: this.isSprinting ? 1 : 0,
      scoped: isScoped,
      onGround: this.isGrounded ? 1 : 0,
      swing: swing ? 1 : 0,
      // Backward compatibility fields
      rx: pitch,
      ry: yaw,
      w: isKnife ? 1 : 0,
      s: isScoped,
      c: this.isCrouching ? 1 : 0,
      sp: this.isSprinting ? 1 : 0,
      hp: this.health,
      alive: this.isAlive ? 1 : 0
    };
  }

  getCompactNetworkState(estimatedServerTime, seq = 0) {
    return this.getSendState(seq, estimatedServerTime);
  }

  getNetworkState() {
    return {
      position: {
        x: Number(this.camera.position.x.toFixed(3)),
        y: Number(this.camera.position.y.toFixed(3)),
        z: Number(this.camera.position.z.toFixed(3))
      },
      rotation: {
        x: Number(this.pitch.toFixed(3)),
        y: Number(this.yaw.toFixed(3))
      },
      activeWeapon: this.weaponSystem?.activeWeaponId || 'sniper',
      isScoped: (this.scopeOverlay && this.weaponSystem?.activeWeaponId === 'sniper') ? this.scopeOverlay.isScoped() : false,
      isSprinting: this.isSprinting,
      isCrouching: this.isCrouching,
      isGrounded: this.isGrounded,
      health: this.health,
      timestamp: Date.now()
    };
  }
}
