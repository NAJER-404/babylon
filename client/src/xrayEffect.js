// X-Ray Kill Cam Effect: Reveals Internal Skeleton & See-Through Fresnel Silhouette
import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode
} from '@babylonjs/core';

export class XRayEffect {
  constructor(scene, audioManager) {
    this.scene = scene;
    this.audio = audioManager;
    this.isActive = false;
    this.activeCharacter = null;
    this.originalMaterials = new Map();

    this.createMaterials();
  }

  createMaterials() {
    // 1. Glowing Bone Material
    this.boneMat = new StandardMaterial('xrayBoneMat', this.scene);
    this.boneMat.diffuseColor = new Color3(0.95, 0.98, 1.0);
    this.boneMat.emissiveColor = new Color3(0.45, 0.75, 1.0);
    this.boneMat.specularColor = new Color3(0.9, 0.95, 1.0);
    this.boneMat.specularPower = 64;

    // 2. See-Through Holographic X-Ray Flesh Silhouette
    this.fleshMat = new StandardMaterial('xrayFleshMat', this.scene);
    this.fleshMat.diffuseColor = new Color3(0.0, 0.6, 0.95);
    this.fleshMat.emissiveColor = new Color3(0.05, 0.35, 0.6);
    this.fleshMat.alpha = 0.28;
    this.fleshMat.backFaceCulling = false;
  }

  // Attach an internal skeleton mesh to an OpponentCharacter
  attachSkeleton(character) {
    if (character.skeletonRoot) return;

    const root = new TransformNode(`skeleton_${character.id}`, this.scene);
    root.parent = character.rootNode;
    root.position.set(0, 0, 0);

    // --- A. SKULL ---
    const skull = MeshBuilder.CreateBox(
      `skull_${character.id}`,
      { width: 0.34, height: 0.36, depth: 0.34 },
      this.scene
    );
    skull.parent = root;
    skull.position.set(0, 2.0, 0);
    skull.material = this.boneMat;
    skull.isPickable = false;

    // Eye sockets
    const eyeSocketL = MeshBuilder.CreateBox(`eyeL_${character.id}`, { width: 0.08, height: 0.08, depth: 0.04 }, this.scene);
    eyeSocketL.parent = skull;
    eyeSocketL.position.set(-0.09, 0.04, 0.16);
    const darkMat = new StandardMaterial('darkSocket', this.scene);
    darkMat.diffuseColor = new Color3(0.05, 0.1, 0.2);
    eyeSocketL.material = darkMat;

    const eyeSocketR = MeshBuilder.CreateBox(`eyeR_${character.id}`, { width: 0.08, height: 0.08, depth: 0.04 }, this.scene);
    eyeSocketR.parent = skull;
    eyeSocketR.position.set(0.09, 0.04, 0.16);
    eyeSocketR.material = darkMat;

    // Jawbone
    const jaw = MeshBuilder.CreateBox(`jaw_${character.id}`, { width: 0.26, height: 0.10, depth: 0.24 }, this.scene);
    jaw.parent = skull;
    jaw.position.set(0, -0.16, 0.04);
    jaw.material = this.boneMat;

    // --- B. SPINE & CERVICAL VERTEBRAE ---
    const spineColumn = new TransformNode(`spine_${character.id}`, this.scene);
    spineColumn.parent = root;
    spineColumn.position.set(0, 1.35, -0.04);

    for (let v = 0; v < 6; v++) {
      const vert = MeshBuilder.CreateBox(
        `vert_${character.id}_${v}`,
        { width: 0.12, height: 0.09, depth: 0.12 },
        this.scene
      );
      vert.parent = spineColumn;
      vert.position.set(0, -0.3 + v * 0.12, 0);
      vert.material = this.boneMat;
      vert.isPickable = false;
    }

    // --- C. RIBCAGE ---
    const ribcage = new TransformNode(`ribcage_${character.id}`, this.scene);
    ribcage.parent = root;
    ribcage.position.set(0, 1.38, 0);

    // Sternum
    const sternum = MeshBuilder.CreateBox(
      `sternum_${character.id}`,
      { width: 0.08, height: 0.45, depth: 0.04 },
      this.scene
    );
    sternum.parent = ribcage;
    sternum.position.set(0, 0, 0.16);
    sternum.material = this.boneMat;

    // 4 Pairs of Curved Ribs
    for (let r = 0; r < 4; r++) {
      const ribL = MeshBuilder.CreateTorus(
        `ribL_${character.id}_${r}`,
        { diameter: 0.44, thickness: 0.024, tessellation: 16 },
        this.scene
      );
      ribL.parent = ribcage;
      ribL.position.set(-0.11, -0.16 + r * 0.11, 0);
      ribL.scaling.set(0.65, 0.4, 0.8);
      ribL.material = this.boneMat;
      ribL.isPickable = false;

      const ribR = MeshBuilder.CreateTorus(
        `ribR_${character.id}_${r}`,
        { diameter: 0.44, thickness: 0.024, tessellation: 16 },
        this.scene
      );
      ribR.parent = ribcage;
      ribR.position.set(0.11, -0.16 + r * 0.11, 0);
      ribR.scaling.set(0.65, 0.4, 0.8);
      ribR.material = this.boneMat;
      ribR.isPickable = false;
    }

    // --- D. PELVIS & LEG BONES ---
    const pelvis = MeshBuilder.CreateBox(
      `pelvis_${character.id}`,
      { width: 0.52, height: 0.18, depth: 0.28 },
      this.scene
    );
    pelvis.parent = root;
    pelvis.position.set(0, 0.9, 0);
    pelvis.material = this.boneMat;

    // Femurs (Thigh bones)
    const femurL = MeshBuilder.CreateCylinder(`femurL_${character.id}`, { height: 0.55, diameter: 0.06 }, this.scene);
    femurL.parent = root;
    femurL.position.set(-0.21, 0.55, 0);
    femurL.material = this.boneMat;

    const femurR = MeshBuilder.CreateCylinder(`femurR_${character.id}`, { height: 0.55, diameter: 0.06 }, this.scene);
    femurR.parent = root;
    femurR.position.set(0.21, 0.55, 0);
    femurR.material = this.boneMat;

    // Initially hide skeleton
    root.setEnabled(false);
    character.skeletonRoot = root;
  }

  // Activate X-Ray see-through effect on victim character
  enable(character) {
    if (!character || !character.rootNode) return;
    this.isActive = true;
    this.activeCharacter = character;

    // Ensure skeleton exists
    this.attachSkeleton(character);

    // Save and swap outer materials to translucent X-ray flesh
    const bodyMeshes = [
      character.torso,
      character.head,
      character.leftArm,
      character.rightArm,
      character.leftLeg,
      character.rightLeg
    ];

    bodyMeshes.forEach(mesh => {
      if (mesh) {
        if (!this.originalMaterials.has(mesh)) {
          this.originalMaterials.set(mesh, mesh.material);
        }
        mesh.material = this.fleshMat;
      }
    });

    // Make internal skeleton visible
    if (character.skeletonRoot) {
      character.skeletonRoot.setEnabled(true);
    }

    // Play subtle high-tech X-Ray pulse sound
    if (this.audio) {
      this.audio.playTone(280, 'sine', 0.28, this.audio.ctx?.currentTime || 0, 0.35);
      this.audio.playTone(560, 'triangle', 0.25, (this.audio.ctx?.currentTime || 0) + 0.04, 0.25);
    }
  }

  // Restore victim character to original materials
  disable() {
    if (!this.isActive) return;
    this.isActive = false;

    if (this.activeCharacter) {
      // Hide skeleton
      if (this.activeCharacter.skeletonRoot) {
        this.activeCharacter.skeletonRoot.setEnabled(false);
      }

      // Restore original materials
      this.originalMaterials.forEach((mat, mesh) => {
        if (mesh && !mesh.isDisposed()) {
          mesh.material = mat;
        }
      });
      this.originalMaterials.clear();
      this.activeCharacter = null;
    }
  }
}
