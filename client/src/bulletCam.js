// Synchronized Dual-Perspective Bullet Cam Kill Replay System
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

export const BULLET_CAM_STATE = {
  IDLE: 'IDLE',
  PREPARING: 'PREPARING',
  PLAYING: 'PLAYING',
  ENDING: 'ENDING'
};

export class BulletCam {
  constructor(scene, playerCamera, xrayEffect, bloodEffect, audioManager, uiManager) {
    this.scene = scene;
    this.playerCamera = playerCamera;
    this.xray = xrayEffect;
    this.blood = bloodEffect;
    this.audio = audioManager;
    this.ui = uiManager;

    this.enabled = true;
    this.camState = BULLET_CAM_STATE.IDLE;

    this.bulletCamera = new UniversalCamera('bulletCam', new Vector3(0, 2, 0), this.scene);
    this.bulletCamera.minZ = 0.1;
    this.bulletCamera.maxZ = 1200;
    this.bulletCamera.fov = 1.32;
    this.bulletCamera.inputs.clear();
    if (this.playerCamera) this.scene.activeCamera = this.playerCamera;

    this.perspective = 'shooter';
    this.weaponType = 'sniper';

    this.shakeIntensity = 0;
    this.shakeTimer = 0;

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

    this.stateStartTime = 0;
    this.playingSubPhase = 'FLIGHT'; 
    this.phaseStartTime = 0;
    this.watchdogTimerId = null;

    this.processedKillIds = new Set();
    this.killQueue = [];

    this.createPooledBullet();
    this.setupLetterboxUI();
  }

  get isActive() {
    return this.camState !== BULLET_CAM_STATE.IDLE;
  }

  createPooledBullet() {
    this.bulletRoot = new TransformNode('pooledBulletRoot', this.scene);
    const bulletBody = MeshBuilder.CreateCylinder('bulletBody', { height: 0.14, diameter: 0.038, tessellation: 12 }, this.scene);
    bulletBody.parent = this.bulletRoot; bulletBody.rotation.x = Math.PI / 2;
    const bulletMat = new StandardMaterial('bulletMat', this.scene);
    bulletMat.diffuseColor = new Color3(0.85, 0.55, 0.2); bulletMat.emissiveColor = new Color3(0.2, 0.1, 0.02); bulletMat.specularColor = new Color3(1.0, 0.85, 0.5);
    bulletBody.material = bulletMat; bulletBody.isPickable = false;

    const bulletTip = MeshBuilder.CreateCylinder('bulletTip', { height: 0.09, diameterTop: 0.004, diameterBottom: 0.038, tessellation: 12 }, this.scene);
    bulletTip.parent = this.bulletRoot; bulletTip.rotation.x = Math.PI / 2; bulletTip.position.z = 0.10; bulletTip.material = bulletMat; bulletTip.isPickable = false;

    const shockwave = MeshBuilder.CreateTorus('shockwave', { diameter: 0.12, thickness: 0.012, tessellation: 16 }, this.scene);
    shockwave.parent = this.bulletRoot; shockwave.position.z = -0.06;
    const shockMat = new StandardMaterial('shockMat', this.scene);
    shockMat.diffuseColor = new Color3(1.0, 0.95, 0.6); shockMat.emissiveColor = new Color3(1.0, 0.9, 0.5); shockMat.alpha = 0.75;
    shockwave.material = shockMat; shockwave.isPickable = false;

    this.trailPoints = [new Vector3(0, 0, 0), new Vector3(0, 0, -2.5)];
    this.trailMesh = MeshBuilder.CreateLines('bulletTrail', { points: this.trailPoints, updatable: true }, this.scene);
    this.trailMesh.color = new Color3(1.0, 0.98, 0.85); this.trailMesh.isPickable = false;

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

  prewarm(scene) {
    try {
      if (this.bulletRoot) {
        this.bulletRoot.setEnabled(true);
        this.bulletRoot.position.set(0, -200, 0);
      }
      if (this.trailMesh) {
        this.trailMesh.setEnabled(true);
        this.trailMesh.position.set(0, -200, 0);
      }
      const meshes = this.bulletRoot?.getChildMeshes() || [];
      for (const m of meshes) {
        if (m.material && typeof m.material.forceCompilationAsync === 'function') {
          m.material.forceCompilationAsync(m).catch(() => {});
        }
      }
      setTimeout(() => {
        if (this.camState === BULLET_CAM_STATE.IDLE) {
          this.bulletRoot?.setEnabled(false);
          this.trailMesh?.setEnabled(false);
        }
      }, 150);
    } catch (e) {}
  }

  start(perspective, startPos, targetHitPos, victimCharacter, isHeadshot, killInfo = {}, onComplete = null) {
    const killId = killInfo?.killId;
    if (killId) {
      if (this.processedKillIds.has(killId)) return;
      this.processedKillIds.add(killId);
      if (this.processedKillIds.size > 60) {
        const first = this.processedKillIds.values().next().value;
        this.processedKillIds.delete(first);
      }
    }

    if (!this.enabled) {
      if (onComplete) onComplete(killInfo);
      return;
    }

    if (this.camState !== BULLET_CAM_STATE.IDLE) {
      this.killQueue.push({
        perspective,
        startPos: startPos.clone ? startPos.clone() : new Vector3(startPos.x, startPos.y, startPos.z),
        targetHitPos: targetHitPos.clone ? targetHitPos.clone() : new Vector3(targetHitPos.x, targetHitPos.y, targetHitPos.z),
        victimCharacter, isHeadshot, killInfo, onComplete, enqueuedAt: performance.now()
      });
      return;
    }

    this.executeKillCam(perspective, startPos, targetHitPos, victimCharacter, isHeadshot, killInfo, onComplete);
  }

  executeKillCam(perspective, startPos, targetHitPos, victimCharacter, isHeadshot, killInfo, onComplete) {
    try {
      this.camState = BULLET_CAM_STATE.PREPARING;
      this.stateStartTime = performance.now();

      this.clearWatchdog();
      this.watchdogTimerId = setTimeout(() => { this.complete(); }, 6000);

      this.perspective = perspective || 'shooter';
      this.weaponType = killInfo?.weaponType || 'sniper';

      const sx = startPos?.x ?? 0; const sy = startPos?.y ?? 1.5; const sz = startPos?.z ?? 0;
      this.startPoint.set(sx, sy, sz);
      const tx = targetHitPos?.x ?? 0; const ty = targetHitPos?.y ?? 1.4; const tz = targetHitPos?.z ?? 0;
      this.hitPoint.set(tx, ty, tz);

      this.victim = victimCharacter;
      this.isHeadshot = !!isHeadshot;
      this.killInfo = killInfo;
      this.onCompleteCallback = onComplete;

      this.direction = this.hitPoint.subtract(this.startPoint).normalize();
      if (this.direction.lengthSquared() < 0.001) this.direction.set(0, 0, 1);
      
      this.totalDistance = Math.max(0.5, Vector3.Distance(this.startPoint, this.hitPoint));
      this.traveledDistance = 0;
      this.bulletPos.copyFrom(this.startPoint);

      if (this.bannerText) this.bannerText.textContent = this.perspective === 'victim' ? 'OPPONENT ELIMINATION REPLAY' : 'CINEMATIC KILL CAM';
      const distMeters = Math.max(1, Math.round(this.totalDistance));
      if (this.distTag) this.distTag.textContent = this.weaponType === 'knife' ? 'MELEE STRIKE' : `${distMeters} METERS`;
      if (this.targetLabel) {
        if (this.weaponType === 'knife') this.targetLabel.textContent = this.perspective === 'victim' ? '☠ ELIMINATED BY TACTICAL COMBAT KNIFE' : '⚔ LETHAL COMBAT KNIFE STRIKE';
        else this.targetLabel.textContent = this.isHeadshot ? '🎯 CRITICAL HEADSHOT ELIMINATION' : '☠ ONE-SHOT SNIPER ELIMINATION';
      }

      // TIME SCALE STARTS AT NORMAL SPEED (1.0) - NO SLOW MOTION YET
      timeManager.setTimeScale(1.0, true);
      
      this.scene.activeCamera = this.bulletCamera;

      if (this.xray && this.victim) {
        this.xray.enable(this.victim);
      }

      if (this.letterboxContainer) this.letterboxContainer.classList.remove('hidden');
      if (this.ui) {
        this.ui.setBulletCamActive(true);
        this.ui.setAds(true);
        this.ui.setSniperScope(false);
      }

      if (this.audio) {
        const t = this.audio.ctx?.currentTime || 0;
        this.audio.playTone(85, 'sine', 1.8, t, 0.4);
        this.audio.playTone(320, 'triangle', 0.8, t + 0.1, 0.25);
      }

      this.camState = BULLET_CAM_STATE.PLAYING;
      this.phaseStartTime = performance.now();

      if (this.weaponType === 'knife') {
        this.playingSubPhase = 'MELEE_ORBIT';
        this.setupMeleeKillCamera();
        this.triggerImpact();
      } else {
        if (this.perspective === 'victim') this.setupVictimCamera();
        else this.setupShooterCamera();

        this.bulletRoot.setEnabled(true);
        this.bulletRoot.position.copyFrom(this.startPoint);
        this.bulletRoot.lookAt(this.startPoint.add(this.direction));
        this.trailMesh.setEnabled(true);

        this.playingSubPhase = 'FLIGHT';
      }
    } catch (err) {
      this.complete();
    }
  }

  setupShooterCamera() {
    this.bulletCamera.position = this.startPoint.subtract(this.direction.scale(1.8)).add(new Vector3(0, 0.35, 0));
    this.bulletCamera.setTarget(this.startPoint.add(this.direction.scale(5)));
  }

  setupVictimCamera() {
    const sideVec = Vector3.Cross(this.direction, Vector3.Up()).normalize();
    const camPos = this.hitPoint.add(sideVec.scale(2.8)).subtract(this.direction.scale(1.2)).add(new Vector3(0, 0.3, 0));
    this.bulletCamera.position.copyFrom(camPos);
    this.bulletCamera.setTarget(this.hitPoint.add(new Vector3(0, 0.1, 0)));
  }

  setupMeleeKillCamera() {
    const sideVec = Vector3.Cross(this.direction, Vector3.Up()).normalize();
    const camPos = this.hitPoint.add(sideVec.scale(1.8)).subtract(this.direction.scale(0.8)).add(new Vector3(0, 0.35, 0));
    this.bulletCamera.position.copyFrom(camPos);
    this.bulletCamera.setTarget(this.hitPoint);
  }

  update(rawDtSec) {
    if (this.camState === BULLET_CAM_STATE.IDLE) {
      if (this.shakeTimer > 0) this.shakeTimer -= rawDtSec;
      return;
    }

    const now = performance.now();
    const elapsedPhaseSec = (now - this.phaseStartTime) / 1000;

    try {
      if (this.camState === BULLET_CAM_STATE.PLAYING) {
        switch (this.playingSubPhase) {
          case 'FLIGHT': this.updateFlight(rawDtSec, elapsedPhaseSec); break;
          case 'APPROACH': this.updateApproach(rawDtSec, elapsedPhaseSec); break;
          case 'IMPACT': this.updateImpact(elapsedPhaseSec); break;
          case 'RAGDOLL': this.updateRagdoll(elapsedPhaseSec); break;
          case 'MELEE_ORBIT': this.updateMeleeOrbit(elapsedPhaseSec); break;
        }
      }

      if (this.shakeTimer > 0) {
        this.shakeTimer -= rawDtSec;
        const shakeAmt = this.shakeIntensity * (this.shakeTimer / 0.25);
        this.bulletCamera.position.x += (Math.random() - 0.5) * shakeAmt;
        this.bulletCamera.position.y += (Math.random() - 0.5) * shakeAmt;
      }
    } catch (err) {
      this.complete();
    }
  }

  updateFlight(rawDtSec, elapsedSec) {
    // BULLET FLIES FAST AT NORMAL SPEED
    const speed = CONFIG.BULLET_CAM.BULLET_SPEED * 3.5; 
    this.traveledDistance += speed * rawDtSec;
    const progress = Math.min(1.0, this.traveledDistance / this.totalDistance);

    this.bulletPos = Vector3.Lerp(this.startPoint, this.hitPoint, progress);
    this.bulletRoot.position.copyFrom(this.bulletPos);
    this.bulletRoot.lookAt(this.bulletPos.add(this.direction));

    const trailStart = this.bulletPos.subtract(this.direction.scale(Math.min(3.5, this.traveledDistance)));
    this.trailPoints[0].copyFrom(this.bulletPos);
    this.trailPoints[1].copyFrom(trailStart);
    this.trailMesh = MeshBuilder.CreateLines('bulletTrail', { points: this.trailPoints, instance: this.trailMesh });

    if (this.perspective === 'shooter') {
      const camFollowDist = 1.8; const camFollowHeight = 0.35;
      const targetCamPos = this.bulletPos.subtract(this.direction.scale(camFollowDist)).add(new Vector3(0, camFollowHeight, 0));
      this.bulletCamera.position = Vector3.Lerp(this.bulletCamera.position, targetCamPos, 20 * rawDtSec);
      this.bulletCamera.setTarget(this.bulletPos.add(this.direction.scale(4.0)));
      this.bulletCamera.rotation.z = Math.sin(progress * Math.PI) * 0.12;
    } else {
      this.bulletCamera.setTarget(this.bulletPos);
    }

    const remainingDist = this.totalDistance - this.traveledDistance;

    if (remainingDist <= 3.0 || progress >= 0.95) {
      this.playingSubPhase = 'APPROACH';
      this.phaseStartTime = performance.now();
    }
  }

  updateApproach(rawDtSec, elapsedSec) {
    const speed = CONFIG.BULLET_CAM.BULLET_SPEED * 1.5;
    this.traveledDistance += speed * rawDtSec;
    const progress = Math.min(1.0, this.traveledDistance / this.totalDistance);

    this.bulletPos = Vector3.Lerp(this.startPoint, this.hitPoint, progress);
    this.bulletRoot.position.copyFrom(this.bulletPos);

    const sideVec = Vector3.Cross(this.direction, Vector3.Up()).normalize();
    const orbitTargetPos = this.hitPoint.add(sideVec.scale(2.2)).subtract(this.direction.scale(0.8)).add(new Vector3(0, 0.45, 0));

    this.bulletCamera.position = Vector3.Lerp(this.bulletCamera.position, orbitTargetPos, 16 * rawDtSec);
    this.bulletCamera.setTarget(this.hitPoint);

    if (progress >= 1.0 || elapsedSec > 0.8) {
      this.triggerImpact();
    }
  }

  triggerImpact() {
    this.playingSubPhase = 'IMPACT';
    this.phaseStartTime = performance.now();
    
    // THIS IS WHERE THE SLOW MOTION BEGINS!
    // The moment the bullet hits, time scales down to 0.1x speed
    timeManager.setTimeScale(CONFIG.BULLET_CAM.SLOW_MO_SCALE, true);
    timeManager.setHitStop(0.15 * 1000); 
    
    this.shakeIntensity = 0.3;
    this.shakeTimer = 0.3;

    if (this.whiteFlash) {
      this.whiteFlash.classList.remove('hidden');
      setTimeout(() => { if (this.whiteFlash) this.whiteFlash.classList.add('hidden'); }, 100);
    }

    this.bulletRoot.setEnabled(false);
    this.trailMesh.setEnabled(false);

    if (this.blood && typeof this.blood.spawnBloodBurst === 'function') {
      this.blood.spawnBloodBurst(this.hitPoint, this.direction);
    }

    if (this.victim && typeof this.victim.triggerRagdoll === 'function') {
      this.victim.triggerRagdoll(this.hitPoint, this.direction, this.isHeadshot);
    }
  }

  updateImpact(elapsedSec) {
    if (elapsedSec >= 0.15) {
      this.playingSubPhase = 'RAGDOLL';
      this.phaseStartTime = performance.now();
    }
  }

  updateRagdoll(elapsedSec) {
    const orbitAngle = elapsedSec * 0.8;
    const radius = 2.6;
    const camX = this.hitPoint.x + Math.sin(orbitAngle) * radius;
    const camZ = this.hitPoint.z + Math.cos(orbitAngle) * radius;
    const camY = Math.max(0.6, this.hitPoint.y - elapsedSec * 0.25);

    this.bulletCamera.position.set(camX, camY, camZ);
    this.bulletCamera.setTarget(this.hitPoint.add(new Vector3(0, -elapsedSec * 0.3, 0)));

    if (elapsedSec >= 3.0) {
      this.startEnding();
    }
  }

  updateMeleeOrbit(elapsedSec) {
    const orbitAngle = elapsedSec * 1.4;
    const radius = 2.2;
    const camX = this.hitPoint.x + Math.sin(orbitAngle) * radius;
    const camZ = this.hitPoint.z + Math.cos(orbitAngle) * radius;
    const camY = Math.max(0.8, this.hitPoint.y + 0.3 - elapsedSec * 0.15);

    this.bulletCamera.position.set(camX, camY, camZ);
    this.bulletCamera.setTarget(this.hitPoint);

    if (elapsedSec >= 2.5) {
      this.startEnding();
    }
  }

  startEnding() {
    this.camState = BULLET_CAM_STATE.ENDING;
    this.phaseStartTime = performance.now();

    // Restore normal time speed
    timeManager.setTimeScale(1.0);
    if (this.letterboxContainer) this.letterboxContainer.classList.add('hidden');
    this.scene.activeCamera = this.playerCamera;
    if (this.ui) this.ui.setAds(false);

    setTimeout(() => { this.complete(); }, 300);
  }

  clearWatchdog() {
    if (this.watchdogTimerId) {
      clearTimeout(this.watchdogTimerId);
      this.watchdogTimerId = null;
    }
  }

  complete() {
    this.clearWatchdog();

    try {
      this.camState = BULLET_CAM_STATE.IDLE;
      if (this.bulletRoot) this.bulletRoot.setEnabled(false);
      if (this.trailMesh) this.trailMesh.setEnabled(false);
      if (this.letterboxContainer) this.letterboxContainer.classList.add('hidden');
      if (this.whiteFlash) this.whiteFlash.classList.add('hidden');
      if (this.xray) this.xray.disable();
      timeManager.reset();
      this.scene.activeCamera = this.playerCamera;
      if (this.ui) {
        this.ui.setBulletCamActive(false);
        this.ui.setAds(false);
      }
    } catch (err) {
    } finally {
      if (this.onCompleteCallback) {
        const cb = this.onCompleteCallback;
        this.onCompleteCallback = null;
        try { cb(this.killInfo); } catch (e) {}
      }
      this.processQueue();
    }
  }

  processQueue() {
    if (this.killQueue.length === 0) return;
    const nextJob = this.killQueue.shift();
    const now = performance.now();
    if (now - nextJob.enqueuedAt > 5000) {
      if (nextJob.onComplete) nextJob.onComplete(nextJob.killInfo);
      this.processQueue();
      return;
    }

    this.executeKillCam(nextJob.perspective, nextJob.startPos, nextJob.targetHitPos, nextJob.victimCharacter, nextJob.isHeadshot, nextJob.killInfo, nextJob.onComplete);
  }

  setEnabled(val) { this.enabled = !!val; }
}