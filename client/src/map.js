// High-Performance 160x160 Arena Map Builder with Elevated Sniper Towers, Merged Meshes & REJOHN Billboard
import {
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  DirectionalLight,
  HemisphericLight,
  ShadowGenerator,
  DynamicTexture
} from '@babylonjs/core';
import { CONFIG } from './config.js';

export class MapBuilder {
  constructor(scene) {
    this.scene = scene;
    this.shadowGenerator = null;
    this.coverMeshes = [];
    this.staticMeshes = [];
  }

  build() {
    this.scene.clearColor = new Color4(0.35, 0.65, 0.95, 1.0);
    this.scene.skipPointerMovePicking = true;
    this.scene.autoClear = true;
    this.scene.autoClearDepthAndStencil = true;

    this.setupLighting();
    this.createMaterials();
    this.createSkybox();
    this.createFloor();
    this.createPerimeterAndBoundaryWalls();
    this.createSniperWatchtowers();
    this.createFlankBunkers();
    this.createCourtyardMonument();
    this.createPillarsAndBarriers();
    this.createCrates();
    this.createSpawnPads();
    this.createRejohnBillboard();
    this.optimizeStaticMeshes();

    return {
      coverMeshes: this.coverMeshes,
      shadowGenerator: this.shadowGenerator
    };
  }

  setupLighting() {
    // 1. Ambient hemispheric daylight
    const hemiLight = new HemisphericLight(
      'hemiLight',
      new Vector3(0, 1, 0),
      this.scene
    );
    hemiLight.intensity = 0.95;
    hemiLight.diffuse = new Color3(1.0, 1.0, 1.0);
    hemiLight.groundColor = new Color3(0.40, 0.44, 0.52);

    // 2. Directional sunlight for clean shadows across 160x160 map
    const dirLight = new DirectionalLight(
      'dirLight',
      new Vector3(-0.45, -1.0, 0.4).normalize(),
      this.scene
    );
    dirLight.position = new Vector3(80, 120, -80);
    dirLight.intensity = 0.72;
    dirLight.diffuse = new Color3(1.0, 0.98, 0.92);

    // Optimized 1024 shadow map with fitted frustum
    this.shadowGenerator = new ShadowGenerator(1024, dirLight);
    this.shadowGenerator.usePercentageCloserFiltering = true;
    this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_LOW;
    this.shadowGenerator.bias = 0.003;
  }

  createMaterials() {
    // Floor Slate
    this.matFloor = new StandardMaterial('matFloor', this.scene);
    this.matFloor.diffuseColor = Color3.FromHexString(CONFIG.COLORS.FLOOR);
    this.matFloor.specularColor = new Color3(0.12, 0.12, 0.16);

    // Grid Tile Accent
    this.matFloorGrid = new StandardMaterial('matFloorGrid', this.scene);
    this.matFloorGrid.diffuseColor = Color3.FromHexString(CONFIG.COLORS.FLOOR_GRID);
    this.matFloorGrid.specularColor = new Color3(0.10, 0.10, 0.14);

    // Perimeter Walls
    this.matWall = new StandardMaterial('matWall', this.scene);
    this.matWall.diffuseColor = Color3.FromHexString(CONFIG.COLORS.WALLS);
    this.matWall.specularColor = new Color3(0.10, 0.10, 0.12);

    // Neon Cyan Wall Trim
    this.matWallTrim = new StandardMaterial('matWallTrim', this.scene);
    this.matWallTrim.diffuseColor = Color3.FromHexString(CONFIG.COLORS.WALL_TRIM);
    this.matWallTrim.emissiveColor = new Color3(0.04, 0.40, 0.50);

    // Crates
    this.matCrate = new StandardMaterial('matCrate', this.scene);
    this.matCrate.diffuseColor = Color3.FromHexString(CONFIG.COLORS.CRATE);
    this.matCrate.specularColor = new Color3(0.18, 0.14, 0.08);

    this.matCrateTrim = new StandardMaterial('matCrateTrim', this.scene);
    this.matCrateTrim.diffuseColor = Color3.FromHexString(CONFIG.COLORS.CRATE_TRIM);

    // Pillars & Bunkers
    this.matPillar = new StandardMaterial('matPillar', this.scene);
    this.matPillar.diffuseColor = Color3.FromHexString(CONFIG.COLORS.PILLAR);
    this.matPillar.specularColor = new Color3(0.15, 0.15, 0.18);

    // Elevated Platforms
    this.matPlatform = new StandardMaterial('matPlatform', this.scene);
    this.matPlatform.diffuseColor = Color3.FromHexString(CONFIG.COLORS.PLATFORM);
    this.matPlatform.specularColor = new Color3(0.12, 0.12, 0.16);

    this.matPlatformEdge = new StandardMaterial('matPlatformEdge', this.scene);
    this.matPlatformEdge.diffuseColor = Color3.FromHexString(CONFIG.COLORS.PLATFORM_EDGE);
    this.matPlatformEdge.emissiveColor = new Color3(0.18, 0.22, 0.26);

    // Dark Steel Truss
    this.matSteel = new StandardMaterial('matSteel', this.scene);
    this.matSteel.diffuseColor = new Color3(0.14, 0.16, 0.20);
    this.matSteel.specularColor = new Color3(0.5, 0.55, 0.6);

    // Spawn Pads
    this.matSpawnRed = new StandardMaterial('matSpawnRed', this.scene);
    this.matSpawnRed.diffuseColor = Color3.FromHexString(CONFIG.COLORS.ROBLOX_TORSO_RED);
    this.matSpawnRed.emissiveColor = new Color3(0.35, 0.08, 0.08);

    this.matSpawnBlue = new StandardMaterial('matSpawnBlue', this.scene);
    this.matSpawnBlue.diffuseColor = Color3.FromHexString(CONFIG.COLORS.ROBLOX_TORSO_BLUE);
    this.matSpawnBlue.emissiveColor = new Color3(0.08, 0.20, 0.45);
  }

  createSkybox() {
    const skybox = MeshBuilder.CreateBox('skyBox', { size: 900.0 }, this.scene);
    const skyMat = new StandardMaterial('skyMat', this.scene);
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;
    skyMat.diffuseColor = new Color3(0, 0, 0);
    skyMat.emissiveColor = Color3.FromHexString(CONFIG.COLORS.SKY);
    skybox.material = skyMat;
    skybox.infiniteDistance = true;
    skybox.isPickable = false;
    skybox.freezeWorldMatrix();
  }

  createFloor() {
    const size = CONFIG.GAME.MAP_SIZE; // 160
    const floor = MeshBuilder.CreateBox(
      'arenaFloor',
      { width: size, height: 1.0, depth: size },
      this.scene
    );
    floor.position.y = -0.5;
    floor.material = this.matFloor;
    floor.checkCollisions = true;
    floor.receiveShadows = true;
    floor.isPickable = true;
    this.staticMeshes.push(floor);

    // Merged Checkered Grid Tiles (drawn with 1 single merged mesh for max performance)
    const gridStep = 8.0;
    const count = Math.floor(size / gridStep);
    const tileMeshes = [];

    for (let x = -count / 2; x < count / 2; x++) {
      for (let z = -count / 2; z < count / 2; z++) {
        if ((x + z) % 2 === 0) {
          const tile = MeshBuilder.CreateBox(
            `tile_${x}_${z}`,
            { width: gridStep - 0.35, height: 0.02, depth: gridStep - 0.35 },
            this.scene
          );
          tile.position.set(x * gridStep + gridStep / 2, 0.01, z * gridStep + gridStep / 2);
          tileMeshes.push(tile);
        }
      }
    }

    if (tileMeshes.length > 0) {
      const mergedGrid = Mesh.MergeMeshes(tileMeshes, true, true, undefined, false, true);
      if (mergedGrid) {
        mergedGrid.name = 'mergedFloorGrid';
        mergedGrid.material = this.matFloorGrid;
        mergedGrid.receiveShadows = true;
        mergedGrid.isPickable = false;
        mergedGrid.freezeWorldMatrix();
        this.staticMeshes.push(mergedGrid);
      }
    }
  }

  createPerimeterAndBoundaryWalls() {
    const size = CONFIG.GAME.MAP_SIZE; // 160
    const wallHeight = 8.0;
    const wallThickness = 2.0;
    const half = size / 2;

    const wallsData = [
      { name: 'wallNorth', pos: new Vector3(0, wallHeight / 2, half), w: size + wallThickness * 2, h: wallHeight, d: wallThickness },
      { name: 'wallSouth', pos: new Vector3(0, wallHeight / 2, -half), w: size + wallThickness * 2, h: wallHeight, d: wallThickness },
      { name: 'wallEast', pos: new Vector3(half, wallHeight / 2, 0), w: wallThickness, h: wallHeight, d: size },
      { name: 'wallWest', pos: new Vector3(-half, wallHeight / 2, 0), w: wallThickness, h: wallHeight, d: size }
    ];

    wallsData.forEach(data => {
      const wall = MeshBuilder.CreateBox(
        data.name,
        { width: data.w, height: data.h, depth: data.d },
        this.scene
      );
      wall.position = data.pos;
      wall.material = this.matWall;
      wall.checkCollisions = true;
      wall.receiveShadows = true;
      this.shadowGenerator.addShadowCaster(wall);
      this.staticMeshes.push(wall);
      this.coverMeshes.push(wall);

      // Glowing cyan trim
      const trim = MeshBuilder.CreateBox(
        `${data.name}_trim`,
        { width: data.w, height: 0.45, depth: data.d + 0.3 },
        this.scene
      );
      trim.position = new Vector3(data.pos.x, wallHeight - 0.22, data.pos.z);
      trim.material = this.matWallTrim;
      trim.isPickable = false;
      this.staticMeshes.push(trim);
    });

    // Invisible High Boundary Walls to prevent players ever jumping out (reaches up to y = 28)
    const boundHeight = 20.0;
    const boundY = wallHeight + boundHeight / 2;
    const invisibleBounds = [
      { name: 'invBoundN', pos: new Vector3(0, boundY, half), w: size + 4, h: boundHeight, d: 2 },
      { name: 'invBoundS', pos: new Vector3(0, boundY, -half), w: size + 4, h: boundHeight, d: 2 },
      { name: 'invBoundE', pos: new Vector3(half, boundY, 0), w: 2, h: boundHeight, d: size },
      { name: 'invBoundW', pos: new Vector3(-half, boundY, 0), w: 2, h: boundHeight, d: size }
    ];

    invisibleBounds.forEach(b => {
      const boundMesh = MeshBuilder.CreateBox(b.name, { width: b.w, height: b.h, depth: b.d }, this.scene);
      boundMesh.position = b.pos;
      boundMesh.isVisible = false;
      boundMesh.checkCollisions = true;
      boundMesh.isPickable = false;
      boundMesh.freezeWorldMatrix();
    });
  }

  // Two massive elevated Sniper Watchtowers (North at z = 48, South at z = -48) with ramps & perches
  createSniperWatchtowers() {
    const towerConfigs = [
      { name: 'towerNorth', x: 0, z: 48, rotY: 0, height: 4.5, w: 24, d: 14 },
      { name: 'towerSouth', x: 0, z: -48, rotY: Math.PI, height: 4.5, w: 24, d: 14 }
    ];

    towerConfigs.forEach(cfg => {
      // Main platform base
      const tower = MeshBuilder.CreateBox(
        cfg.name,
        { width: cfg.w, height: cfg.height, depth: cfg.d },
        this.scene
      );
      tower.position.set(cfg.x, cfg.height / 2, cfg.z);
      tower.material = this.matPlatform;
      tower.checkCollisions = true;
      tower.receiveShadows = true;
      this.shadowGenerator.addShadowCaster(tower);
      this.staticMeshes.push(tower);
      this.coverMeshes.push(tower);

      // Sniper low barrier for crouch-peeking
      const barrier = MeshBuilder.CreateBox(
        `${cfg.name}_barrier`,
        { width: cfg.w, height: 1.1, depth: 0.8 },
        this.scene
      );
      const barrierZ = cfg.rotY === 0 ? cfg.z - cfg.d / 2 + 0.4 : cfg.z + cfg.d / 2 - 0.4;
      barrier.position.set(cfg.x, cfg.height + 0.55, barrierZ);
      barrier.material = this.matWall;
      barrier.checkCollisions = true;
      barrier.receiveShadows = true;
      this.shadowGenerator.addShadowCaster(barrier);
      this.staticMeshes.push(barrier);
      this.coverMeshes.push(barrier);

      // Access Ramp leading up from center courtyard
      const rampLen = 14.0;
      const rampAngle = Math.atan2(cfg.height, rampLen);
      const ramp = MeshBuilder.CreateBox(
        `${cfg.name}_ramp`,
        { width: 6.0, height: 0.4, depth: rampLen },
        this.scene
      );
      const rampZ = cfg.rotY === 0 ? cfg.z - cfg.d / 2 - rampLen / 2 + 0.3 : cfg.z + cfg.d / 2 + rampLen / 2 - 0.3;
      ramp.position.set(cfg.x, cfg.height / 2 - 0.1, rampZ);
      ramp.rotation.x = cfg.rotY === 0 ? -rampAngle : rampAngle;
      ramp.material = this.matPlatform;
      ramp.checkCollisions = true;
      ramp.receiveShadows = true;
      this.shadowGenerator.addShadowCaster(ramp);
      this.staticMeshes.push(ramp);

      // Upper shelter canopy
      const canopy = MeshBuilder.CreateBox(
        `${cfg.name}_canopy`,
        { width: cfg.w + 1.0, height: 0.5, depth: cfg.d + 1.0 },
        this.scene
      );
      canopy.position.set(cfg.x, cfg.height + 4.2, cfg.z);
      canopy.material = this.matSteel;
      this.shadowGenerator.addShadowCaster(canopy);
      this.staticMeshes.push(canopy);
    });
  }

  // East & West Tactical Flanking Bunkers (Two-story perches at x = 50 and x = -50)
  createFlankBunkers() {
    const bunkerConfigs = [
      { name: 'bunkerEast', x: 50, z: 0, w: 16, d: 24, h: 3.5 },
      { name: 'bunkerWest', x: -50, z: 0, w: 16, d: 24, h: 3.5 }
    ];

    bunkerConfigs.forEach(cfg => {
      const bunker = MeshBuilder.CreateBox(
        cfg.name,
        { width: cfg.w, height: cfg.h, depth: cfg.d },
        this.scene
      );
      bunker.position.set(cfg.x, cfg.h / 2, cfg.z);
      bunker.material = this.matPlatform;
      bunker.checkCollisions = true;
      bunker.receiveShadows = true;
      this.shadowGenerator.addShadowCaster(bunker);
      this.staticMeshes.push(bunker);
      this.coverMeshes.push(bunker);

      // Bunkers have double ramps (North and South approach)
      const rampLen = 10.0;
      const rampAngle = Math.atan2(cfg.h, rampLen);

      const rampN = MeshBuilder.CreateBox(`${cfg.name}_rampN`, { width: 4.8, height: 0.4, depth: rampLen }, this.scene);
      rampN.position.set(cfg.x, cfg.h / 2 - 0.1, cfg.z + cfg.d / 2 + rampLen / 2 - 0.2);
      rampN.rotation.x = rampAngle;
      rampN.material = this.matPlatform;
      rampN.checkCollisions = true;
      this.staticMeshes.push(rampN);

      const rampS = MeshBuilder.CreateBox(`${cfg.name}_rampS`, { width: 4.8, height: 0.4, depth: rampLen }, this.scene);
      rampS.position.set(cfg.x, cfg.h / 2 - 0.1, cfg.z - cfg.d / 2 - rampLen / 2 + 0.2);
      rampS.rotation.x = -rampAngle;
      rampS.material = this.matPlatform;
      rampS.checkCollisions = true;
      this.staticMeshes.push(rampS);
    });
  }

  // Central Architectural Monument & Courtyard Cover blocks
  createCourtyardMonument() {
    // Center raised hub (18x18x1.8m)
    const centerHub = MeshBuilder.CreateBox('centerHub', { width: 20, height: 1.8, depth: 20 }, this.scene);
    centerHub.position.set(0, 0.9, 0);
    centerHub.material = this.matPlatform;
    centerHub.checkCollisions = true;
    centerHub.receiveShadows = true;
    this.shadowGenerator.addShadowCaster(centerHub);
    this.staticMeshes.push(centerHub);
    this.coverMeshes.push(centerHub);

    // Center tall monolith / cover spire
    const spire = MeshBuilder.CreateBox('centerSpire', { width: 4.2, height: 10.0, depth: 4.2 }, this.scene);
    spire.position.set(0, 5.0 + 1.8, 0);
    spire.material = this.matPillar;
    spire.checkCollisions = true;
    spire.receiveShadows = true;
    this.shadowGenerator.addShadowCaster(spire);
    this.staticMeshes.push(spire);
    this.coverMeshes.push(spire);

    // Glowing cyan rim around spire base
    const spireRing = MeshBuilder.CreateBox('spireRing', { width: 4.6, height: 0.4, depth: 4.6 }, this.scene);
    spireRing.position.set(0, 2.0, 0);
    spireRing.material = this.matWallTrim;
    this.staticMeshes.push(spireRing);

    // 4 Ramps leading up to center hub
    const rampW = 5.0;
    const rampLen = 6.0;
    const rampAngle = Math.atan2(1.8, rampLen);

    const rampN = MeshBuilder.CreateBox('hubRampN', { width: rampW, height: 0.35, depth: rampLen }, this.scene);
    rampN.position.set(0, 0.8, 10 + rampLen / 2 - 0.2);
    rampN.rotation.x = rampAngle;
    rampN.material = this.matPlatform;
    rampN.checkCollisions = true;
    this.staticMeshes.push(rampN);

    const rampS = MeshBuilder.CreateBox('hubRampS', { width: rampW, height: 0.35, depth: rampLen }, this.scene);
    rampS.position.set(0, 0.8, -10 - rampLen / 2 + 0.2);
    rampS.rotation.x = -rampAngle;
    rampS.material = this.matPlatform;
    rampS.checkCollisions = true;
    this.staticMeshes.push(rampS);
  }

  // Stone Pillars & Concrete Sightline Barriers
  createPillarsAndBarriers() {
    const pillarCoords = [
      { x: -30, z: -25 }, { x: 30, z: -25 },
      { x: -30, z: 25 }, { x: 30, z: 25 },
      { x: -25, z: 0 }, { x: 25, z: 0 },
      { x: -55, z: -35 }, { x: 55, z: -35 },
      { x: -55, z: 35 }, { x: 55, z: 35 },
      { x: 0, z: -28 }, { x: 0, z: 28 }
    ];

    pillarCoords.forEach((coord, idx) => {
      const pillar = MeshBuilder.CreateBox(
        `pillar_${idx}`,
        { width: 3.0, height: 8.0, depth: 3.0 },
        this.scene
      );
      pillar.position.set(coord.x, 4.0, coord.z);
      pillar.material = this.matPillar;
      pillar.checkCollisions = true;
      pillar.receiveShadows = true;
      this.shadowGenerator.addShadowCaster(pillar);
      this.staticMeshes.push(pillar);
      this.coverMeshes.push(pillar);

      // Glowing neon base ring
      const ring = MeshBuilder.CreateBox(
        `pillarRing_${idx}`,
        { width: 3.4, height: 0.3, depth: 3.4 },
        this.scene
      );
      ring.position.set(coord.x, 0.15, coord.z);
      ring.material = this.matWallTrim;
      this.staticMeshes.push(ring);
    });
  }

  // Tactical Crates arranged in cover clusters
  createCrates() {
    const crateConfigs = [
      // Mid Courtyard Crate Stacks
      { x: -14, y: 1.0, z: -10, w: 2.4, h: 2.0, d: 2.4 },
      { x: 14, y: 1.0, z: -10, w: 2.4, h: 2.0, d: 2.4 },
      { x: -14, y: 1.0, z: 10, w: 2.4, h: 2.0, d: 2.4 },
      { x: 14, y: 1.0, z: 10, w: 2.4, h: 2.0, d: 2.4 },

      // Flank Lane Crate Clusters
      { x: -40, y: 1.0, z: -15, w: 2.6, h: 2.0, d: 2.6 },
      { x: 40, y: 1.0, z: -15, w: 2.6, h: 2.0, d: 2.6 },
      { x: -40, y: 1.0, z: 15, w: 2.6, h: 2.0, d: 2.6 },
      { x: 40, y: 1.0, z: 15, w: 2.6, h: 2.0, d: 2.6 },

      // Long Sightline Cover along outer perimeter lanes
      { x: -20, y: 0.9, z: -55, w: 2.2, h: 1.8, d: 2.2 },
      { x: 20, y: 0.9, z: -55, w: 2.2, h: 1.8, d: 2.2 },
      { x: -20, y: 0.9, z: 55, w: 2.2, h: 1.8, d: 2.2 },
      { x: 20, y: 0.9, z: 55, w: 2.2, h: 1.8, d: 2.2 },

      // Watchtower Perch Cover
      { x: -8, y: 4.5 + 0.8, z: 48, w: 1.8, h: 1.6, d: 1.8 },
      { x: 8, y: 4.5 + 0.8, z: 48, w: 1.8, h: 1.6, d: 1.8 },
      { x: -8, y: 4.5 + 0.8, z: -48, w: 1.8, h: 1.6, d: 1.8 },
      { x: 8, y: 4.5 + 0.8, z: -48, w: 1.8, h: 1.6, d: 1.8 }
    ];

    crateConfigs.forEach((cfg, idx) => {
      const crate = MeshBuilder.CreateBox(
        `crate_${idx}`,
        { width: cfg.w, height: cfg.h, depth: cfg.d },
        this.scene
      );
      crate.position.set(cfg.x, cfg.y, cfg.z);
      crate.material = this.matCrate;
      crate.checkCollisions = true;
      crate.receiveShadows = true;
      this.shadowGenerator.addShadowCaster(crate);
      this.staticMeshes.push(crate);
      this.coverMeshes.push(crate);

      // Crate trim
      const trim = MeshBuilder.CreateBox(
        `crateTrim_${idx}`,
        { width: cfg.w + 0.08, height: 0.20, depth: cfg.d + 0.08 },
        this.scene
      );
      trim.position.set(cfg.x, cfg.y, cfg.z);
      trim.material = this.matCrateTrim;
      trim.isPickable = false;
      this.staticMeshes.push(trim);
    });
  }

  createSpawnPads() {
    const sp1 = CONFIG.GAME.SPAWNS[0];
    const pad1 = MeshBuilder.CreateCylinder(
      'spawnPad1',
      { diameter: 4.2, height: 0.05, tessellation: 28 },
      this.scene
    );
    pad1.position.set(sp1.x, 0.02, sp1.z);
    pad1.material = this.matSpawnRed;
    this.staticMeshes.push(pad1);

    const sp2 = CONFIG.GAME.SPAWNS[1];
    const pad2 = MeshBuilder.CreateCylinder(
      'spawnPad2',
      { diameter: 4.2, height: 0.05, tessellation: 28 },
      this.scene
    );
    pad2.position.set(sp2.x, 0.02, sp2.z);
    pad2.material = this.matSpawnBlue;
    this.staticMeshes.push(pad2);
  }

  // Giant 3D Illuminated Billboard with REJOHN Champion Art (mounted high on North Wall, visible from anywhere!)
  createRejohnBillboard() {
    const bbWidth = 32.0;
    const bbHeight = 14.0;
    const bbDepth = 1.0;
    const posY = 18.0;
    const posZ = (CONFIG.GAME.MAP_SIZE / 2) - 3.0; // Mounted along North Wall

    // Support Pillars
    const p1 = MeshBuilder.CreateBox('bbPillar1', { width: 1.4, height: 24.0, depth: 1.4 }, this.scene);
    p1.position.set(-11.0, 12.0, posZ + 0.6);
    p1.material = this.matSteel;
    this.staticMeshes.push(p1);

    const p2 = MeshBuilder.CreateBox('bbPillar2', { width: 1.4, height: 24.0, depth: 1.4 }, this.scene);
    p2.position.set(11.0, 12.0, posZ + 0.6);
    p2.material = this.matSteel;
    this.staticMeshes.push(p2);

    // Cross Truss
    const truss = MeshBuilder.CreateBox('bbTruss', { width: 24.0, height: 0.8, depth: 0.8 }, this.scene);
    truss.position.set(0, 10.0, posZ + 0.6);
    truss.material = this.matSteel;
    this.staticMeshes.push(truss);

    // Frame
    const frame = MeshBuilder.CreateBox(
      'bbFrame',
      { width: bbWidth + 1.2, height: bbHeight + 1.2, depth: bbDepth + 0.4 },
      this.scene
    );
    frame.position.set(0, posY, posZ);
    frame.material = this.matSteel;
    this.shadowGenerator.addShadowCaster(frame);
    this.staticMeshes.push(frame);

    // Glowing Neon Border
    const neonBorder = MeshBuilder.CreateBox(
      'bbNeonBorder',
      { width: bbWidth + 1.6, height: bbHeight + 1.6, depth: 0.2 },
      this.scene
    );
    neonBorder.position.set(0, posY, posZ - 0.35);
    neonBorder.material = this.matWallTrim;
    this.staticMeshes.push(neonBorder);

    // Front Signboard Face with High-Res Dynamic Canvas Art
    const signFace = MeshBuilder.CreatePlane(
      'bbSignFace',
      { width: bbWidth, height: bbHeight },
      this.scene
    );
    signFace.position.set(0, posY, posZ - (bbDepth / 2 + 0.08));
    signFace.rotation.y = Math.PI; // Face South into arena
    signFace.isPickable = false;

    // Render 1024x512 High-Definition Artwork & REJOHN Hero Graphics
    const texture = new DynamicTexture('bbTex', { width: 1024, height: 512 }, this.scene, false);
    const ctx = texture.getContext();

    // Dark cyber gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, 1024, 512);
    bgGrad.addColorStop(0, '#0a0e17');
    bgGrad.addColorStop(0.5, '#0f172a');
    bgGrad.addColorStop(1, '#020617');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1024, 512);

    // Tech grid lines pattern
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.12)';
    ctx.lineWidth = 2;
    for (let x = 0; x < 1024; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
    }
    for (let y = 0; y < 512; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y);
      ctx.stroke();
    }

    // Outer cyber glowing frame
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 8;
    ctx.strokeRect(20, 20, 984, 472);

    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3;
    ctx.strokeRect(30, 30, 964, 452);

    // Left Hero Insignia Shield / Icon
    ctx.save();
    ctx.translate(160, 256);

    ctx.fillStyle = 'rgba(0, 242, 254, 0.15)';
    ctx.beginPath();
    ctx.moveTo(0, -110);
    ctx.lineTo(110, 0);
    ctx.lineTo(0, 110);
    ctx.lineTo(-110, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Gold Champion Stars
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★ ★ ★', 0, -50);

    // Sniper Crosshair Reticle Emblem
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 15, 45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-58, 15);
    ctx.lineTo(58, 15);
    ctx.moveTo(0, -43);
    ctx.lineTo(0, 73);
    ctx.stroke();
    ctx.restore();

    // Top Label Banner
    ctx.textAlign = 'center';
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
    ctx.letterSpacing = '6px';
    ctx.fillText('⚡ BABYLON ARENA CHAMPION ⚡', 590, 105);

    // GIANT REJOHN NAME LOGO
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.font = '900 115px "Impact", "Arial Black", sans-serif';
    ctx.fillText('REJOHN', 596, 246);

    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 35;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('REJOHN', 590, 240);

    const textGrad = ctx.createLinearGradient(350, 140, 850, 260);
    textGrad.addColorStop(0, '#fef08a');
    textGrad.addColorStop(0.35, '#facc15');
    textGrad.addColorStop(0.7, '#eab308');
    textGrad.addColorStop(1, '#00f2fe');

    ctx.fillStyle = textGrad;
    ctx.fillText('REJOHN', 590, 240);
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 3;
    ctx.strokeText('REJOHN', 590, 240);
    ctx.restore();

    // Subtitle Tagline
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 32px "Segoe UI", Arial, sans-serif';
    ctx.letterSpacing = '4px';
    ctx.fillText('SNIPER MASTER  •  UNDISPUTED #1', 590, 310);

    // Stats bar at bottom
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(320, 355, 540, 68);
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(320, 355, 540, 68);

    ctx.fillStyle = '#00f2fe';
    ctx.font = 'bold 22px monospace';
    ctx.fillText('MAP SIZE: 160x160   K/D: 99.0   STATUS: ACTIVE', 590, 396);

    texture.update();

    const signMat = new StandardMaterial('bbSignMat', this.scene);
    signMat.diffuseTexture = texture;
    signMat.emissiveTexture = texture;
    signMat.emissiveColor = new Color3(0.9, 0.9, 0.95);
    signFace.material = signMat;

    this.staticMeshes.push(signFace);
  }

  optimizeStaticMeshes() {
    this.staticMeshes.forEach(mesh => {
      mesh.freezeWorldMatrix();
      if (mesh.material && typeof mesh.material.freeze === 'function') {
        mesh.material.freeze();
      }
    });
  }
}
