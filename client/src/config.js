// Game Configuration and Constants - Sniper & Combat Knife, 160x160 Arena, Kinematics
export const CONFIG = {
  GAME: {
    MAP_SIZE: 160,                // Expanded 160x160 arena (~4x area)
    ARENA_SIZE: 160,
    SCORE_TO_WIN: 10,
    MAX_HEALTH: 100,
    RESPAWN_DELAY_MS: 1500,       // Fast 1.5s respawn
    SPAWN_PROTECTION_MS: 2000,    // 2.0s protection shield
    SPAWNS: [
      { x: -62, y: 0, z: -62, rotY: Math.PI / 4 },       // Spawn 1: South-West Red corner, facing center
      { x: 62, y: 0, z: 62, rotY: (5 * Math.PI) / 4 },   // Spawn 2: North-East Blue corner, facing center
      { x: -62, y: 0, z: 62, rotY: (7 * Math.PI) / 4 },  // Spawn 3: North-West fallback
      { x: 62, y: 0, z: -62, rotY: (3 * Math.PI) / 4 }   // Spawn 4: South-East fallback
    ]
  },

  PLAYER: {
    EYE_HEIGHT: 1.6,
    CROUCH_HEIGHT: 0.95,
    COLLIDER_RADIUS: 0.45,
    COLLIDER_HEIGHT: 1.6,
    CROUCH_COLLIDER_HEIGHT: 1.0,

    // Smooth acceleration & deceleration (~0.15s)
    ACCELERATION: 32.0,
    DECELERATION: 30.0,
    VELOCITY_DEADZONE: 0.01,

    // Sprint & Stamina system
    SPRINT_STAMINA_MAX: 5.0,         // 5 seconds sprint endurance
    SPRINT_STAMINA_REGEN_DELAY: 1.8, // 1.8s delay after stopping sprint before regen
    SPRINT_STAMINA_REGEN_RATE: 2.2,  // Stamina per second regenerated

    GRAVITY: -19.0,
    HEADBOB_FREQ: 8.0,
    HEADBOB_AMP: 0.022,
    DEFAULT_SENSITIVITY: 0.0020,
    DEFAULT_FOV: 1.22,               // ~70 degrees vertical FOV

    // Top-level default kinematics
    WALK_SPEED: 4.5,
    SPRINT_SPEED: 7.5,
    CROUCH_SPEED: 2.5,
    SCOPED_SPEED: 1.5,
    JUMP_VELOCITY: 5.2,

    // Weapon-dependent Kinematics Profiles
    KINEMATICS: {
      sniper: {
        WALK_SPEED: 4.5,
        SPRINT_SPEED: 7.5,
        CROUCH_SPEED: 2.5,
        SCOPED_SPEED: 1.5,           // ~30% walk speed while scoped
        JUMP_VELOCITY: 5.2,          // Standard jump
        ACCELERATION: 32.0,
        DECELERATION: 30.0,
        AIR_CONTROL: 0.25
      },
      knife: {
        WALK_SPEED: 7.0,             // Fast agile walk (Part 4)
        SPRINT_SPEED: 12.5,          // High mobility sprint (Part 4)
        CROUCH_SPEED: 4.0,           // Fast crouch traversal (Part 4)
        SCOPED_SPEED: 7.0,
        JUMP_VELOCITY: 10.4,         // 2x sniper jump height (Part 4)
        ACCELERATION: 70.0,          // Snappy ~0.1s acceleration (Part 4)
        DECELERATION: 45.0,
        AIR_CONTROL: 0.45            // Agile air strafe control
      }
    }
  },

  WEAPONS: {
    SNIPER: {
      ID: 'sniper',
      NAME: 'HEAVY SNIPER .50 BMG',
      SLOT: 1,
      MAGAZINE_SIZE: 5,           // 5 rounds per magazine
      RESERVE_AMMO: 25,
      BOLT_DELAY_MS: 1400,        // 1.4s bolt-action delay between shots
      RELOAD_TIME_MS: 2600,       // 2.6s reload
      FIRE_INTERVAL_MS: 1400,
      EQUIP_TIME_MS: 400,
      BODY_DAMAGE: 100,           // 100 damage (lethal body hit)
      HEAD_DAMAGE: 200,           // Instant elimination
      LEG_DAMAGE: 80,
      BASE_SPREAD: 0.09,          // Inaccurate when unscoped (hipfire)
      MOVING_SPREAD: 0.14,
      AIR_SPREAD: 0.20,
      ADS_SPREAD: 0.0001,         // Pinpoint laser accuracy when scoped
      RECOIL_CAMERA_PITCH: 0.045,
      RECOIL_RECOVERY_SPEED: 7.5,
      HIP_OFFSET: { x: 0.26, y: -0.26, z: 0.52 },
      ADS_OFFSET: { x: 0.0, y: -0.118, z: 0.36 },
      GUN_RECOIL_OFFSET_Z: -0.12,
      GUN_RECOIL_PITCH: 0.14,
      SCOPE_FOV: 0.26,            // ~15 degrees vertical FOV (~4.7x magnification)
      ADS_FOV: 0.26,
      SENSITIVITY_SCALE_SCOPED: 0.25,
      STEADY_AIM_DURATION_SEC: 3.0,
      SCOPE_TRANSITION_SEC: 0.18
    },
    KNIFE: {
      ID: 'knife',
      NAME: 'TACTICAL COMBAT KNIFE',
      SLOT: 2,
      RANGE: 2.2,                 // 2.2 units reach
      DAMAGE: 100,                // One-hit lethal slash
      ATTACK_COOLDOWN_MS: 600,    // 0.6s cooldown between swings
      SWING_DURATION_MS: 250,     // 0.25s slash animation
      EQUIP_TIME_MS: 400,         // 0.4s weapon switch
      HIP_OFFSET: { x: 0.22, y: -0.22, z: 0.44 }
    }
  },

  BULLET_CAM: {
    ENABLED: true,
    TOTAL_DURATION_MS: 3500,      // Synchronized duration across both players
    SLOW_MO_SCALE: 0.10,          // 0.1x game time in slow motion
    BULLET_SPEED: 34.0,           // Units per second in slow-mo
    APPROACH_DISTANCE: 3.0,       // Close orbiting shot within 3 units
    XRAY_LEAD_TIME: 0.30,         // 0.3s X-ray lead before impact
    HIT_STOP_DURATION: 0.15,      // 0.15s hit-stop freeze on impact
    RAGDOLL_DURATION: 2.0,        // 2s ragdoll fall & fade out
    EASE_BACK_DURATION: 0.50,     // 0.5s ease back to 1.0 time scale
    RESPAWN_DELAY_MS: 1200
  },

  BOT: {
    DIFFICULTIES: {
      easy: {
        name: 'Easy',
        reactionTimeMs: 550,
        missChance: 0.45,
        fireBurstIntervalMs: 1600,
        strafeSpeed: 2.8,
        turnRate: 3.0,
        coverThresholdHp: 30
      },
      medium: {
        name: 'Medium',
        reactionTimeMs: 360,
        missChance: 0.25,
        fireBurstIntervalMs: 1500,
        strafeSpeed: 3.8,
        turnRate: 5.0,
        coverThresholdHp: 40
      },
      hard: {
        name: 'Hard',
        reactionTimeMs: 200,
        missChance: 0.10,
        fireBurstIntervalMs: 1400,
        strafeSpeed: 4.5,
        turnRate: 7.5,
        coverThresholdHp: 50
      }
    }
  },

  COLORS: {
    TEAM_RED_VEST: '#ef4444',
    TEAM_RED_ACCENT: '#b91c1c',
    TEAM_BLUE_VEST: '#3b82f6',
    TEAM_BLUE_ACCENT: '#1d4ed8',
    TEAM_BOT_VEST: '#f97316',
    TEAM_BOT_ACCENT: '#c2410c',
    ROBLOX_TORSO_RED: '#ef4444',
    ROBLOX_TORSO_BLUE: '#3b82f6',
    TACTICAL_HELMET: '#1e293b',
    TACTICAL_PANTS: '#0f172a',
    TACTICAL_BOOTS: '#020617',
    TACTICAL_SKIN: '#e2b382',
    GLOVE_MAIN: '#1e293b',
    GLOVE_ACCENT: '#475569',
    FLOOR: '#333b4d',
    FLOOR_GRID: '#40495d',
    WALLS: '#3b4354',
    WALL_TRIM: '#00f2fe',
    CRATE: '#b87352',
    CRATE_TRIM: '#9c5339',
    PILLAR: '#434c5e',
    PLATFORM: '#373f50',
    PLATFORM_EDGE: '#e2e8f0',
    SKY: '#38bdf8'
  },

  NETWORK: {
    SERVER_URL: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SERVER_URL)
      ? import.meta.env.VITE_SERVER_URL
      : (typeof import.meta !== 'undefined' && import.meta.env?.DEV
          ? 'http://localhost:3000'
          : window.location.origin),
    SEND_RATE_HZ: 30,             // Fixed 30 Hz network send rate (Part 1)
    INTERPOLATION_OFFSET_MS: 120, // Adaptive 100-150ms interpolation baseline
    MAX_EXTRAPOLATION_MS: 200,    // Limited 200ms extrapolation
    MAX_REWIND_MS: 300,           // 300ms max lag compensation rewind
    PREDICTION_SNAP_THRESHOLD: 2.0 // Accept position unless error > 2 units
  }
};
