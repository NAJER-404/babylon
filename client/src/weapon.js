// First-Person Weapon System: Heavy Sniper & Tactical Combat Knife
// Supports Weapon Switching (0.4s equip), Melee Attacks (2.2m reach), Zero-Allocation Object Pools
import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  Ray,
  PointLight,
  TransformNode,
  ParticleSystem,
  DynamicTexture
} from '@babylonjs/core';
import { CONFIG } from './config.js';

export class WeaponSystem {
  constructor(scene, camera, audioManager, uiManager) {
    this.scene = scene;
    this.camera = camera;
    this.audio = audioManager;
    this.ui = uiManager;

    // Active weapon state: 'sniper' or 'knife'
    this.activeWeaponId = 'sniper';
    this.config = CONFIG.WEAPONS.SNIPER;

    // Sniper ammo & bolt state
    this.magAmmo = CONFIG.WEAPONS.SNIPER.MAGAZINE_SIZE;
    this.reserveAmmo = CONFIG.WEAPONS.SNIPER.RESERVE_AMMO;
    this.isReloading = false;
    this.reloadStartTime = 0;
    this.reloadProgress = 0;
    this.lastShotTime = 0;

    // Knife attack state
    this.isMeleeSwinging = false;
    this.justSwungMelee = false;
    this.meleeStartTime = 0;
    this.lastMeleeTime = 0;

    // Weapon equip / switch state
    this.isEquipping = false;
    this.equipStartTime = 0;
    this.targetWeaponId = null;

    // Recoil state
    this.recoilOffsetZ = 0;
    this.recoilPitch = 0;
    this.recoilRoll = 0;
    this.cameraRecoilPitch = 0;

    // Weapon sway & inertia
    this.lastCameraYaw = 0;
    this.lastCameraPitch = 0;
    this.swayYaw = 0;
    this.swayPitch = 0;
    this.idleTimer = 0;
    this.bobTimer = 0;

    // Hierarchies
    this.gunRoot = null;
    this.gunBodyNode = null;
    this.sniperRootNode = null;
    this.knifeRootNode = null;
    this.sniperBoltMesh = null;
    this.barrelTipNode = null;
    this.muzzleLight = null;
    this.muzzleFlashMesh = null;
    this.flashTimer = 0;

    // Performance Pools: Pre-allocate tracers and impact sparks
    this.tracerPool = [];
    this.maxTracers = 10;
    this.sparkSystem = null;

    this.createWeaponModels();
    this.setupObjectPools();
    this.updateHUD();
  }

  get currentWeaponId() {
    return this.activeWeaponId;
  }

  createWeaponModels() {
    // 1. Root node attached to camera
    this.gunRoot = new TransformNode('fpsGunRoot', this.scene);
    this.gunRoot.parent = this.camera;
    this.gunRoot.position = new Vector3(
      this.config.HIP_OFFSET.x,
      this.config.HIP_OFFSET.y,
      this.config.HIP_OFFSET.z
    );

    // Inner node for recoil, sway, and animation offsets
    this.gunBodyNode = new TransformNode('fpsGunBody', this.scene);
    this.gunBodyNode.parent = this.gunRoot;

    // --- SHARED MATERIALS ---
    const metalMat = new StandardMaterial('wepMetalMat', this.scene);
    metalMat.diffuseColor = new Color3(0.14, 0.15, 0.18);
    metalMat.specularColor = new Color3(0.65, 0.68, 0.72);
    metalMat.specularPower = 32;

    const steelMat = new StandardMaterial('wepSteelMat', this.scene);
    steelMat.diffuseColor = new Color3(0.72, 0.75, 0.80);
    steelMat.specularColor = new Color3(0.95, 0.95, 1.0);
    steelMat.specularPower = 64;

    const polymerMat = new StandardMaterial('wepPolymerMat', this.scene);
    polymerMat.diffuseColor = new Color3(0.08, 0.09, 0.11);
    polymerMat.specularColor = new Color3(0.18, 0.18, 0.20);

    const barrelMat = new StandardMaterial('wepBarrelMat', this.scene);
    barrelMat.diffuseColor = new Color3(0.22, 0.24, 0.28);
    barrelMat.specularColor = new Color3(0.85, 0.88, 0.92);

    const gloveMat = new StandardMaterial('wepGloveMat', this.scene);
    gloveMat.diffuseColor = new Color3(0.12, 0.14, 0.17);

    const knuckleMat = new StandardMaterial('wepKnuckleMat', this.scene);
    knuckleMat.diffuseColor = new Color3(0.06, 0.07, 0.08);

    const sleeveMat = new StandardMaterial('wepSleeveMat', this.scene);
    sleeveMat.diffuseColor = new Color3(0.18, 0.22, 0.26);

    const brassMat = new StandardMaterial('wepBrassMat', this.scene);
    brassMat.diffuseColor = new Color3(0.85, 0.68, 0.22);
    brassMat.specularColor = new Color3(1.0, 0.9, 0.5);

    // ==========================================
    // 2. HEAVY .50 BMG SNIPER RIFLE
    // ==========================================
    this.sniperRootNode = new TransformNode('sniperRoot', this.scene);
    this.sniperRootNode.parent = this.gunBodyNode;

    const sniperBody = MeshBuilder.CreateBox('sChassis', { width: 0.055, height: 0.082, depth: 0.44 }, this.scene);
    sniperBody.parent = this.sniperRootNode;
    sniperBody.position = new Vector3(0, 0, 0.02);
    sniperBody.material = metalMat;

    const sniperStock = MeshBuilder.CreateBox('sStock', { width: 0.058, height: 0.14, depth: 0.28 }, this.scene);
    sniperStock.parent = this.sniperRootNode;
    sniperStock.position = new Vector3(0, -0.04, -0.32);
    sniperStock.material = polymerMat;

    const sniperGrip = MeshBuilder.CreateBox('sGrip', { width: 0.045, height: 0.15, depth: 0.07 }, this.scene);
    sniperGrip.parent = this.sniperRootNode;
    sniperGrip.position = new Vector3(0, -0.13, -0.10);
    sniperGrip.rotation.x = -0.28;
    sniperGrip.material = polymerMat;

    const sniperBarrel = MeshBuilder.CreateCylinder('sBarrel', { height: 0.74, diameter: 0.034 }, this.scene);
    sniperBarrel.parent = this.sniperRootNode;
    sniperBarrel.rotation.x = Math.PI / 2;
    sniperBarrel.position = new Vector3(0, 0.015, 0.59);
    sniperBarrel.material = barrelMat;

    const sniperBrake = MeshBuilder.CreateBox('sMuzzleBrake', { width: 0.065, height: 0.055, depth: 0.14 }, this.scene);
    sniperBrake.parent = this.sniperRootNode;
    sniperBrake.position = new Vector3(0, 0.015, 0.99);
    sniperBrake.material = metalMat;

    this.sniperBoltMesh = new TransformNode('sBoltRoot', this.scene);
    this.sniperBoltMesh.parent = this.sniperRootNode;
    this.sniperBoltMesh.position = new Vector3(0.028, 0.025, -0.08);

    const boltStem = MeshBuilder.CreateCylinder('sBoltStem', { height: 0.045, diameter: 0.012 }, this.scene);
    boltStem.parent = this.sniperBoltMesh;
    boltStem.rotation.z = Math.PI / 2;
    boltStem.position = new Vector3(0.02, 0, 0);
    boltStem.material = metalMat;

    const boltKnob = MeshBuilder.CreateSphere('sBoltKnob', { diameter: 0.024 }, this.scene);
    boltKnob.parent = this.sniperBoltMesh;
    boltKnob.position = new Vector3(0.044, 0, 0);
    boltKnob.material = polymerMat;

    const sniperRound = MeshBuilder.CreateCylinder('sRound', { height: 0.07, diameter: 0.022 }, this.scene);
    sniperRound.parent = this.sniperRootNode;
    sniperRound.rotation.x = Math.PI / 2;
    sniperRound.position = new Vector3(0.012, 0.015, 0.02);
    sniperRound.material = brassMat;

    // Optical Sniper Scope
    const scopeTube = MeshBuilder.CreateCylinder('sScopeTube', { height: 0.38, diameter: 0.036 }, this.scene);
    scopeTube.parent = this.sniperRootNode;
    scopeTube.rotation.x = Math.PI / 2;
    scopeTube.position = new Vector3(0, 0.088, 0.08);
    scopeTube.material = metalMat;

    const scopeBellOcular = MeshBuilder.CreateCylinder('sScopeBellOcular', { height: 0.07, diameter: 0.046 }, this.scene);
    scopeBellOcular.parent = scopeTube;
    scopeBellOcular.position = new Vector3(0, -0.16, 0);
    scopeBellOcular.material = polymerMat;

    const scopeBellObj = MeshBuilder.CreateCylinder('sScopeBellObj', { height: 0.09, diameter: 0.052 }, this.scene);
    scopeBellObj.parent = scopeTube;
    scopeBellObj.position = new Vector3(0, 0.15, 0);
    scopeBellObj.material = polymerMat;

    // ==========================================
    // 3. TACTICAL COMBAT KNIFE
    // ==========================================
    this.knifeRootNode = new TransformNode('knifeRoot', this.scene);
    this.knifeRootNode.parent = this.gunBodyNode;
    this.knifeRootNode.position = new Vector3(0.08, -0.05, 0.15);
    this.knifeRootNode.setEnabled(false); // Initially hidden while sniper active

    // Ergonomic Textured Handle
    const knifeHandle = MeshBuilder.CreateBox('kHandle', { width: 0.034, height: 0.042, depth: 0.16 }, this.scene);
    knifeHandle.parent = this.knifeRootNode;
    knifeHandle.position = new Vector3(0, 0, -0.05);
    knifeHandle.material = polymerMat;

    // Handle Ridges / Grip Grooves
    for (let r = 0; r < 4; r++) {
      const ridge = MeshBuilder.CreateBox(`kRidge_${r}`, { width: 0.036, height: 0.044, depth: 0.012 }, this.scene);
      ridge.parent = knifeHandle;
      ridge.position = new Vector3(0, 0, -0.05 + r * 0.032);
      ridge.material = metalMat;
    }

    // Steel Crossguard
    const knifeGuard = MeshBuilder.CreateBox('kGuard', { width: 0.042, height: 0.065, depth: 0.018 }, this.scene);
    knifeGuard.parent = this.knifeRootNode;
    knifeGuard.position = new Vector3(0, 0, 0.035);
    knifeGuard.material = metalMat;

    // Razor-Sharp Steel Blade
    const knifeBlade = MeshBuilder.CreateBox('kBlade', { width: 0.014, height: 0.048, depth: 0.22 }, this.scene);
    knifeBlade.parent = this.knifeRootNode;
    knifeBlade.position = new Vector3(0, 0.006, 0.15);
    knifeBlade.material = steelMat;

    // Angled Tanto Tip
    const knifeTip = MeshBuilder.CreateCylinder('kTip', { height: 0.07, diameterTop: 0.002, diameterBottom: 0.048, tessellation: 4 }, this.scene);
    knifeTip.parent = this.knifeRootNode;
    knifeTip.rotation.x = Math.PI / 2;
    knifeTip.position = new Vector3(0, 0.006, 0.27);
    knifeTip.material = steelMat;

    // Blood Groove (Fuller)
    const fuller = MeshBuilder.CreateBox('kFuller', { width: 0.016, height: 0.008, depth: 0.14 }, this.scene);
    fuller.parent = knifeBlade;
    fuller.position = new Vector3(0, 0.006, -0.02);
    fuller.material = metalMat;

    // ==========================================
    // 4. OPERATOR COMBAT ARMS & HANDS
    // ==========================================
    this.rightArmRoot = new TransformNode('rightArmRoot', this.scene);
    this.rightArmRoot.parent = this.gunBodyNode;
    this.rightArmRoot.position = new Vector3(0.06, -0.16, -0.06);

    const rightForearm = MeshBuilder.CreateBox('rightForearm', { width: 0.09, height: 0.11, depth: 0.32 }, this.scene);
    rightForearm.parent = this.rightArmRoot;
    rightForearm.position = new Vector3(0.06, -0.08, -0.10);
    rightForearm.rotation.x = 0.55;
    rightForearm.rotation.y = -0.22;
    rightForearm.material = sleeveMat;

    this.rightGlove = MeshBuilder.CreateBox('rightGlove', { width: 0.075, height: 0.085, depth: 0.11 }, this.scene);
    this.rightGlove.parent = this.rightArmRoot;
    this.rightGlove.position = new Vector3(0.015, -0.01, 0.01);
    this.rightGlove.rotation.x = -0.32;
    this.rightGlove.material = gloveMat;

    const rightKnuckles = MeshBuilder.CreateBox('rightKnuckles', { width: 0.078, height: 0.024, depth: 0.05 }, this.scene);
    rightKnuckles.parent = this.rightGlove;
    rightKnuckles.position = new Vector3(0.005, 0.038, 0.01);
    rightKnuckles.material = knuckleMat;

    // Left Arm supporting sniper rifle under barrel
    this.leftArmPivot = new TransformNode('leftArmPivot', this.scene);
    this.leftArmPivot.parent = this.gunBodyNode;
    this.leftArmPivot.position = new Vector3(-0.08, -0.18, 0.14);

    const leftForearm = MeshBuilder.CreateBox('leftForearm', { width: 0.09, height: 0.11, depth: 0.36 }, this.scene);
    leftForearm.parent = this.leftArmPivot;
    leftForearm.position = new Vector3(-0.08, -0.08, -0.08);
    leftForearm.rotation.x = 0.65;
    leftForearm.rotation.y = 0.38;
    leftForearm.material = sleeveMat;

    const leftGlove = MeshBuilder.CreateBox('leftGlove', { width: 0.075, height: 0.08, depth: 0.10 }, this.scene);
    leftGlove.parent = this.leftArmPivot;
    leftGlove.position = new Vector3(0.04, 0.11, 0.16);
    leftGlove.rotation.x = 0.2;
    leftGlove.rotation.z = -0.55;
    leftGlove.material = gloveMat;

    // ==========================================
    // 5. BARREL TIP & MUZZLE FLASH
    // ==========================================
    this.barrelTipNode = new TransformNode('fpsBarrelTip', this.scene);
    this.barrelTipNode.parent = this.gunBodyNode;
    this.barrelTipNode.position = new Vector3(0, 0.015, 1.05);

    this.muzzleLight = new PointLight('fpsMuzzleLight', new Vector3(0, 0, 0), this.scene);
    this.muzzleLight.parent = this.barrelTipNode;
    this.muzzleLight.intensity = 0;
    this.muzzleLight.range = 14;
    this.muzzleLight.diffuse = new Color3(1.0, 0.9, 0.45);

    this.muzzleFlashMesh = MeshBuilder.CreateSphere(
      'fpsMuzzleFlash',
      { diameterX: 0.26, diameterY: 0.26, diameterZ: 0.44, segments: 6 },
      this.scene
    );
    this.muzzleFlashMesh.parent = this.barrelTipNode;
    const flashMat = new StandardMaterial('fpsFlashMat', this.scene);
    flashMat.emissiveColor = new Color3(1.0, 0.95, 0.3);
    flashMat.disableLighting = true;
    this.muzzleFlashMesh.material = flashMat;
    this.muzzleFlashMesh.isVisible = false;
    this.muzzleFlashMesh.isPickable = false;

    // Ensure all weapon meshes are excluded from raycast picking
    [this.sniperRootNode, this.knifeRootNode, this.rightArmRoot, this.leftArmPivot].forEach(root => {
      root.getChildMeshes().forEach(m => { m.isPickable = false; });
    });
  }

  setupObjectPools() {
    for (let i = 0; i < this.maxTracers; i++) {
      const lineMesh = MeshBuilder.CreateLines(
        `pooledTracer_${i}`,
        { points: [new Vector3(0, 0, 0), new Vector3(0, 0, 1)], updatable: true },
        this.scene
      );
      lineMesh.color = new Color3(1.0, 0.95, 0.35);
      lineMesh.isPickable = false;
      lineMesh.isVisible = false;
      this.tracerPool.push({
        mesh: lineMesh,
        active: false,
        timer: 0,
        points: [new Vector3(0, 0, 0), new Vector3(0, 0, 1)]
      });
    }

    this.sparkSystem = new ParticleSystem('pooledImpactSparks', 150, this.scene);
    const sparkTex = new DynamicTexture('sparkTex', 32, this.scene, false);
    const ctx = sparkTex.getContext();
    ctx.fillStyle = '#ffbb00';
    ctx.beginPath();
    ctx.arc(16, 16, 12, 0, Math.PI * 2);
    ctx.fill();
    sparkTex.update();

    this.sparkSystem.particleTexture = sparkTex;
    this.sparkSystem.emitter = new Vector3(0, 0, 0);
    this.sparkSystem.color1 = new Color4(1.0, 0.9, 0.3, 1.0);
    this.sparkSystem.color2 = new Color4(1.0, 0.5, 0.1, 0.8);
    this.sparkSystem.colorDead = new Color4(0.4, 0.1, 0.0, 0.0);
    this.sparkSystem.minSize = 0.05;
    this.sparkSystem.maxSize = 0.12;
    this.sparkSystem.minLifeTime = 0.15;
    this.sparkSystem.maxLifeTime = 0.30;
    this.sparkSystem.emitRate = 0;
    this.sparkSystem.gravity = new Vector3(0, -18.0, 0);
    this.sparkSystem.minEmitPower = 4.0;
    this.sparkSystem.maxEmitPower = 9.0;
    this.sparkSystem.updateSpeed = 0.016;
    this.sparkSystem.start();
  }

  // Weapon switching with 0.4s equip transition
  switchWeapon(targetId) {
    if (this.activeWeaponId === targetId && !this.isEquipping) return false;
    if (this.isEquipping || this.isMeleeSwinging || this.isReloading) return false;

    this.isEquipping = true;
    this.equipStartTime = performance.now();
    this.targetWeaponId = targetId;

    this.audio.playWeaponSwitch();
    return true;
  }

  canAttack() {
    const now = performance.now();
    if (this.isEquipping) return false;

    if (this.activeWeaponId === 'knife') {
      return !this.isMeleeSwinging && now - this.lastMeleeTime >= CONFIG.WEAPONS.KNIFE.ATTACK_COOLDOWN_MS;
    } else {
      return (
        !this.isReloading &&
        this.magAmmo > 0 &&
        now - this.lastShotTime >= this.config.FIRE_INTERVAL_MS
      );
    }
  }

  attack(playerMovementState = {}) {
    if (!this.canAttack()) {
      if (this.activeWeaponId === 'sniper' && this.magAmmo <= 0 && !this.isReloading) {
        this.reload();
      }
      return null;
    }

    if (this.activeWeaponId === 'knife') {
      return this.performMeleeAttack();
    } else {
      return this.performSniperShot(playerMovementState);
    }
  }

  performMeleeAttack() {
    const now = performance.now();
    this.lastMeleeTime = now;
    this.isMeleeSwinging = true;
    this.justSwungMelee = true;
    this.meleeStartTime = now;

    this.audio.playKnifeSwing();

    const shotId = `knife_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // Raycast in forward camera direction up to 2.2 units reach
    const forward = this.camera.getForwardRay().direction;
    const rayOrigin = this.camera.position.clone();
    const ray = new Ray(rayOrigin, forward, CONFIG.WEAPONS.KNIFE.RANGE);

    const hitInfo = this.scene.pickWithRay(ray, mesh => {
      if (!mesh || !mesh.isPickable) return false;
      if (mesh === this.gunRoot || mesh.isDescendantOf(this.gunRoot)) return false;
      if (mesh.name === 'playerCollider' || mesh.metadata?.isLocalPlayer) return false;
      if (mesh.name?.startsWith('tracer_') || mesh.metadata?.isTrigger) return false;
      return mesh.metadata?.isHitbox;
    });

    let hitResult = {
      shotId,
      fired: true,
      weaponType: 'knife',
      damage: CONFIG.WEAPONS.KNIFE.DAMAGE,
      bodyDamage: CONFIG.WEAPONS.KNIFE.DAMAGE,
      headDamage: CONFIG.WEAPONS.KNIFE.DAMAGE,
      hit: false,
      hitPart: null,
      targetMesh: null,
      hitPoint: null
    };

    if (hitInfo && hitInfo.hit && hitInfo.pickedMesh?.metadata?.isHitbox) {
      hitResult.hit = true;
      hitResult.hitPart = hitInfo.pickedMesh.metadata.hitPart || 'body';
      hitResult.targetId = hitInfo.pickedMesh.metadata.targetId;
      hitResult.targetType = hitInfo.pickedMesh.metadata.targetType;
      hitResult.hitPoint = {
        x: hitInfo.pickedPoint.x,
        y: hitInfo.pickedPoint.y,
        z: hitInfo.pickedPoint.z
      };

      this.audio.playKnifeHit();
      if (this.ui) {
        this.ui.showHitmarker(hitResult.hitPart === 'head');
      }
      if (this.audio && this.audio.playHitmarker) {
        this.audio.playHitmarker(hitResult.hitPart === 'head');
      }
    }

    return hitResult;
  }

  consumeMeleeSwing() {
    const swung = this.justSwungMelee;
    this.justSwungMelee = false;
    return swung ? 1 : 0;
  }

  performSniperShot(playerMovementState = {}) {
    const now = performance.now();
    this.lastShotTime = now;
    this.magAmmo--;

    this.audio.playSniperShot();
    this.triggerMuzzleFlash();

    this.recoilOffsetZ = this.config.GUN_RECOIL_OFFSET_Z;
    this.recoilPitch = this.config.GUN_RECOIL_PITCH;
    this.recoilRoll = (Math.random() - 0.5) * 0.03;
    this.cameraRecoilPitch = this.config.RECOIL_CAMERA_PITCH;

    let spread = this.config.BASE_SPREAD;
    if (playerMovementState.isScoped) {
      spread = this.config.ADS_SPREAD;
    } else if (!playerMovementState.isGrounded) {
      spread = this.config.AIR_SPREAD;
    } else if (playerMovementState.isSprinting) {
      spread = this.config.MOVING_SPREAD * 1.5;
    } else if (playerMovementState.isMoving) {
      spread = this.config.MOVING_SPREAD;
    }

    const spreadX = (Math.random() - 0.5) * 2 * spread;
    const spreadY = (Math.random() - 0.5) * 2 * spread;

    const forward = this.camera.getForwardRay().direction;
    const up = this.camera.upVector;
    const right = Vector3.Cross(forward, up).normalize();

    const shotDirection = forward
      .add(right.scale(spreadX))
      .add(up.scale(spreadY))
      .normalize();

    const rayOrigin = this.camera.position.clone();
    const ray = new Ray(rayOrigin, shotDirection, 250);

    const hitInfo = this.scene.pickWithRay(ray, mesh => {
      if (!mesh || !mesh.isPickable) return false;
      if (mesh === this.gunRoot || mesh.isDescendantOf(this.gunRoot)) return false;
      if (mesh.name === 'playerCollider' || mesh.metadata?.isLocalPlayer) return false;
      if (mesh.name?.startsWith('tracer_') || mesh.metadata?.isTrigger) return false;
      if (mesh.name?.startsWith('nameTag') || mesh.name?.startsWith('soldierShield') || mesh.name?.startsWith('sScopeGlint') || mesh.name?.startsWith('sMuzzle')) return false;
      return !!(mesh.metadata?.isHitbox || mesh.checkCollisions);
    });

    const shotId = `shot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    let endPoint = rayOrigin.add(shotDirection.scale(140));
    let hitResult = {
      shotId,
      fired: true,
      weaponType: 'sniper',
      bodyDamage: this.config.BODY_DAMAGE,
      headDamage: this.config.HEAD_DAMAGE,
      legDamage: this.config.LEG_DAMAGE,
      ammo: this.magAmmo,
      reserve: this.reserveAmmo,
      rayOrigin: { x: rayOrigin.x, y: rayOrigin.y, z: rayOrigin.z },
      rayDirection: { x: shotDirection.x, y: shotDirection.y, z: shotDirection.z },
      hit: false,
      hitPart: null,
      targetMesh: null,
      hitPoint: null
    };

    if (hitInfo && hitInfo.hit && hitInfo.pickedPoint) {
      endPoint = hitInfo.pickedPoint;
      hitResult.hitPoint = { x: endPoint.x, y: endPoint.y, z: endPoint.z };

      const pickedMesh = hitInfo.pickedMesh;
      if (pickedMesh?.metadata?.isHitbox) {
        hitResult.hit = true;
        hitResult.hitPart = pickedMesh.metadata.hitPart;
        hitResult.targetId = pickedMesh.metadata.targetId;
        hitResult.targetType = pickedMesh.metadata.targetType;

        // Immediate client hit feedback (prediction)
        if (this.ui) {
          this.ui.showHitmarker(hitResult.hitPart === 'head');
        }
        if (this.audio && this.audio.playHitmarker) {
          this.audio.playHitmarker(hitResult.hitPart === 'head');
        }
      } else {
        this.triggerImpactSparks(endPoint, hitInfo.getNormal(true) || Vector3.Up());
      }
    }

    this.spawnPooledBulletTracer(this.getBarrelTipWorldPosition(), endPoint);

    if (this.magAmmo <= 0) {
      this.reload();
    }

    this.updateHUD();
    return hitResult;
  }

  // Alias for backward compatibility
  shoot(playerMovementState = {}) {
    return this.attack(playerMovementState);
  }

  triggerMuzzleFlash() {
    if (this.muzzleLight) this.muzzleLight.intensity = 6.0;
    if (this.muzzleFlashMesh) {
      this.muzzleFlashMesh.isVisible = true;
      this.muzzleFlashMesh.rotation.z = Math.random() * Math.PI;
    }
    this.flashTimer = 0.05;
  }

  getBarrelTipWorldPosition() {
    if (this.barrelTipNode) {
      return this.barrelTipNode.getAbsolutePosition();
    }
    return this.camera.position.add(this.camera.getForwardRay().direction.scale(0.8));
  }

  spawnPooledBulletTracer(startPoint, endPoint) {
    let tracer = this.tracerPool.find(t => !t.active) || this.tracerPool[0];
    tracer.active = true;
    tracer.timer = 0.08;
    tracer.points[0].copyFrom(startPoint);
    tracer.points[1].copyFrom(endPoint);

    tracer.mesh = MeshBuilder.CreateLines(
      tracer.mesh.name,
      { points: tracer.points, instance: tracer.mesh }
    );
    tracer.mesh.isVisible = true;
  }

  triggerImpactSparks(position, normal) {
    if (!this.sparkSystem) return;
    this.sparkSystem.emitter = position.clone();
    this.sparkSystem.direction1 = normal.add(new Vector3(-0.6, 0.4, -0.6)).normalize();
    this.sparkSystem.direction2 = normal.add(new Vector3(0.6, 1.0, 0.6)).normalize();
    this.sparkSystem.manualEmitCount = 15;
  }

  reload() {
    if (this.activeWeaponId !== 'sniper') return false;
    if (this.isReloading || this.magAmmo >= this.config.MAGAZINE_SIZE || this.reserveAmmo <= 0) {
      return false;
    }

    this.isReloading = true;
    this.reloadStartTime = performance.now();
    this.reloadProgress = 0;

    this.audio.playSniperReload();
    this.updateHUD();
    return true;
  }

  resetAmmo() {
    this.magAmmo = CONFIG.WEAPONS.SNIPER.MAGAZINE_SIZE;
    this.reserveAmmo = CONFIG.WEAPONS.SNIPER.RESERVE_AMMO;
    this.isReloading = false;
    this.reloadProgress = 0;
    this.isMeleeSwinging = false;
    this.isEquipping = false;

    if (this.sniperBoltMesh) {
      this.sniperBoltMesh.rotation.z = 0;
      this.sniperBoltMesh.position.z = -0.08;
    }
    this.updateHUD();
  }

  consumeCameraRecoil() {
    const kick = this.cameraRecoilPitch;
    this.cameraRecoilPitch = 0;
    return kick;
  }

  update(deltaTime, playerMovementState = {}) {
    const dt = Math.min(0.05, Math.max(0.001, deltaTime / 1000));
    const now = performance.now();

    // 1. Muzzle Flash Decay
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        if (this.muzzleLight) this.muzzleLight.intensity = 0;
        if (this.muzzleFlashMesh) this.muzzleFlashMesh.isVisible = false;
      }
    }

    // 2. Active Tracers Decay
    for (const t of this.tracerPool) {
      if (t.active) {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.active = false;
          t.mesh.isVisible = false;
        }
      }
    }

    // 3. Equip Transition (0.4s duration)
    let equipOffsetY = 0;
    let equipPitch = 0;

    if (this.isEquipping) {
      const elapsed = now - this.equipStartTime;
      const progress = Math.min(1.0, elapsed / 400);

      if (progress < 0.5) {
        // Lower current weapon
        const dropRatio = progress / 0.5;
        equipOffsetY = -0.35 * dropRatio;
        equipPitch = -0.45 * dropRatio;
      } else {
        // Swap weapon mesh visibility at half-way mark
        if (this.targetWeaponId && this.activeWeaponId !== this.targetWeaponId) {
          this.activeWeaponId = this.targetWeaponId;
          const isSniper = this.activeWeaponId === 'sniper';
          this.sniperRootNode.setEnabled(isSniper);
          this.knifeRootNode.setEnabled(!isSniper);
          this.leftArmPivot.setEnabled(isSniper);
          this.ui.setActiveWeaponSlot(this.activeWeaponId);
        }

        // Raise new weapon
        const raiseRatio = (progress - 0.5) / 0.5;
        equipOffsetY = -0.35 * (1.0 - raiseRatio);
        equipPitch = -0.45 * (1.0 - raiseRatio);
      }

      if (progress >= 1.0) {
        this.isEquipping = false;
        this.targetWeaponId = null;
        equipOffsetY = 0;
        equipPitch = 0;
      }
    }

    // 4. Melee Slash Animation (0.25s duration)
    let meleeOffsetX = 0;
    let meleeOffsetY = 0;
    let meleeOffsetZ = 0;
    let meleePitch = 0;
    let meleeYaw = 0;
    let meleeRoll = 0;

    if (this.isMeleeSwinging) {
      const elapsed = now - this.meleeStartTime;
      const progress = Math.min(1.0, elapsed / CONFIG.WEAPONS.KNIFE.SWING_DURATION_MS);

      if (progress < 0.35) {
        // Wind-up: pull knife back and right
        const wp = progress / 0.35;
        meleeOffsetX = 0.08 * wp;
        meleeOffsetY = 0.05 * wp;
        meleeOffsetZ = -0.08 * wp;
        meleePitch = 0.35 * wp;
        meleeYaw = 0.40 * wp;
      } else if (progress < 0.75) {
        // Rapid Forward Arc Slash across to left
        const sp = (progress - 0.35) / 0.40;
        meleeOffsetX = 0.08 - 0.22 * sp;
        meleeOffsetY = 0.05 - 0.08 * sp;
        meleeOffsetZ = -0.08 + 0.24 * sp;
        meleePitch = 0.35 - 0.65 * sp;
        meleeYaw = 0.40 - 0.90 * sp;
        meleeRoll = -0.45 * sp;
      } else {
        // Recovery back to idle
        const rp = (progress - 0.75) / 0.25;
        meleeOffsetX = -0.14 * (1.0 - rp);
        meleeOffsetY = -0.03 * (1.0 - rp);
        meleeOffsetZ = 0.16 * (1.0 - rp);
        meleePitch = -0.30 * (1.0 - rp);
        meleeYaw = -0.50 * (1.0 - rp);
        meleeRoll = -0.45 * (1.0 - rp);
      }

      if (progress >= 1.0) {
        this.isMeleeSwinging = false;
      }
    }

    // 5. Hide weapon model when fully scoped
    const isScoped = playerMovementState.isScoped && this.activeWeaponId === 'sniper';
    if (this.sniperRootNode) {
      this.sniperRootNode.setEnabled(this.activeWeaponId === 'sniper' && !isScoped);
    }
    if (this.knifeRootNode) {
      this.knifeRootNode.setEnabled(this.activeWeaponId === 'knife');
    }

    // 6. Recoil Recovery
    const recovery = this.config.RECOIL_RECOVERY_SPEED;
    this.recoilOffsetZ += (0 - this.recoilOffsetZ) * Math.min(1.0, recovery * dt);
    this.recoilPitch += (0 - this.recoilPitch) * Math.min(1.0, recovery * dt);
    this.recoilRoll += (0 - this.recoilRoll) * Math.min(1.0, recovery * dt);

    // 7. Weapon Inertia & Sway
    const currentYaw = this.camera.rotation.y;
    const currentPitch = this.camera.rotation.x;
    const deltaYaw = currentYaw - this.lastCameraYaw;
    const deltaPitch = currentPitch - this.lastCameraPitch;
    this.lastCameraYaw = currentYaw;
    this.lastCameraPitch = currentPitch;

    const targetSwayYaw = -deltaYaw * 0.6;
    const targetSwayPitch = deltaPitch * 0.6;
    this.swayYaw += (targetSwayYaw - this.swayYaw) * Math.min(1.0, 15.0 * dt);
    this.swayPitch += (targetSwayPitch - this.swayPitch) * Math.min(1.0, 15.0 * dt);

    // 8. Idle Breathing
    this.idleTimer += dt * 2.0;
    const breatheX = Math.sin(this.idleTimer) * 0.002;
    const breatheY = Math.cos(this.idleTimer * 2.0) * 0.0015;

    // 9. Movement Bobbing
    let walkBobX = 0;
    let walkBobY = 0;
    if (playerMovementState.isGrounded && playerMovementState.isMoving && !isScoped) {
      const speed = playerMovementState.speed || 4.5;
      this.bobTimer += dt * 8.0 * (speed / 4.5);
      walkBobX = Math.cos(this.bobTimer * 0.5) * 0.007;
      walkBobY = Math.sin(this.bobTimer) * 0.005;
    } else {
      this.bobTimer = 0;
    }

    // 10. Bolt Action Reload Animation (Sniper only)
    let reloadPitch = 0;
    let reloadRoll = 0;

    if (this.isReloading && this.activeWeaponId === 'sniper') {
      const elapsed = now - this.reloadStartTime;
      this.reloadProgress = Math.min(1.0, elapsed / this.config.RELOAD_TIME_MS);

      const p = this.reloadProgress;
      if (p < 0.25) {
        this.sniperBoltMesh.rotation.z = -(p / 0.25) * 0.75;
        this.sniperBoltMesh.position.z = -0.08;
        reloadPitch = -0.04 * (p / 0.25);
      } else if (p < 0.55) {
        const bp = (p - 0.25) / 0.30;
        this.sniperBoltMesh.rotation.z = -0.75;
        this.sniperBoltMesh.position.z = -0.08 - bp * 0.06;
        reloadRoll = 0.10 * bp;
      } else if (p < 0.80) {
        const fp = (p - 0.55) / 0.25;
        this.sniperBoltMesh.rotation.z = -0.75;
        this.sniperBoltMesh.position.z = -0.14 + fp * 0.06;
        reloadRoll = 0.10 * (1.0 - fp);
      } else {
        const lp = (p - 0.80) / 0.20;
        this.sniperBoltMesh.rotation.z = -0.75 * (1.0 - lp);
        this.sniperBoltMesh.position.z = -0.08;
        reloadPitch = -0.04 * (1.0 - lp);
      }

      if (this.reloadProgress >= 1.0) {
        const needed = this.config.MAGAZINE_SIZE - this.magAmmo;
        const available = Math.min(needed, this.reserveAmmo);
        this.magAmmo += available;
        this.reserveAmmo -= available;
        this.isReloading = false;
        this.reloadProgress = 0;
        this.sniperBoltMesh.rotation.z = 0;
        this.sniperBoltMesh.position.z = -0.08;
        this.updateHUD();
      }
    }

    // Apply combined offsets to gunBodyNode
    this.gunBodyNode.position.x = this.swayYaw + breatheX + walkBobX + meleeOffsetX;
    this.gunBodyNode.position.y = this.swayPitch + breatheY + walkBobY + equipOffsetY + meleeOffsetY;
    this.gunBodyNode.position.z = this.recoilOffsetZ + meleeOffsetZ;

    this.gunBodyNode.rotation.x = this.recoilPitch + this.swayPitch * 0.5 + reloadPitch + equipPitch + meleePitch;
    this.gunBodyNode.rotation.y = this.swayYaw * 0.5 + meleeYaw;
    this.gunBodyNode.rotation.z = this.recoilRoll + reloadRoll + meleeRoll;
  }

  updateHUD() {
    if (!this.ui) return;
    this.ui.setActiveWeaponSlot(this.activeWeaponId);
    if (this.activeWeaponId === 'sniper') {
      this.ui.updateAmmo(this.magAmmo, this.reserveAmmo, this.isReloading);
    }
  }

  dispose() {
    this.tracerPool.forEach(t => t.mesh.dispose());
    this.tracerPool = [];
    if (this.sparkSystem) {
      this.sparkSystem.dispose();
      this.sparkSystem = null;
    }
  }
}
