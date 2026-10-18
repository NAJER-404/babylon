// Stylized Blood Splatter: Pre-Allocated 30-Decal Pool & Zero-Allocation Particle Burst
import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  ParticleSystem,
  DynamicTexture
} from '@babylonjs/core';

export class BloodEffect {
  constructor(scene, audioManager) {
    this.scene = scene;
    this.audio = audioManager;

    // Pre-allocated Decal Pool (exactly 30 discs, recycling oldest)
    this.maxSplatters = 30;
    this.splatterPool = [];
    this.poolIndex = 0;

    this.createMaterials();
    this.setupParticleSystem();
    this.setupDecalPool();
  }

  createMaterials() {
    this.splatterMat = new StandardMaterial('bloodSplatterMat', this.scene);
    this.splatterMat.diffuseColor = new Color3(0.55, 0.04, 0.08);
    this.splatterMat.emissiveColor = new Color3(0.22, 0.01, 0.03);
    this.splatterMat.specularColor = new Color3(0.6, 0.15, 0.15);
    this.splatterMat.alpha = 0.9;
    this.splatterMat.backFaceCulling = false;
  }

  setupParticleSystem() {
    this.particleSystem = new ParticleSystem('bloodParticles', 300, this.scene);

    const particleTex = new DynamicTexture('bloodDropTex', 64, this.scene, false);
    const ctx = particleTex.getContext();
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#7f1d1d';
    ctx.beginPath();
    ctx.arc(32, 32, 16, 0, Math.PI * 2);
    ctx.fill();
    particleTex.update();

    this.particleSystem.particleTexture = particleTex;
    this.particleSystem.emitter = new Vector3(0, 0, 0);
    this.particleSystem.minEmitBox = new Vector3(-0.05, -0.05, -0.05);
    this.particleSystem.maxEmitBox = new Vector3(0.05, 0.05, 0.05);

    this.particleSystem.color1 = new Color4(0.85, 0.08, 0.12, 1.0);
    this.particleSystem.color2 = new Color4(0.55, 0.02, 0.05, 0.9);
    this.particleSystem.colorDead = new Color4(0.25, 0.01, 0.02, 0.0);

    this.particleSystem.minSize = 0.08;
    this.particleSystem.maxSize = 0.22;
    this.particleSystem.minLifeTime = 0.35;
    this.particleSystem.maxLifeTime = 0.75;
    this.particleSystem.emitRate = 0;
    this.particleSystem.gravity = new Vector3(0, -18.0, 0);
    this.particleSystem.minEmitPower = 3.5;
    this.particleSystem.maxEmitPower = 8.5;
    this.particleSystem.updateSpeed = 0.016;
    this.particleSystem.start();
  }

  // Pre-allocate 30 floor decals to avoid creating meshes and materials per hit
  setupDecalPool() {
    for (let i = 0; i < this.maxSplatters; i++) {
      const puddle = MeshBuilder.CreateDisc(
        `pooledBloodPuddle_${i}`,
        { radius: 0.75, tessellation: 12 },
        this.scene
      );
      puddle.rotation.x = Math.PI / 2;
      puddle.material = this.splatterMat;
      puddle.isPickable = false;
      puddle.isVisible = false;

      this.splatterPool.push({
        mesh: puddle,
        active: false,
        age: 0,
        maxAge: 4.0
      });
    }
  }

  spawnBloodBurst(impactPoint, bulletDirection) {
    this.particleSystem.emitter = impactPoint.clone();
    this.particleSystem.direction1 = bulletDirection.add(new Vector3(-0.6, 0.4, -0.6)).normalize();
    this.particleSystem.direction2 = bulletDirection.add(new Vector3(0.6, 0.8, 0.6)).normalize();
    this.particleSystem.manualEmitCount = 180;

    this.createFloorSplatter(impactPoint);

    if (this.audio) {
      this.playImpactAudio();
    }
  }

  createFloorSplatter(impactPoint) {
    // Recycle next decal in fixed pool (ring buffer)
    const entry = this.splatterPool[this.poolIndex];
    this.poolIndex = (this.poolIndex + 1) % this.maxSplatters;

    const floorY = 0.03;
    entry.mesh.position.set(
      impactPoint.x + (Math.random() - 0.5) * 0.4,
      floorY,
      impactPoint.z + (Math.random() - 0.5) * 0.4
    );
    const s = 0.8 + Math.random() * 0.5;
    entry.mesh.scaling.set(s, s, s);
    entry.mesh.isVisible = true;
    entry.active = true;
    entry.age = 0;
  }

  playImpactAudio() {
    const t = this.audio.ctx?.currentTime || 0;
    this.audio.playTone(160, 'sawtooth', 0.12, t, 0.6);
    this.audio.playTone(70, 'triangle', 0.18, t + 0.02, 0.8);
    this.audio.playTone(420, 'sine', 0.08, t + 0.04, 0.4);
  }

  update(rawDtSec) {
    for (let i = 0; i < this.maxSplatters; i++) {
      const s = this.splatterPool[i];
      if (s.active) {
        s.age += rawDtSec;
        if (s.age >= s.maxAge) {
          s.active = false;
          s.mesh.isVisible = false;
        }
      }
    }
  }

  clear() {
    this.splatterPool.forEach(s => {
      s.active = false;
      s.mesh.isVisible = false;
    });
  }

  dispose() {
    this.splatterPool.forEach(s => s.mesh.dispose());
    this.splatterPool = [];
    if (this.particleSystem) {
      this.particleSystem.dispose();
      this.particleSystem = null;
    }
  }
}
