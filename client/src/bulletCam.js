// Synchronized Dual-Perspective Bullet Cam Kill Replay System
// Supports Shooter Bullet-Follow, Victim Cinematic Angle, Melee Kills & Fail-Safe Cleanup
import {
  UniversalCamera,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode
} from '@babylonjs/core';
import { CONFIG } from './config.js';
import { timeManager } from './timeManager.js';

export class BulletCam {
  constructor(scene, playerCamera, xrayEffect, bloodEffect, audioManager, uiManager) {
    this.scene = scene;
    this.playerCamera = playerCamera;
    this.xray = xrayEffect;
    this.blood = bloodEffect;
    this.audio = audioManager;
    this.ui = uiManager;

    this.isActive = false;
    this.enabled = true;

    // Dedicated Cinematic Camera
    this.bulletCamera = new UniversalCamera(
      'bulletCam',
      new Vector3(0, 2, 0),
      this.scene
    );
    this.bulletCamera.minZ = 0.05;
    this.bulletCamera.maxZ = 550;
    this.bulletCamera.fov = 1.32;
    this.bulletCamera.inputs.clear();

    // Perspective: 'shooter' or 'victim'
    this.perspective = 'shooter';
    this.weaponType = 'sniper';

    // Screen shake state
    this.shakeIntensity = 0;
    this.shakeTimer = 0;

    // Trajectory tracking
    this.startPoint = new Vector3(0, 0, 0);
    this.hitPoint = new Vector3(0, 0, 0);
    this.direction = new Vector3(0, 0, 1);
    this.bulletPos = new Vector3(0, 0, 0);
    this.totalDistance = 1;
    this.traveledDistance = 0;
    this.victim = null;
    this.isHeadshot = false;
    this.killInfo = null;
    this.onCompleteCallback = null;

    // Cinematic State Machine
    this.state = 'INACTIVE'; // 'FLYING' | 'APPROACH' | 'IMPACT' | 'RAGDOLL' | 'FINISHING'
    this.stateTimer = 0;

    this.createPooledBullet();
    this.setupLetterboxUI();
    this.setupInputListener();
  }

  createPooledBullet() {
    this.bulletRoot = new TransformNode('pooledBulletRoot', this.scene);

    const bulletBody = MeshBuilder.CreateCylinder(
      'bulletBody',
      { height: 0.14, diameter: 0.038, tessellation: 12 },
      this.scene
    );
    bulletBody.parent = this.bulletRoot;
    bulletBody.rotation.x = Math.PI / 2;
    const bulletMat = new StandardMaterial('bulletMat', this.scene);
    bulletMat.diffuseColor = new Color3(0.85, 0.55, 0.2);
    bulletMat.emissiveColor = new Color3(0.2, 0.1, 0.02);
    bulletMat.specularColor = new Color3(1.0, 0.85, 0.5);
    bulletBody.material = bulletMat;
    bulletBody.isPickable = false;

    const bulletTip = MeshBuilder.CreateCylinder(
      'bulletTip',
      { height: 0.09, diameterTop: 0.004, diameterBottom: 0.038, tessellation: 12 },
      this.scene
    );
    bulletTip.parent = this.bulletRoot;
    bulletTip.rotation.x = Math.PI / 2;
    bulletTip.position.z = 0.10;
    bulletTip.material = bulletMat;
    bulletTip.isPickable = false;

    const shockwave = MeshBuilder.CreateTorus(
      'shockwave',
      { diameter: 0.12, thickness: 0.012, tessellation: 16 },
      this.scene
    );
    shockwave.parent = this.bulletRoot;
    shockwave.position.z = -0.06;
    const shockMat = new StandardMaterial('shockMat', this.scene);
    shockMat.diffuseColor = new Color3(1.0, 0.95, 0.6);
    shockMat.emissiveColor = new Color3(1.0, 0.9, 0.5);
    shockMat.alpha = 0.75;
    shockwave.material = shockMat;
    shockwave.isPickable = false;

    this.trailPoints = [new Vector3(0, 0, 0), new Vector3(0, 0, -2.5)];
    this.trailMesh = MeshBuilder.CreateLines(
      'bulletTrail',
      { points: this.trailPoints, updatable: true },
      this.scene
    );
    this.trailMesh.color = new Color3(1.0, 0.98, 0.85);
    this.trailMesh.isPickable = false;

    this.bulletRoot.setEnabled(false);
    this.trailMesh.setEnabled(false);
  }

  setupLetterboxUI() {
    this.letterboxContainer = document.getElementById('cinematic-letterbox');
    if (!this.letterboxContainer) {
      this.letterboxContainer = document.createElement('div');
      this.letterboxContainer.id = 'cinematic-letterbox';
      this.letterboxContainer.className = 'letterbox-container hidden';
      this.letterboxContainer.innerHTML = `
        <div class="letterbox-bar top">
          <div id="killcam-banner-text" class="killcam-banner">CINEMATIC KILL CAM</div>
          <div class="killcam-skip-hint">[SPACE] SKIP VIEW</div>
        </div>
        <div class="letterbox-overlay-info">
          <div id="killcam-slowmo-tag" class="slowmo-tag">SLOW-MO 0.1X</div>
          <div id="killcam-dist-tag" class="dist-tag">-- M</div>
        </div>
        <div class="letterbox-bar bottom">
          <div id="killcam-target-label" class="killcam-status">ELIMINATION CONFIRMED</div>
        </div>
        <div id="killcam-white-flash" class="white-flash hidden"></div>
      `;
      document.body.appendChild(this.letterboxContainer);
    }

    this.bannerText = document.getElementById('killcam-banner-text');
    this.slowMoTag = document.getElementById('killcam-slowmo-tag');
    this.distTag = document.getElementById('killcam-dist-tag');
    this.targetLabel = document.getElementById('killcam-target-label');
    this.whiteFlash = document.getElementById('killcam-white-flash');
  }

  setupInputListener() {
    window.addEventListener('keydown', (e) => {
      if (this.isActive && e.code === 'Space') {
        // Skip visual replay locally for this player
        this.skipVisual();
      }
    });
  }

  start(perspective, startPos, targetHitPos, victimCharacter, isHeadshot, killInfo, onComplete) {
    if (!this.enabled) {
      if (onComplete) onComplete(killInfo);
      return;
    }

    this.isActive = true;
    this.perspective = perspective || 'shooter';
    this.weaponType = killInfo?.weaponType || 'sniper';
    this.startPoint.copyFrom(startPos);
    this.hitPoint.copyFrom(targetHitPos);
    this.victim = victimCharacter;
    this.isHeadshot = isHeadshot;
    this.killInfo = killInfo;
    this.onCompleteCallback = onComplete;

    this.direction = this.hitPoint.subtract(this.startPoint).normalize();
    this.totalDistance = Math.max(0.5, Vector3.Distance(this.startPoint, this.hitPoint));
    this.traveledDistance = 0;
    this.bulletPos.copyFrom(this.startPoint);

    // Update Banner & Text
    if (this.bannerText) {
      this.bannerText.textContent = this.perspective === 'victim'
        ? 'OPPONENT ELIMINATION REPLAY'
        : 'CINEMATIC KILL CAM';
    }

    const distMeters = Math.max(1, Math.round(this.totalDistance));
    if (this.distTag) {
      this.distTag.textContent = this.weaponType === 'knife' ? 'MELEE STRIKE' : `${distMeters} METERS`;
    }

    if (this.targetLabel) {
      if (this.weaponType === 'knife') {
        this.targetLabel.textContent = this.perspective === 'victim'
          ? '☠ ELIMINATED BY TACTICAL COMBAT KNIFE'
          : '⚔ LETHAL COMBAT KNIFE STRIKE';
      } else {
        this.targetLabel.textContent = isHeadshot
          ? '🎯 CRITICAL HEADSHOT ELIMINATION'
          : '☠ ONE-SHOT SNIPER ELIMINATION';
      }
    }

    // 1. Slow Motion: scale game time to 0.1x
    timeManager.setTimeScale(CONFIG.BULLET_CAM.SLOW_MO_SCALE, true);

    // 2. Switch to Dedicated Bullet Camera
    this.scene.activeCamera = this.bulletCamera;

    if (this.weaponType === 'knife') {
      // Melee kill: start immediately at close-up cinematic angle
      this.state = 'IMPACT';
      this.setupMeleeKillCamera();
      this.triggerImpact();
    } else {
      // Sniper kill: bullet trajectory replay
      if (this.perspective === 'victim') {
        this.setupVictimCamera();
      } else {
        this.setupShooterCamera();
      }

      this.bulletRoot.setEnabled(true);
      this.bulletRoot.position.copyFrom(this.startPoint);
      this.bulletRoot.lookAt(this.startPoint.add(this.direction));
      this.trailMesh.setEnabled(true);

      this.state = 'FLYING';
      this.stateTimer = 0;
    }

    // 3. Cinematic Letterbox & HUD suppression
    if (this.letterboxContainer) this.letterboxContainer.classList.remove('hidden');
    if (this.ui) {
      this.ui.setBulletCamActive(true);
      this.ui.setAds(true);
      this.ui.setSniperScope(false);
    }

    // 4. Sound effect
    if (this.audio) {
      const t = this.audio.ctx?.currentTime || 0;
      this.audio.playTone(85, 'sine', 1.8, t, 0.4);
      this.audio.playTone(320, 'triangle', 0.8, t + 0.1, 0.25);
    }
  }

  setupShooterCamera() {
    this.bulletCamera.position = this.startPoint
      .subtract(this.direction.scale(1.8))
      .add(new Vector3(0, 0.35, 0));
    this.bulletCamera.setTarget(this.startPoint.add(this.direction.scale(5)));
  }

  setupVictimCamera() {
    // Cinematic third-person angle facing victim with incoming bullet view
    const sideVec = Vector3.Cross(this.direction, Vector3.Up()).normalize();
    const camPos = this.hitPoint
      .add(sideVec.scale(2.4))
      .add(this.direction.scale(1.6))
      .add(new Vector3(0, 0.4, 0));

    this.bulletCamera.position.copyFrom(camPos);
    this.bulletCamera.setTarget(this.hitPoint.add(new Vector3(0, 0.1, 0)));
  }

  setupMeleeKillCamera() {
    const sideVec = Vector3.Cross(this.direction, Vector3.Up()).normalize();
    const camPos = this.hitPoint
      .add(sideVec.scale(1.8))
      .subtract(this.direction.scale(0.8))
      .add(new Vector3(0, 0.35, 0));

    this.bulletCamera.position.copyFrom(camPos);
    this.bulletCamera.setTarget(this.hitPoint);
  }

  update(rawDtSec) {
    if (!this.isActive) {
      if (this.shakeTimer > 0) this.shakeTimer -= rawDtSec;
      return;
    }

    switch (this.state) {
      case 'FLYING':
        this.updateFlying(rawDtSec);
        break;
      case 'APPROACH':
        this.updateApproach(rawDtSec);
        break;
      case 'IMPACT':
        this.updateImpact(rawDtSec);
        break;
      case 'RAGDOLL':
        this.updateRagdoll(rawDtSec);
        break;
      case 'FINISHING':
        this.updateFinishing(rawDtSec);
        break;
    }

    // Screen Shake
    if (this.shakeTimer > 0) {
      this.shakeTimer -= rawDtSec;
      const shakeAmt = this.shakeIntensity * (this.shakeTimer / 0.25);
      this.bulletCamera.position.x += (Math.random() - 0.5) * shakeAmt;
      this.bulletCamera.position.y += (Math.random() - 0.5) * shakeAmt;
    }
  }

  updateFlying(rawDtSec) {
    const speed = CONFIG.BULLET_CAM.BULLET_SPEED;
    this.traveledDistance += speed * rawDtSec;
    const progress = Math.min(1.0, this.traveledDistance / this.totalDistance);

    this.bulletPos = Vector3.Lerp(this.startPoint, this.hitPoint, progress);
    this.bulletRoot.position.copyFrom(this.bulletPos);
    this.bulletRoot.lookAt(this.bulletPos.add(this.direction));

    // Trailing vapor ribbon
    const trailStart = this.bulletPos.subtract(this.direction.scale(Math.min(3.5, this.traveledDistance)));
    this.trailPoints[0].copyFrom(this.bulletPos);
    this.trailPoints[1].copyFrom(trailStart);
    this.trailMesh = MeshBuilder.CreateLines(
      'bulletTrail',
      { points: this.trailPoints, instance: this.trailMesh }
    );

    if (this.perspective === 'shooter') {
      const camFollowDist = 1.8;
      const camFollowHeight = 0.35;
      const targetCamPos = this.bulletPos
        .subtract(this.direction.scale(camFollowDist))
        .add(new Vector3(0, camFollowHeight, 0));

      this.bulletCamera.position = Vector3.Lerp(this.bulletCamera.position, targetCamPos, 14 * rawDtSec);
      this.bulletCamera.setTarget(this.bulletPos.add(this.direction.scale(4.0)));
      this.bulletCamera.rotation.z = Math.sin(progress * Math.PI) * 0.12;
    } else {
      // Victim perspective: camera looks along path of incoming bullet
      this.bulletCamera.setTarget(this.bulletPos);
    }

    const remainingDist = this.totalDistance - this.traveledDistance;

    // Trigger X-Ray 0.3s before impact
    if (remainingDist <= speed * CONFIG.BULLET_CAM.XRAY_LEAD_TIME && !this.xray.isActive) {
      if (this.victim) {
        this.xray.enable(this.victim);
      }
    }

    if (remainingDist <= CONFIG.BULLET_CAM.APPROACH_DISTANCE) {
      this.state = 'APPROACH';
      this.stateTimer = 0;
    }
  }

  updateApproach(rawDtSec) {
    const speed = CONFIG.BULLET_CAM.BULLET_SPEED * 0.7;
    this.traveledDistance += speed * rawDtSec;
    const progress = Math.min(1.0, this.traveledDistance / this.totalDistance);

    this.bulletPos = Vector3.Lerp(this.startPoint, this.hitPoint, progress);
    this.bulletRoot.position.copyFrom(this.bulletPos);

    const sideVec = Vector3.Cross(this.direction, Vector3.Up()).normalize();
    const orbitTargetPos = this.hitPoint
      .add(sideVec.scale(2.2))
      .subtract(this.direction.scale(0.8))
      .add(new Vector3(0, 0.45, 0));

    this.bulletCamera.position = Vector3.Lerp(this.bulletCamera.position, orbitTargetPos, 12 * rawDtSec);
    this.bulletCamera.setTarget(this.hitPoint);

    if (progress >= 1.0) {
      this.triggerImpact();
    }
  }

  triggerImpact() {
    this.state = 'IMPACT';
    this.stateTimer = 0;

    timeManager.setHitStop(CONFIG.BULLET_CAM.HIT_STOP_DURATION * 1000);

    this.shakeIntensity = 0.22;
    this.shakeTimer = 0.25;

    if (this.whiteFlash) {
      this.whiteFlash.classList.remove('hidden');
      setTimeout(() => {
        if (this.whiteFlash) this.whiteFlash.classList.add('hidden');
      }, 100);
    }

    this.bulletRoot.setEnabled(false);
    this.trailMesh.setEnabled(false);

    this.blood.spawnBloodBurst(this.hitPoint, this.direction);

    if (this.victim && typeof this.victim.triggerRagdoll === 'function') {
      this.victim.triggerRagdoll(this.hitPoint, this.direction, this.isHeadshot);
    }
  }

  updateImpact(rawDtSec) {
    this.stateTimer += rawDtSec;
    if (this.stateTimer >= CONFIG.BULLET_CAM.HIT_STOP_DURATION) {
      this.xray.disable();
      this.state = 'RAGDOLL';
      this.stateTimer = 0;
    }
  }

  updateRagdoll(rawDtSec) {
    this.stateTimer += rawDtSec;

    const orbitAngle = this.stateTimer * 0.8;
    const radius = 2.6;
    const camX = this.hitPoint.x + Math.sin(orbitAngle) * radius;
    const camZ = this.hitPoint.z + Math.cos(orbitAngle) * radius;
    const camY = Math.max(0.6, this.hitPoint.y - this.stateTimer * 0.25);

    this.bulletCamera.position.set(camX, camY, camZ);
    this.bulletCamera.setTarget(this.hitPoint.add(new Vector3(0, -this.stateTimer * 0.3, 0)));

    if (this.stateTimer >= CONFIG.BULLET_CAM.RAGDOLL_DURATION) {
      this.startFinishing();
    }
  }

  startFinishing() {
    this.state = 'FINISHING';
    this.stateTimer = 0;

    timeManager.setTimeScale(1.0);

    if (this.letterboxContainer) {
      this.letterboxContainer.classList.add('hidden');
    }

    this.scene.activeCamera = this.playerCamera;

    if (this.ui) {
      this.ui.setAds(false);
    }

    setTimeout(() => {
      this.complete();
    }, CONFIG.BULLET_CAM.EASE_BACK_DURATION * 1000);
  }

  updateFinishing(rawDtSec) {}

  skipVisual() {
    if (!this.isActive) return;
    // Visually restore local player camera immediately while keeping input lock
    if (this.letterboxContainer) this.letterboxContainer.classList.add('hidden');
    if (this.whiteFlash) this.whiteFlash.classList.add('hidden');
    this.scene.activeCamera = this.playerCamera;
    this.xray.disable();
    timeManager.reset();
  }

  // Guaranteed fail-safe cleanup in try/finally
  complete() {
    try {
      this.isActive = false;
      this.state = 'INACTIVE';
      this.bulletRoot.setEnabled(false);
      this.trailMesh.setEnabled(false);
      if (this.letterboxContainer) this.letterboxContainer.classList.add('hidden');
      if (this.whiteFlash) this.whiteFlash.classList.add('hidden');
      this.xray.disable();
      timeManager.reset();
      this.scene.activeCamera = this.playerCamera;
      if (this.ui) {
        this.ui.setBulletCamActive(false);
        this.ui.setAds(false);
      }
    } finally {
      if (this.onCompleteCallback) {
        const cb = this.onCompleteCallback;
        this.onCompleteCallback = null;
        cb(this.killInfo);
      }
    }
  }

  setEnabled(val) {
    this.enabled = !!val;
  }
}
