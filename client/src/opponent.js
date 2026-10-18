// High-Fidelity Humanoid Soldier Model: Tactical Armor, Team Colors, Scope Glint,
// Floating Billboard Nametag with Mini HP Bar & Procedural Animations
import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  DynamicTexture,
  Mesh
} from '@babylonjs/core';
import { CONFIG } from './config.js';

export class OpponentCharacter {
  constructor(scene, shadowGenerator, id, playerNumber = 2, isBot = false, playerName = 'Opponent') {
    this.scene = scene;
    this.shadowGenerator = shadowGenerator;
    this.id = id;
    this.playerNumber = playerNumber;
    this.isBot = isBot;
    this.name = playerName;

    this.position = new Vector3(0, 0, 0);
    this.velocity = new Vector3(0, 0, 0);
    this.rotationY = 0;
    this.aimPitch = 0;
    this.health = 100;
    this.isAlive = true;
    this.isProtected = false;
    this.activeWeapon = 'sniper';
    this.isScoped = false;
    this.isCrouching = false;
    this.isSprinting = false;

    // Animation timers
    this.walkAnimTimer = 0;
    this.idleTimer = 0;
    this.recoilTimer = 0;
    this.muzzleFlashTimer = 0;
    this.meleeSwingTimer = 0;
    this.flinchTimer = 0;

    // Network interpolation buffer
    this.positionBuffer = [];
    this.targetPosition = new Vector3(0, 0, 0);
    this.targetRotationY = 0;

    // Ragdoll state
    this.isRagdoll = false;
    this.ragdollTime = 0;
    this.ragdollParts = [];

    this.createHumanoidCharacter();
    this.createFloatingNameTag();
  }

  createHumanoidCharacter() {
    this.rootNode = new TransformNode(`humanoidSoldier_${this.id}`, this.scene);

    // Team vest colors
    let vestColorHex = CONFIG.COLORS.TEAM_BLUE_VEST;
    let accentColorHex = CONFIG.COLORS.TEAM_BLUE_ACCENT;

    if (this.isBot) {
      vestColorHex = CONFIG.COLORS.TEAM_BOT_VEST;
      accentColorHex = CONFIG.COLORS.TEAM_BOT_ACCENT;
    } else if (this.playerNumber === 1) {
      vestColorHex = CONFIG.COLORS.TEAM_RED_VEST;
      accentColorHex = CONFIG.COLORS.TEAM_RED_ACCENT;
    }

    // --- MATERIALS ---
    const vestMat = new StandardMaterial(`soldierVest_${this.id}`, this.scene);
    vestMat.diffuseColor = Color3.FromHexString(vestColorHex);
    vestMat.specularColor = new Color3(0.2, 0.2, 0.2);

    const accentMat = new StandardMaterial(`soldierAcc_${this.id}`, this.scene);
    accentMat.diffuseColor = Color3.FromHexString(accentColorHex);

    const helmetMat = new StandardMaterial(`soldierHelmet_${this.id}`, this.scene);
    helmetMat.diffuseColor = Color3.FromHexString(CONFIG.COLORS.TACTICAL_HELMET);
    helmetMat.specularColor = new Color3(0.3, 0.3, 0.3);

    const skinMat = new StandardMaterial(`soldierSkin_${this.id}`, this.scene);
    skinMat.diffuseColor = Color3.FromHexString(CONFIG.COLORS.TACTICAL_SKIN);
    skinMat.specularColor = new Color3(0.1, 0.1, 0.1);

    const pantsMat = new StandardMaterial(`soldierPants_${this.id}`, this.scene);
    pantsMat.diffuseColor = Color3.FromHexString(CONFIG.COLORS.TACTICAL_PANTS);
    pantsMat.specularColor = new Color3(0.1, 0.1, 0.1);

    const bootsMat = new StandardMaterial(`soldierBoots_${this.id}`, this.scene);
    bootsMat.diffuseColor = Color3.FromHexString(CONFIG.COLORS.TACTICAL_BOOTS);

    const weaponMat = new StandardMaterial(`soldierWepMat_${this.id}`, this.scene);
    weaponMat.diffuseColor = new Color3(0.15, 0.16, 0.19);
    weaponMat.specularColor = new Color3(0.55, 0.58, 0.62);

    const steelMat = new StandardMaterial(`soldierSteelMat_${this.id}`, this.scene);
    steelMat.diffuseColor = new Color3(0.75, 0.78, 0.82);
    steelMat.specularColor = new Color3(0.9, 0.9, 1.0);

    const visorMat = new StandardMaterial(`soldierVisor_${this.id}`, this.scene);
    visorMat.diffuseColor = new Color3(0.05, 0.15, 0.25);
    visorMat.emissiveColor = new Color3(0.0, 0.3, 0.45);
    visorMat.specularColor = new Color3(0.9, 0.9, 1.0);

    // ==========================================
    // 1. TORSO & TACTICAL VEST
    // ==========================================
    this.torso = MeshBuilder.CreateBox(
      `sTorso_${this.id}`,
      { width: 0.68, height: 0.78, depth: 0.38 },
      this.scene
    );
    this.torso.parent = this.rootNode;
    this.torso.position.y = 1.25;
    this.torso.material = vestMat;
    this.torso.isPickable = false;

    // Tactical Vest Chest Plate
    const chestPlate = MeshBuilder.CreateBox(`sChestPlate_${this.id}`, { width: 0.62, height: 0.44, depth: 0.08 }, this.scene);
    chestPlate.parent = this.torso;
    chestPlate.position = new Vector3(0, 0.12, 0.18);
    chestPlate.material = accentMat;
    chestPlate.isPickable = false;

    // Ammo Pouches on Belt
    for (let i = -1; i <= 1; i++) {
      const pouch = MeshBuilder.CreateBox(`sPouch_${i}_${this.id}`, { width: 0.12, height: 0.15, depth: 0.08 }, this.scene);
      pouch.parent = this.torso;
      pouch.position = new Vector3(i * 0.18, -0.26, 0.19);
      pouch.material = helmetMat;
      pouch.isPickable = false;
    }

    // ==========================================
    // 2. HEAD & TACTICAL COMBAT HELMET
    // ==========================================
    this.head = MeshBuilder.CreateBox(
      `sHead_${this.id}`,
      { width: 0.40, height: 0.42, depth: 0.40 },
      this.scene
    );
    this.head.parent = this.rootNode;
    this.head.position.y = 1.88;
    this.head.material = skinMat;
    this.head.isPickable = false;

    // Tactical Fast-Ops Helmet
    const helmet = MeshBuilder.CreateSphere(
      `sHelmet_${this.id}`,
      { diameterX: 0.48, diameterY: 0.42, diameterZ: 0.50, segments: 8 },
      this.scene
    );
    helmet.parent = this.head;
    helmet.position.y = 0.12;
    helmet.material = helmetMat;
    helmet.isPickable = false;

    // Tactical Night Vision Goggles / Sun Visor
    const visor = MeshBuilder.CreateBox(
      `sVisor_${this.id}`,
      { width: 0.34, height: 0.12, depth: 0.14 },
      this.scene
    );
    visor.parent = this.head;
    visor.position = new Vector3(0, 0.04, 0.20);
    visor.material = visorMat;
    visor.isPickable = false;

    // Tactical Headset Ear Cups
    [-0.22, 0.22].forEach((x, idx) => {
      const earCup = MeshBuilder.CreateCylinder(`sEarCup_${idx}_${this.id}`, { height: 0.06, diameter: 0.12 }, this.scene);
      earCup.parent = this.head;
      earCup.rotation.z = Math.PI / 2;
      earCup.position.set(x, 0.02, 0);
      earCup.material = helmetMat;
      earCup.isPickable = false;
    });

    // ==========================================
    // 3. UPPER BODY AIM PIVOT & ARMS
    // ==========================================
    this.upperBodyAimPivot = new TransformNode(`sAimPivot_${this.id}`, this.scene);
    this.upperBodyAimPivot.parent = this.rootNode;
    this.upperBodyAimPivot.position.set(0, 1.45, 0);

    // Right Arm (Weapon Grip)
    this.rightArmPivot = new TransformNode(`sRightArmPivot_${this.id}`, this.scene);
    this.rightArmPivot.parent = this.upperBodyAimPivot;
    this.rightArmPivot.position = new Vector3(0.44, 0.12, -0.04);

    this.rightArm = MeshBuilder.CreateBox(
      `sRightArm_${this.id}`,
      { width: 0.24, height: 0.72, depth: 0.24 },
      this.scene
    );
    this.rightArm.parent = this.rightArmPivot;
    this.rightArm.position = new Vector3(0, -0.34, 0);
    this.rightArm.material = vestMat;
    this.rightArm.isPickable = false;

    const rightHand = MeshBuilder.CreateBox(`sRightHand_${this.id}`, { width: 0.22, height: 0.18, depth: 0.22 }, this.scene);
    rightHand.parent = this.rightArm;
    rightHand.position = new Vector3(0, -0.28, 0);
    rightHand.material = helmetMat;
    rightHand.isPickable = false;

    // Left Arm (Rifle Fore-end / Combat Support)
    this.leftArmPivot = new TransformNode(`sLeftArmPivot_${this.id}`, this.scene);
    this.leftArmPivot.parent = this.upperBodyAimPivot;
    this.leftArmPivot.position = new Vector3(-0.44, 0.12, 0);

    this.leftArm = MeshBuilder.CreateBox(
      `sLeftArm_${this.id}`,
      { width: 0.24, height: 0.72, depth: 0.24 },
      this.scene
    );
    this.leftArm.parent = this.leftArmPivot;
    this.leftArm.position = new Vector3(0, -0.34, 0);
    this.leftArm.material = vestMat;
    this.leftArm.isPickable = false;

    const leftHand = MeshBuilder.CreateBox(`sLeftHand_${this.id}`, { width: 0.22, height: 0.18, depth: 0.22 }, this.scene);
    leftHand.parent = this.leftArm;
    leftHand.position = new Vector3(0, -0.28, 0);
    leftHand.material = helmetMat;
    leftHand.isPickable = false;

    // ==========================================
    // 4. WEAPONS: SNIPER RIFLE & COMBAT KNIFE
    // ==========================================
    // 4A. Held Heavy Sniper Rifle
    this.sniperRifleMesh = new TransformNode(`sHeldSniper_${this.id}`, this.scene);
    this.sniperRifleMesh.parent = this.upperBodyAimPivot;
    this.sniperRifleMesh.position = new Vector3(0.20, -0.10, 0.40);

    const gunChassis = MeshBuilder.CreateBox(`sGunChassis_${this.id}`, { width: 0.07, height: 0.12, depth: 0.72 }, this.scene);
    gunChassis.parent = this.sniperRifleMesh;
    gunChassis.material = weaponMat;
    gunChassis.isPickable = false;

    const gunBarrel = MeshBuilder.CreateCylinder(`sGunBarrel_${this.id}`, { height: 0.64, diameter: 0.038 }, this.scene);
    gunBarrel.parent = this.sniperRifleMesh;
    gunBarrel.rotation.x = Math.PI / 2;
    gunBarrel.position = new Vector3(0, 0.02, 0.58);
    gunBarrel.material = weaponMat;
    gunBarrel.isPickable = false;

    const gunBrake = MeshBuilder.CreateBox(`sGunBrake_${this.id}`, { width: 0.08, height: 0.06, depth: 0.14 }, this.scene);
    gunBrake.parent = this.sniperRifleMesh;
    gunBrake.position = new Vector3(0, 0.02, 0.92);
    gunBrake.material = weaponMat;
    gunBrake.isPickable = false;

    const gunScope = MeshBuilder.CreateCylinder(`sGunScope_${this.id}`, { height: 0.36, diameter: 0.052 }, this.scene);
    gunScope.parent = this.sniperRifleMesh;
    gunScope.rotation.x = Math.PI / 2;
    gunScope.position = new Vector3(0, 0.10, 0.06);
    gunScope.material = weaponMat;
    gunScope.isPickable = false;

    // SCOPE GLINT / LENS FLARE (Visible when remote player is scoped in!)
    this.scopeGlintMesh = MeshBuilder.CreatePlane(`sScopeGlint_${this.id}`, { size: 0.5 }, this.scene);
    this.scopeGlintMesh.parent = this.sniperRifleMesh;
    this.scopeGlintMesh.position = new Vector3(0, 0.10, 0.28);
    this.scopeGlintMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;

    const glintTex = new DynamicTexture(`glintTex_${this.id}`, 128, this.scene, false);
    const gctx = glintTex.getContext();
    const grad = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, '#00f2fe');
    grad.addColorStop(0.7, 'rgba(0, 242, 254, 0.4)');
    grad.addColorStop(1, 'rgba(0, 242, 254, 0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 128, 128);
    glintTex.update();

    const glintMat = new StandardMaterial(`sGlintMat_${this.id}`, this.scene);
    glintMat.diffuseTexture = glintTex;
    glintMat.emissiveColor = new Color3(1.0, 1.0, 1.0);
    glintMat.opacityTexture = glintTex;
    glintMat.disableLighting = true;
    this.scopeGlintMesh.material = glintMat;
    this.scopeGlintMesh.isVisible = false;
    this.scopeGlintMesh.isPickable = false;

    // Muzzle tip for bot/player shots
    this.muzzleTip = MeshBuilder.CreateBox(`sMuzzleTip_${this.id}`, { size: 0.01 }, this.scene);
    this.muzzleTip.parent = this.sniperRifleMesh;
    this.muzzleTip.position = new Vector3(0, 0.02, 1.02);
    this.muzzleTip.isVisible = false;
    this.muzzleTip.isPickable = false;

    this.muzzleFlash = MeshBuilder.CreateSphere(`sMuzzleFlash_${this.id}`, { diameter: 0.28, segments: 6 }, this.scene);
    this.muzzleFlash.parent = this.muzzleTip;
    const flashMat = new StandardMaterial(`sFlashMat_${this.id}`, this.scene);
    flashMat.emissiveColor = new Color3(1.0, 0.9, 0.3);
    flashMat.disableLighting = true;
    this.muzzleFlash.material = flashMat;
    this.muzzleFlash.isVisible = false;
    this.muzzleFlash.isPickable = false;

    // 4B. Held Tactical Combat Knife
    this.combatKnifeMesh = new TransformNode(`sHeldKnife_${this.id}`, this.scene);
    this.combatKnifeMesh.parent = this.upperBodyAimPivot;
    this.combatKnifeMesh.position = new Vector3(0.24, -0.06, 0.32);
    this.combatKnifeMesh.setEnabled(false); // Initially hidden while sniper active

    const kHandle = MeshBuilder.CreateBox(`sKHandle_${this.id}`, { width: 0.04, height: 0.05, depth: 0.16 }, this.scene);
    kHandle.parent = this.combatKnifeMesh;
    kHandle.material = helmetMat;
    kHandle.isPickable = false;

    const kGuard = MeshBuilder.CreateBox(`sKGuard_${this.id}`, { width: 0.05, height: 0.08, depth: 0.02 }, this.scene);
    kGuard.parent = this.combatKnifeMesh;
    kGuard.position = new Vector3(0, 0, 0.09);
    kGuard.material = weaponMat;
    kGuard.isPickable = false;

    const kBlade = MeshBuilder.CreateBox(`sKBlade_${this.id}`, { width: 0.016, height: 0.06, depth: 0.24 }, this.scene);
    kBlade.parent = this.combatKnifeMesh;
    kBlade.position = new Vector3(0, 0.01, 0.21);
    kBlade.material = steelMat;
    kBlade.isPickable = false;

    // Default 2-handed forward rifle posture
    this.rightArmPivot.rotation.x = -1.15;
    this.rightArmPivot.rotation.y = -0.22;
    this.leftArmPivot.rotation.x = -1.05;
    this.leftArmPivot.rotation.y = 0.52;

    // ==========================================
    // 5. LOWER BODY & TACTICAL BOOTS
    // ==========================================
    this.leftLegPivot = new TransformNode(`sLeftLegPivot_${this.id}`, this.scene);
    this.leftLegPivot.parent = this.rootNode;
    this.leftLegPivot.position = new Vector3(-0.18, 0.85, 0);

    this.leftLeg = MeshBuilder.CreateBox(
      `sLeftLeg_${this.id}`,
      { width: 0.30, height: 0.80, depth: 0.30 },
      this.scene
    );
    this.leftLeg.parent = this.leftLegPivot;
    this.leftLeg.position = new Vector3(0, -0.38, 0);
    this.leftLeg.material = pantsMat;
    this.leftLeg.isPickable = false;

    const leftBoot = MeshBuilder.CreateBox(`sLeftBoot_${this.id}`, { width: 0.32, height: 0.22, depth: 0.38 }, this.scene);
    leftBoot.parent = this.leftLeg;
    leftBoot.position = new Vector3(0, -0.34, 0.04);
    leftBoot.material = bootsMat;
    leftBoot.isPickable = false;

    this.rightLegPivot = new TransformNode(`sRightLegPivot_${this.id}`, this.scene);
    this.rightLegPivot.parent = this.rootNode;
    this.rightLegPivot.position = new Vector3(0.18, 0.85, 0);

    this.rightLeg = MeshBuilder.CreateBox(
      `sRightLeg_${this.id}`,
      { width: 0.30, height: 0.80, depth: 0.30 },
      this.scene
    );
    this.rightLeg.parent = this.rightLegPivot;
    this.rightLeg.position = new Vector3(0, -0.38, 0);
    this.rightLeg.material = pantsMat;
    this.rightLeg.isPickable = false;

    const rightBoot = MeshBuilder.CreateBox(`sRightBoot_${this.id}`, { width: 0.32, height: 0.22, depth: 0.38 }, this.scene);
    rightBoot.parent = this.rightLeg;
    rightBoot.position = new Vector3(0, -0.34, 0.04);
    rightBoot.material = bootsMat;
    rightBoot.isPickable = false;

    // ==========================================
    // 6. HITBOXES (Head, Body, Legs)
    // ==========================================
    this.headHitbox = MeshBuilder.CreateSphere(
      `hitbox_head_${this.id}`,
      { diameter: 0.65, segments: 8 },
      this.scene
    );
    this.headHitbox.parent = this.rootNode;
    this.headHitbox.position.y = 1.95;
    this.headHitbox.isVisible = false;
    this.headHitbox.isPickable = true;
    this.headHitbox.metadata = {
      isHitbox: true,
      hitPart: 'head',
      targetId: this.id,
      targetType: this.isBot ? 'bot' : 'player'
    };

    this.bodyHitbox = MeshBuilder.CreateBox(
      `hitbox_body_${this.id}`,
      { width: 0.95, height: 0.80, depth: 0.60 },
      this.scene
    );
    this.bodyHitbox.parent = this.rootNode;
    this.bodyHitbox.position.y = 1.25;
    this.bodyHitbox.isVisible = false;
    this.bodyHitbox.isPickable = true;
    this.bodyHitbox.metadata = {
      isHitbox: true,
      hitPart: 'body',
      targetId: this.id,
      targetType: this.isBot ? 'bot' : 'player'
    };

    this.legsHitbox = MeshBuilder.CreateBox(
      `hitbox_legs_${this.id}`,
      { width: 0.85, height: 0.85, depth: 0.55 },
      this.scene
    );
    this.legsHitbox.parent = this.rootNode;
    this.legsHitbox.position.y = 0.45;
    this.legsHitbox.isVisible = false;
    this.legsHitbox.isPickable = true;
    this.legsHitbox.metadata = {
      isHitbox: true,
      hitPart: 'legs',
      targetId: this.id,
      targetType: this.isBot ? 'bot' : 'player'
    };

    // ==========================================
    // 7. SPAWN PROTECTION BUBBLE
    // ==========================================
    this.shieldSphere = MeshBuilder.CreateSphere(`soldierShield_${this.id}`, { diameter: 2.6, segments: 16 }, this.scene);
    this.shieldSphere.parent = this.rootNode;
    this.shieldSphere.position.y = 1.2;
    const shieldMat = new StandardMaterial(`soldierShieldMat_${this.id}`, this.scene);
    shieldMat.diffuseColor = new Color3(0.0, 0.95, 1.0);
    shieldMat.emissiveColor = new Color3(0.0, 0.8, 1.0);
    shieldMat.alpha = 0.35;
    this.shieldSphere.material = shieldMat;
    this.shieldSphere.isVisible = false;
    this.shieldSphere.isPickable = false;

    // Add shadow casters
    if (this.shadowGenerator) {
      this.shadowGenerator.addShadowCaster(this.torso);
      this.shadowGenerator.addShadowCaster(this.head);
      this.shadowGenerator.addShadowCaster(this.leftLeg);
      this.shadowGenerator.addShadowCaster(this.rightLeg);
    }
  }

  // Floating Billboard with Callsign & Mini HP Bar
  createFloatingNameTag() {
    this.nameTagPlane = MeshBuilder.CreatePlane(`nameTagPlane_${this.id}`, { width: 1.8, height: 0.45 }, this.scene);
    this.nameTagPlane.parent = this.rootNode;
    this.nameTagPlane.position.y = 2.45;
    this.nameTagPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.nameTagPlane.isPickable = false;

    this.nameTagTexture = new DynamicTexture(`nameTagTex_${this.id}`, { width: 256, height: 64 }, this.scene, false);
    this.nameTagTexture.hasAlpha = true;

    const tagMat = new StandardMaterial(`nameTagMat_${this.id}`, this.scene);
    tagMat.diffuseTexture = this.nameTagTexture;
    tagMat.emissiveColor = new Color3(1, 1, 1);
    tagMat.disableLighting = true;
    this.nameTagPlane.material = tagMat;

    this.updateNameTag();
  }

  updateNameTag() {
    if (!this.nameTagTexture) return;

    const ctx = this.nameTagTexture.getContext();
    ctx.clearRect(0, 0, 256, 64);

    // Background pill (with cross-browser fallback for roundRect)
    ctx.fillStyle = 'rgba(10, 15, 26, 0.75)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(4, 4, 248, 56, 8);
    } else {
      ctx.rect(4, 4, 248, 56);
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Callsign Name
    ctx.fillStyle = this.playerNumber === 1 ? '#ff6b81' : (this.isBot ? '#ffa502' : '#70a1ff');
    ctx.font = 'bold 20px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.name.toUpperCase(), 128, 28);

    // Mini Health Bar Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(28, 38, 200, 12);

    // Mini Health Bar Fill (green -> yellow -> red)
    const pct = Math.max(0, Math.min(1.0, this.health / 100));
    let hpColor = '#10b981';
    if (pct < 0.35) {
      hpColor = '#ef4444';
    } else if (pct < 0.65) {
      hpColor = '#f59e0b';
    }

    ctx.fillStyle = hpColor;
    ctx.fillRect(30, 40, 196 * pct, 8);

    this.nameTagTexture.update();
  }

  setName(newName) {
    this.name = newName;
    this.updateNameTag();
  }

  setActiveWeapon(weaponId) {
    this.activeWeapon = weaponId === 'knife' ? 'knife' : 'sniper';
    const isSniper = this.activeWeapon === 'sniper';
    this.sniperRifleMesh.setEnabled(isSniper);
    this.combatKnifeMesh.setEnabled(!isSniper);
  }

  setScopedState(scoped) {
    this.isScoped = !!scoped;
    if (this.scopeGlintMesh) {
      this.scopeGlintMesh.isVisible = this.isScoped && this.activeWeapon === 'sniper' && this.isAlive;
    }
  }

  triggerShotVisual() {
    this.recoilTimer = 0.08;
    this.muzzleFlashTimer = 0.05;
    if (this.muzzleFlash) this.muzzleFlash.isVisible = true;
  }

  triggerMeleeVisual() {
    this.meleeSwingTimer = 0.25;
  }

  getMuzzleWorldPosition() {
    if (this.muzzleTip) {
      return this.muzzleTip.getAbsolutePosition();
    }
    return this.rootNode.position.add(new Vector3(0, 1.5, 0.8));
  }

  setAimTarget(targetWorldPos) {
    const fromY = this.rootNode.position.y + 1.45;
    const dy = targetWorldPos.y - fromY;
    const dx = targetWorldPos.x - this.rootNode.position.x;
    const dz = targetWorldPos.z - this.rootNode.position.z;
    const distHoriz = Math.hypot(dx, dz);

    if (distHoriz > 0.1) {
      this.aimPitch = Math.atan2(-dy, distHoriz);
      this.aimPitch = Math.max(-0.85, Math.min(0.85, this.aimPitch));
    }
  }

  triggerRagdoll(impactPoint, bulletDirection, isHeadshot = false) {
    this.isRagdoll = true;
    this.ragdollTime = 0;
    this.ragdollParts = [];

    if (this.nameTagPlane) this.nameTagPlane.isVisible = false;
    if (this.scopeGlintMesh) this.scopeGlintMesh.isVisible = false;

    const partsToSim = [
      { mesh: this.torso, minY: 0.35 },
      { mesh: this.head, minY: 0.25 },
      { mesh: this.leftArm, minY: 0.2 },
      { mesh: this.rightArm, minY: 0.2 },
      { mesh: this.leftLeg, minY: 0.2 },
      { mesh: this.rightLeg, minY: 0.2 }
    ];

    partsToSim.forEach((p) => {
      if (!p.mesh) return;
      const worldPos = p.mesh.getAbsolutePosition().clone();
      const localPos = worldPos.subtract(this.rootNode.position);

      p.mesh.parent = this.rootNode;
      p.mesh.position.copyFrom(localPos);

      let vx = bulletDirection.x * 5.2 + (Math.random() - 0.5) * 3.0;
      let vy = 2.2 + Math.random() * 2.8;
      let vz = bulletDirection.z * 5.2 + (Math.random() - 0.5) * 3.0;

      if (p.mesh === this.head && isHeadshot) {
        vy = 6.8 + Math.random() * 3.0;
        vx *= 1.8;
        vz *= 1.8;
      }

      this.ragdollParts.push({
        mesh: p.mesh,
        pos: localPos,
        vx,
        vy,
        vz,
        rotVx: (Math.random() - 0.5) * 9.0,
        rotVy: (Math.random() - 0.5) * 9.0,
        rotVz: (Math.random() - 0.5) * 9.0,
        minY: p.minY
      });
    });
  }

  resetRagdoll() {
    this.isRagdoll = false;
    this.ragdollTime = 0;
    this.ragdollParts = [];

    if (this.nameTagPlane) this.nameTagPlane.isVisible = true;

    if (this.torso) {
      this.torso.parent = this.rootNode;
      this.torso.position.set(0, 1.25, 0);
      this.torso.rotation.set(0, 0, 0);
      this.torso.visibility = 1.0;
    }
    if (this.head) {
      this.head.parent = this.rootNode;
      this.head.position.set(0, 1.88, 0);
      this.head.rotation.set(0, 0, 0);
      this.head.visibility = 1.0;
    }
    if (this.leftArm) {
      this.leftArm.parent = this.leftArmPivot;
      this.leftArm.position.set(0, -0.34, 0);
      this.leftArm.rotation.set(0, 0, 0);
      this.leftArm.visibility = 1.0;
    }
    if (this.rightArm) {
      this.rightArm.parent = this.rightArmPivot;
      this.rightArm.position.set(0, -0.34, 0);
      this.rightArm.rotation.set(0, 0, 0);
      this.rightArm.visibility = 1.0;
    }
    if (this.leftLeg) {
      this.leftLeg.parent = this.leftLegPivot;
      this.leftLeg.position.set(0, -0.38, 0);
      this.leftLeg.rotation.set(0, 0, 0);
      this.leftLeg.visibility = 1.0;
    }
    if (this.rightLeg) {
      this.rightLeg.parent = this.rightLegPivot;
      this.rightLeg.position.set(0, -0.38, 0);
      this.rightLeg.rotation.set(0, 0, 0);
      this.rightLeg.visibility = 1.0;
    }
    this.updateNameTag();
  }

  pushNetworkUpdate(update) {
    this.positionBuffer.push({
      x: update.position.x,
      y: update.position.y,
      z: update.position.z,
      rotY: update.rotation ? update.rotation.y : 0,
      pitch: update.rotation ? update.rotation.x : 0,
      timestamp: update.timestamp || Date.now()
    });

    if (this.positionBuffer.length > 20) {
      this.positionBuffer.shift();
    }

    if (update.health !== undefined && update.health !== this.health) {
      this.health = update.health;
      this.updateNameTag();
    }
    if (update.isAlive !== undefined) {
      this.setVisible(update.isAlive);
    }
    if (update.isProtected !== undefined) {
      this.setProtected(update.isProtected);
    }
    if (update.activeWeapon) {
      this.setActiveWeapon(update.activeWeapon);
    }
    if (update.isScoped !== undefined) {
      this.setScopedState(update.isScoped);
    }
    if (update.name && update.name !== this.name) {
      this.setName(update.name);
    }
  }

  update(deltaTime, currentSpeed = 0) {
    if (!this.isAlive && !this.isRagdoll) return;

    const dt = Math.min(0.08, deltaTime / 1000);

    // Ragdoll physics simulation
    if (this.isRagdoll) {
      this.ragdollTime += dt;
      this.ragdollParts.forEach(part => {
        part.pos.x += part.vx * dt;
        part.pos.y += part.vy * dt;
        part.pos.z += part.vz * dt;
        part.vy -= 18.0 * dt;

        if (part.pos.y < part.minY) {
          part.pos.y = part.minY;
          part.vy = -part.vy * 0.25;
          part.vx *= 0.65;
          part.vz *= 0.65;
        }

        part.mesh.position.copyFrom(part.pos);
        part.mesh.rotation.x += part.rotVx * dt;
        part.mesh.rotation.y += part.rotVy * dt;
        part.mesh.rotation.z += part.rotVz * dt;

        if (this.ragdollTime > 1.2) {
          part.mesh.visibility = Math.max(0, (2.0 - this.ragdollTime) / 0.8);
        }
      });
      return;
    }

    // Muzzle flash decay
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0 && this.muzzleFlash) {
        this.muzzleFlash.isVisible = false;
      }
    }

    // Melee slash visual
    let meleeArmRotX = 0;
    let meleeArmRotY = 0;
    if (this.meleeSwingTimer > 0) {
      this.meleeSwingTimer -= dt;
      const progress = 1.0 - (this.meleeSwingTimer / 0.25);
      meleeArmRotX = -Math.sin(progress * Math.PI) * 0.8;
      meleeArmRotY = -Math.sin(progress * Math.PI) * 0.6;
    }

    // Upper body vertical aim pitch
    this.upperBodyAimPivot.rotation.x = this.lerpAngle(
      this.upperBodyAimPivot.rotation.x,
      this.aimPitch,
      14 * dt
    );

    // Interpolation from positionBuffer (100ms interpolation delay)
    let moveSpeed = currentSpeed;

    if (this.positionBuffer.length >= 2) {
      const renderTimestamp = Date.now() - CONFIG.NETWORK.INTERPOLATION_OFFSET_MS;
      let p0 = this.positionBuffer[0];
      let p1 = this.positionBuffer[1];

      for (let i = 0; i < this.positionBuffer.length - 1; i++) {
        if (
          this.positionBuffer[i].timestamp <= renderTimestamp &&
          renderTimestamp <= this.positionBuffer[i + 1].timestamp
        ) {
          p0 = this.positionBuffer[i];
          p1 = this.positionBuffer[i + 1];
          break;
        }
      }

      const totalSpan = p1.timestamp - p0.timestamp;
      let alpha = totalSpan > 0 ? (renderTimestamp - p0.timestamp) / totalSpan : 1.0;
      alpha = Math.max(0, Math.min(1.5, alpha));

      this.targetPosition.x = p0.x + (p1.x - p0.x) * alpha;
      this.targetPosition.y = p0.y + (p1.y - p0.y) * alpha;
      this.targetPosition.z = p0.z + (p1.z - p0.z) * alpha;
      this.targetRotationY = this.lerpAngle(p0.rotY, p1.rotY, alpha);
      if (p1.pitch !== undefined) {
        this.aimPitch = p0.pitch + (p1.pitch - p0.pitch) * alpha;
      }

      const dx = this.targetPosition.x - this.rootNode.position.x;
      const dz = this.targetPosition.z - this.rootNode.position.z;
      moveSpeed = Math.hypot(dx, dz) / Math.max(0.001, dt);

      this.rootNode.position.x += dx * Math.min(1.0, 18 * dt);
      this.rootNode.position.y += (this.targetPosition.y - this.rootNode.position.y) * Math.min(1.0, 18 * dt);
      this.rootNode.position.z += dz * Math.min(1.0, 18 * dt);
      this.rootNode.rotation.y = this.lerpAngle(this.rootNode.rotation.y, this.targetRotationY, 15 * dt);
    }

    // Procedural Animation System
    const isMoving = moveSpeed > 0.35;
    const isKnife = this.activeWeapon === 'knife';

    if (isMoving) {
      const animRate = Math.min(18.0, Math.max(8.0, moveSpeed * 1.6));
      this.walkAnimTimer += dt * animRate;

      const legAngle = Math.sin(this.walkAnimTimer) * 0.72;
      this.leftLegPivot.rotation.x = legAngle;
      this.rightLegPivot.rotation.x = -legAngle;

      this.torso.position.y = 1.25 + Math.abs(Math.sin(this.walkAnimTimer)) * 0.05;
      this.torso.rotation.x = 0.12;

      const armSway = Math.sin(this.walkAnimTimer) * 0.10;
      if (isKnife) {
        this.rightArmPivot.rotation.x = -0.75 + armSway + meleeArmRotX;
        this.rightArmPivot.rotation.y = 0.20 + meleeArmRotY;
        this.leftArmPivot.rotation.x = 0.40 - armSway;
        this.leftArmPivot.rotation.y = 0.10;
      } else {
        this.rightArmPivot.rotation.x = -1.15 + armSway + meleeArmRotX;
        this.leftArmPivot.rotation.x = -1.05 - armSway;
      }
    } else {
      this.idleTimer += dt * 2.2;
      const breathe = Math.sin(this.idleTimer) * 0.02;

      this.leftLegPivot.rotation.x = this.lerpAngle(this.leftLegPivot.rotation.x, 0, 12 * dt);
      this.rightLegPivot.rotation.x = this.lerpAngle(this.rightLegPivot.rotation.x, 0, 12 * dt);

      this.torso.position.y = 1.25 + breathe;
      this.torso.rotation.x = 0;

      if (isKnife) {
        this.rightArmPivot.rotation.x = -0.75 + breathe * 0.5 + meleeArmRotX;
        this.rightArmPivot.rotation.y = 0.20 + meleeArmRotY;
        this.leftArmPivot.rotation.x = 0.20 + breathe * 0.3;
        this.leftArmPivot.rotation.y = 0.10;
      } else {
        this.rightArmPivot.rotation.x = -1.15 + breathe * 0.5 + meleeArmRotX;
        this.leftArmPivot.rotation.x = -1.05 - breathe * 0.5;
      }
    }

    this.position.copyFrom(this.rootNode.position);
    this.rotationY = this.rootNode.rotation.y;
  }

  lerpAngle(a, b, t) {
    let diff = (b - a) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * Math.min(1.0, Math.max(0, t));
  }

  setPositionAndRotation(pos, rotY) {
    this.rootNode.position.set(pos.x, pos.y, pos.z);
    this.rootNode.rotation.y = rotY;
    this.position.copyFrom(this.rootNode.position);
    this.rotationY = rotY;
    this.positionBuffer = [];
  }

  setVisible(visible) {
    this.isAlive = visible;
    this.torso.isVisible = visible;
    this.head.isVisible = visible;
    this.leftArm.isVisible = visible;
    this.rightArm.isVisible = visible;
    this.leftLeg.isVisible = visible;
    this.rightLeg.isVisible = visible;
    this.headHitbox.isPickable = visible;
    this.bodyHitbox.isPickable = visible;
    this.legsHitbox.isPickable = visible;

    if (this.nameTagPlane) this.nameTagPlane.isVisible = visible;

    const isSniper = this.activeWeapon === 'sniper';
    this.sniperRifleMesh.setEnabled(visible && isSniper);
    this.combatKnifeMesh.setEnabled(visible && !isSniper);

    if (!visible) {
      this.shieldSphere.isVisible = false;
      if (this.muzzleFlash) this.muzzleFlash.isVisible = false;
      if (this.scopeGlintMesh) this.scopeGlintMesh.isVisible = false;
    }
  }

  setProtected(isProt) {
    this.isProtected = isProt;
    if (this.shieldSphere) {
      this.shieldSphere.isVisible = isProt && this.isAlive;
    }
  }

  dispose() {
    this.rootNode.dispose();
  }
}
