// Game Coordinator: 1v1 Arena, Dual-Perspective Kill Cam, 3-2-1 Countdown, Weapon Switching & Net Sync
import {
  Engine,
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3
} from '@babylonjs/core';
import { CONFIG } from './config.js';
import { AudioManager } from './audio.js';
import { MapBuilder } from './map.js';
import { WeaponSystem } from './weapon.js';
import { PlayerController } from './player.js';
import { OpponentCharacter } from './opponent.js';
import { BotAI } from './bot.js';
import { NetworkManager } from './network.js';
import { UIManager } from './ui.js';
import { timeManager } from './timeManager.js';
import { ScopeOverlay } from './scopeOverlay.js';
import { XRayEffect } from './xrayEffect.js';
import { BloodEffect } from './bloodEffect.js';
import { BulletCam } from './bulletCam.js';
import { inputManager } from './inputManager.js';

export const GAME_MODE = {
  NONE: 'none',
  PRACTICE: 'practice',
  ONLINE: 'online'
};

export class Game {
  constructor(canvasId = 'renderCanvas') {
    this.canvas = document.getElementById(canvasId);
    this.mode = GAME_MODE.NONE;

    // Scores
    this.playerScore = 0;
    this.enemyScore = 0;

    // Game loop timers
    this.lastFrameTime = performance.now();
    this.networkUpdateTimer = 0;
    this.debugUpdateTimer = 0;
    this.practiceDeathHandled = false;

    // Subsystems
    this.audio = new AudioManager();
    this.ui = new UIManager();
    this.network = new NetworkManager();

    // Scene & Engine
    this.engine = null;
    this.scene = null;
    this.mapBuilder = null;
    this.shadowGenerator = null;
    this.coverMeshes = [];

    // Entities
    this.player = null;
    this.weapon = null;
    this.opponent = null;
    this.botAI = null;

    // Hitbox Debug State
    this.isShowingClientHitboxes = false;
    this.isShowingServerHitboxes = false;
    this.serverHitboxMeshes = null;
    this.serverHitboxMat = null;

    // Bullet Cam & Cinematic Subsystems
    this.scopeOverlay = null;
    this.xrayEffect = null;
    this.bloodEffect = null;
    this.bulletCam = null;

    this.init();
  }

  init() {
    try {
      // 1. Babylon.js Engine & Scene
      this.engine = new Engine(this.canvas, true, {
        preserveDrawingBuffer: false,
        stencil: false,
        powerPreference: 'high-performance'
      });
      this.engine.setHardwareScalingLevel(1.0);

      this.scene = new Scene(this.engine);
      this.scene.collisionsEnabled = true;
      this.scene.gravity = new Vector3(0, CONFIG.PLAYER.GRAVITY, 0);
      this.scene.skipPointerMovePicking = true;
      this.scene.autoClear = true;
      this.scene.autoClearDepthAndStencil = true;

      // 2. Build 160x160 3D Arena
      this.mapBuilder = new MapBuilder(this.scene);
      const mapData = this.mapBuilder.build();
      this.shadowGenerator = mapData.shadowGenerator;
      this.coverMeshes = mapData.coverMeshes;

      // 3. Initialize Player & Weapon System
      this.player = new PlayerController(this.scene, this.canvas, this.audio);
      this.weapon = new WeaponSystem(this.scene, this.player.camera, this.audio, this.ui);
      this.player.setWeaponSystem(this.weapon);

      // 4. Initialize Sniper Scope, X-Ray, Blood & Bullet Cam
      this.scopeOverlay = new ScopeOverlay(this.audio, this.ui);
      this.xrayEffect = new XRayEffect(this.scene, this.audio);
      this.bloodEffect = new BloodEffect(this.scene, this.audio);
      this.bulletCam = new BulletCam(
        this.scene,
        this.player.camera,
        this.xrayEffect,
        this.bloodEffect,
        this.audio,
        this.ui
      );
      this.bulletCam.prewarm(this.scene);
      this.player.setScopeOverlay(this.scopeOverlay);

      // 5. Wire Player Callbacks
      this.player.onShootCallback = () => {
        this.handlePlayerAttack();
      };

      this.player.onReloadCallback = () => {
        this.weapon.reload();
      };

      this.player.onSwitchWeaponCallback = (weaponId) => {
        if (this.mode === GAME_MODE.ONLINE) {
          this.network.sendSwitchWeapon(weaponId);
        }
      };

      this.player.onStaminaChangeCallback = (stamina, maxStamina) => {
        this.ui.updateStamina(stamina, maxStamina);
      };

      this.player.onPointerLockChangeCallback = (isLocked) => {
        if (!isLocked) {
          inputManager.clearAll();
          if (this.scopeOverlay) this.scopeOverlay.forceReset();
          if (this.mode === GAME_MODE.ONLINE) {
            // Section F: Never pause online matches on focus loss
            this.ui.showResumeBanner();
          } else if (this.mode === GAME_MODE.PRACTICE && !this.ui.isMenuOpen) {
            this.ui.showPauseMenu();
          }
        } else {
          this.ui.hideResumeBanner();
          if (this.mode === GAME_MODE.PRACTICE) {
            this.ui.hidePauseMenu();
          }
        }
      };

      // Click resume banner to regain pointer lock in online matches (Section F)
      document.getElementById('resume-banner')?.addEventListener('click', () => {
        if (this.mode === GAME_MODE.ONLINE && !this.ui.isMenuOpen) {
          this.player.requestPointerLock();
        }
      });

      // Section D: Snap remote character to latest snapshot on tab restore
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.opponent && this.mode === GAME_MODE.ONLINE) {
          this.opponent.snapToLatest();
        }
      });

      this.player.onDamageCallback = (dmg, attackerPos, hitPart, newHp) => {
        this.ui.updateHealth(newHp);
        this.ui.showDamageFeedback(
          dmg,
          attackerPos,
          this.player.camera.position,
          this.player.yaw
        );
      };

      // 6. Wire UI Callbacks
      this.setupUICallbacks();

      // 7. Wire Network Callbacks
      this.setupNetworkCallbacks();

      // 8. Start Render Loop
      this.engine.runRenderLoop(() => {
        this.renderTick();
      });

      // 9. Handle Window Resize
      window.addEventListener('resize', () => {
        this.engine.resize();
      });
      this.engine.resize();

      // 10. Hide loading screen and show Main Menu
      let hasLoaded = false;
      const onSceneReady = () => {
        if (hasLoaded) return;
        hasLoaded = true;
        this.ui.hideLoadingScreen();
        this.ui.showMainMenu();
      };

      if (this.scene.isReady()) {
        onSceneReady();
      } else {
        this.scene.executeWhenReady(onSceneReady);
        setTimeout(onSceneReady, 500);
      }
    } catch (err) {
      console.error('CRITICAL GAME INIT ERROR:', err);
      const loadingScreen = document.getElementById('loading-screen');
      if (loadingScreen) {
        loadingScreen.innerHTML = `
          <div class="modal-card" style="border: 2px solid #ef4444; max-width: 600px; padding: 24px;">
            <h1 class="game-title" style="color: #ef4444; font-size: 2rem;">INITIALIZATION ERROR</h1>
            <p style="color: #fca5a5; font-size: 1.1rem; margin-top: 10px;">${err?.message || err}</p>
            <pre style="text-align: left; background: #0b0f19; padding: 12px; border-radius: 6px; font-size: 0.8rem; color: #94a3b8; overflow: auto; max-height: 180px; margin-top: 12px;">${err?.stack || ''}</pre>
            <button class="btn-primary" style="margin-top: 18px; width: 100%;" onclick="window.location.reload()">RELOAD GAME</button>
          </div>
        `;
      }
      fetch('/api/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'INIT_ERROR', message: err?.message, stack: err?.stack })
      }).catch(() => {});
    }
  }

  setupUICallbacks() {
    this.ui.registerCallbacks({
      onUiClick: () => this.audio.playClick(),

      onStartPractice: (difficulty) => {
        this.startPracticeMode(difficulty);
      },

      onOpenOnlineModal: () => {
        // Automatically start socket connection when opening online modal
        this.network.connect();
      },

      onCreateRoom: async (playerName) => {
        try {
          this.network.connect();
          const res = await this.network.createRoom(playerName);
          this.ui.showWaitingRoom(res.roomCode);
        } catch (err) {
          this.ui.showOnlineError(err.message || 'Failed to create room');
        }
      },

      onCancelRoom: async () => {
        try {
          await this.network.cancelRoom();
        } catch (err) {}
      },

      onJoinRoom: async (roomCode, playerName) => {
        try {
          this.network.connect();
          await this.network.joinRoom(roomCode, playerName);
        } catch (err) {
          this.ui.showOnlineError(err.message || 'Failed to join room');
        }
      },

      onResumeGame: () => {
        this.ui.hidePauseMenu();
        this.ui.hideResumeBanner();
        this.player.requestPointerLock();
      },

      onLeaveMatch: () => {
        this.endMatchAndReturnToMenu();
      },

      onRematch: () => {
        if (this.mode === GAME_MODE.PRACTICE) {
          this.startPracticeMode(this.botAI ? this.botAI.difficultyKey : 'medium');
        } else if (this.mode === GAME_MODE.ONLINE) {
          this.network.sendRematch();
        }
      },

      onSensitivityChange: (val) => {
        this.player.setSensitivity(val * 0.001);
      },

      onInvertYChange: (val) => {
        this.player.setInvertY(val);
      },

      onVolumeChange: (val) => {
        this.audio.setVolume(val);
      },

      onFovChange: (degrees) => {
        const rads = (degrees * Math.PI) / 180;
        this.player.setFov(rads);
      },

      onBulletCamToggle: (val) => {
        if (this.bulletCam) this.bulletCam.setEnabled(val);
      },

      onToggleClientHitboxes: () => {
        this.isShowingClientHitboxes = !this.isShowingClientHitboxes;
        this.ui.setClientHitboxesButtonState(this.isShowingClientHitboxes);
        if (this.opponent) {
          this.opponent.setHitboxesWireframe(this.isShowingClientHitboxes);
        }
      },

      onToggleServerHitboxes: () => {
        this.isShowingServerHitboxes = !this.isShowingServerHitboxes;
        this.ui.setServerHitboxesButtonState(this.isShowingServerHitboxes);
        this.network.subscribeServerHitboxes(this.isShowingServerHitboxes);
        if (!this.isShowingServerHitboxes) {
          this.clearServerHitboxMeshes();
        }
      },

      onSimulatedNetworkChange: (latencyMs, packetLossRate) => {
        this.network.setSimulatedNetwork(latencyMs, packetLossRate);
      }
    });
  }

  setupNetworkCallbacks() {
    this.network.onConnectionStatusChange = (status) => {
      this.ui.updateConnectionStatus(status);
    };

    // 3-2-1 Synchronized Countdown sequence
    this.network.onMatchCountdown = (data) => {
      const p1 = data.players?.[0]?.name || 'Player 1';
      const p2 = data.players?.[1]?.name || 'Player 2';
      this.ui.showCountdown(data.count, p1, p2);
    };

    // Both players released at 0
    this.network.onMatchStart = (data) => {
      this.ui.hideCountdown();
      this.startOnlineMatch(data);
    };

    this.network.onWorldState = (data) => {
      if (this.mode !== GAME_MODE.ONLINE || !data?.players) return;

      const myId = this.localId || this.network.localId || this.network.socket?.id;
      const remoteId = this.remoteId || this.network.remoteId;

      for (const p of data.players) {
        const pId = p.id || p.socketId;

        // Section A: Snapshot for remoteId goes ONLY to remote opponent; localId goes ONLY to local player
        if (remoteId && pId === remoteId && this.opponent) {
          this.opponent.setServerClockOffset(this.network.serverClockOffset);
          if (!p.timestamp && !p.t) {
            p.timestamp = data.serverTime || data.t || data.timestamp || Date.now();
          }
          this.opponent.pushNetworkUpdate(p);
        } else if (pId === myId && this.player) {
          const hp = p.health !== undefined ? p.health : p.hp;
          if (hp !== undefined && hp !== this.player.health) {
            this.player.health = hp;
            this.ui.updateHealth(hp);
          }
        }
      }
    };

    this.network.onPositionCorrection = (data) => {
      if (data) {
        const pos = data.position || { x: data.x, y: data.y, z: data.z };
        if (pos.x !== undefined) {
          this.player.applyPositionCorrection(pos);
        }
      }
    };

    this.network.onServerHitboxes = (data) => {
      if (this.isShowingServerHitboxes) {
        this.renderServerHitboxes(data);
      }
    };

    this.network.onOpponentSwitchWeapon = (data) => {
      if (this.opponent) {
        this.opponent.setActiveWeapon(data.weaponId);
      }
    };

    this.network.onHitConfirmed = (data) => {
      const isHeadshot = data.part === 'head';
      this.ui.showHitmarker(isHeadshot);
      this.audio.playHitMarker(isHeadshot);
    };

    this.network.onDamageTaken = (data) => {
      this.player.takeDamage(data.damage, data.attackerPosition, data.part);
    };

    // SYNCHRONIZED DUAL KILL CAM FOR BOTH SHOOTER AND VICTIM
    this.network.onKillCam = (data) => {
      const myId = this.network.socket?.id;
      const isShooter = data.shooterId === myId;
      const isVictim = data.victimId === myId;
      const isHeadshot = data.isHeadshot || data.hitPart === 'head';

      // Lock input for both players during replay
      this.player.setInputLocked(true);
      if (this.scopeOverlay) this.scopeOverlay.forceReset();

      const startPos = data.shooterPos || data.origin || { x: 0, y: 1.5, z: 0 };
      const hitPos = data.hitPoint || data.victimPos || { x: 0, y: 1.4, z: 0 };

      const startVec = new Vector3(startPos.x, startPos.y, startPos.z);
      const hitVec = new Vector3(hitPos.x, hitPos.y, hitPos.z);

      const killInfo = {
        killId: data.killId,
        killer: data.shooterName || (isShooter ? 'You' : (this.opponent?.name || 'Opponent')),
        victim: data.victimName || (isVictim ? 'You' : (this.opponent?.name || 'Opponent')),
        isHeadshot,
        weaponType: data.weaponType || 'sniper',
        timestamp: data.timestamp
      };

      if (isShooter && this.bulletCam && this.opponent) {
        // Shooter perspective: bullet follow / tracking
        this.bulletCam.start('shooter', startVec, hitVec, this.opponent, isHeadshot, killInfo, () => {});
      } else if (isVictim && this.bulletCam) {
        // Victim perspective: cinematic incoming view
        this.player.die();
        this.bulletCam.start('victim', startVec, hitVec, this.player, isHeadshot, killInfo, () => {});
      }
    };

    // Server announces kill cam concluded: score updates & input unlocked
    this.network.onKillCamEnd = (data) => {
      if (this.bulletCam && this.bulletCam.isActive) {
        this.bulletCam.complete();
      }
      this.player.setInputLocked(false);
      // Section D: Ensure remote character is visible and active after kill cam
      if (this.opponent) {
        this.opponent.setVisible(true);
      }

      if (this.player.playerNumber === 1) {
        this.playerScore = data.scores.p1Kills;
        this.enemyScore = data.scores.p2Kills;
      } else {
        this.playerScore = data.scores.p2Kills;
        this.enemyScore = data.scores.p1Kills;
      }

      this.ui.updateScore(this.playerScore, this.enemyScore, 'YOU', this.opponent?.name || 'OPPONENT');
    };

    this.network.onPlayerKilled = (data) => {
      const isMeKiller = data.killerId === this.network.socket?.id;
      const isHeadshot = data.hitPart === 'head';

      const killerName = isMeKiller ? 'You' : (this.opponent?.name || 'Opponent');
      const victimName = isMeKiller ? (this.opponent?.name || 'Opponent') : 'You';

      this.ui.addKillFeedMessage(killerName, victimName, isHeadshot);

      if (!isMeKiller) {
        this.player.die();
      }
    };

    this.network.onPlayerRespawned = (data) => {
      const isMe = data.socketId === this.network.socket?.id;
      if (isMe) {
        this.player.spawnAt(data.spawn, data.playerNumber);
        this.weapon.resetAmmo();
        this.ui.updateHealth(CONFIG.GAME.MAX_HEALTH);
        this.ui.setSpawnProtection(true);
        setTimeout(() => {
          this.ui.setSpawnProtection(false);
        }, data.protectedDurationMs || 2000);
      } else if (this.opponent) {
        this.opponent.resetRagdoll();
        this.opponent.setPositionAndRotation(data.spawn, data.spawn.rotY);
        this.opponent.setVisible(true);
        this.opponent.setProtected(true);
        setTimeout(() => {
          if (this.opponent) this.opponent.setProtected(false);
        }, data.protectedDurationMs || 2000);
      }
    };

    this.network.onMatchOver = (data) => {
      const isVictory = data.winnerNumber === this.player.playerNumber;
      this.ui.showGameOver(isVictory, this.playerScore, this.enemyScore);
      this.player.exitPointerLock();
    };

    this.network.onMatchRestarted = (data) => {
      this.playerScore = 0;
      this.enemyScore = 0;
      this.ui.updateScore(0, 0);

      const myData = data.players.find(p => p.socketId === this.network.socket?.id);
      if (myData) {
        this.player.spawnAt(myData.spawn, myData.playerNumber);
        this.weapon.resetAmmo();
      }

      const oppData = data.players.find(p => p.socketId !== this.network.socket?.id);
      if (oppData && this.opponent) {
        this.opponent.resetRagdoll();
        this.opponent.setPositionAndRotation(oppData.spawn, oppData.spawn.rotY);
        this.opponent.setVisible(true);
      }

      this.ui.showHUD();
      this.ui.startMatchTimer();
      this.player.requestPointerLock();
    };

    this.network.onOpponentLeft = (data) => {
      this.ui.showOpponentLeftNotice(data.message);
      this.player.exitPointerLock();
    };

    this.network.onPingUpdate = (ping) => {
      this.ui.updatePing(ping);
    };
  }

  startPracticeMode(difficulty = 'medium') {
    this.mode = GAME_MODE.PRACTICE;
    this.playerScore = 0;
    this.enemyScore = 0;

    if (this.opponent) {
      this.opponent.dispose();
      this.opponent = null;
    }
    this.botAI = null;

    // Create Humanoid Bot Opponent
    this.opponent = new OpponentCharacter(
      this.scene,
      this.shadowGenerator,
      'bot_opponent',
      2,
      true,
      `BOT (${difficulty.toUpperCase()})`
    );

    if (this.xrayEffect) {
      this.xrayEffect.attachSkeleton(this.opponent);
    }

    this.botAI = new BotAI(
      this.scene,
      this.opponent,
      this.player,
      this.audio,
      difficulty
    );

    this.player.spawnAt(CONFIG.GAME.SPAWNS[0], 1);
    this.opponent.setPositionAndRotation(CONFIG.GAME.SPAWNS[1], CONFIG.GAME.SPAWNS[1].rotY);
    this.opponent.setVisible(true);
    if (this.isShowingClientHitboxes) {
      this.opponent.setHitboxesWireframe(true);
    }

    this.weapon.resetAmmo();
    this.ui.updateHealth(CONFIG.GAME.MAX_HEALTH);
    this.ui.updateScore(0, 0, 'YOU', `BOT (${difficulty.toUpperCase()})`);
    this.ui.updateKillCounter(0, CONFIG.GAME.SCORE_TO_WIN);
    this.ui.updatePing(0);
    this.ui.showHUD();
    this.ui.startMatchTimer();

    this.player.requestPointerLock();
  }

  startOnlineMatch(matchData) {
    this.mode = GAME_MODE.ONLINE;
    this.playerScore = 0;
    this.enemyScore = 0;

    if (this.opponent) {
      this.opponent.dispose();
      this.opponent = null;
    }
    this.botAI = null;

    // Section A: Identity
    this.localId = matchData.localId || this.network.localId || this.network.socket?.id;
    this.remoteId = matchData.remoteId || this.network.remoteId;

    const myId = this.localId;
    let myInfo = null;
    let oppInfo = null;

    if (myId && matchData.players) {
      myInfo = matchData.players.find(p => (p.socketId && p.socketId === myId) || (p.id && p.id === myId));
      oppInfo = matchData.players.find(p => (p.socketId && p.socketId !== myId) || (p.id && p.id !== myId));
    }
    if (!oppInfo && this.remoteId && matchData.players) {
      oppInfo = matchData.players.find(p => (p.socketId && p.socketId === this.remoteId) || (p.id && p.id === this.remoteId));
    }
    if (!myInfo && matchData.players) {
      myInfo = matchData.players[0];
      oppInfo = matchData.players[1] || matchData.players[0];
    }

    const mySpawn = myInfo?.spawn || CONFIG.GAME.SPAWNS[0];
    const myNum = myInfo?.playerNumber || myInfo?.num || (myInfo?.socketId === matchData.players?.[0]?.socketId ? 1 : 2);
    this.player.playerNumber = myNum;
    this.player.spawnAt(mySpawn, myNum);

    const oppId = this.remoteId || oppInfo?.socketId || oppInfo?.id || 'opponent_player';
    this.remoteId = oppId;
    const oppNum = oppInfo?.playerNumber || oppInfo?.num || (myNum === 1 ? 2 : 1);
    const oppName = oppInfo?.name || 'Opponent';
    const oppSpawn = oppInfo?.spawn || CONFIG.GAME.SPAWNS[1];

    this.opponent = new OpponentCharacter(
      this.scene,
      this.shadowGenerator,
      oppId,
      oppNum,
      false,
      oppName
    );

    if (this.xrayEffect) {
      this.xrayEffect.attachSkeleton(this.opponent);
    }

    this.opponent.setPositionAndRotation(oppSpawn, oppSpawn.rotY !== undefined ? oppSpawn.rotY : Math.PI);
    this.opponent.setVisible(true);
    this.opponent.setServerClockOffset(this.network.serverClockOffset);
    if (this.isShowingClientHitboxes) {
      this.opponent.setHitboxesWireframe(true);
    }

    // Section B & D: Launch background 30 Hz send loop (dedicated Web Worker, immune to tab focus loss)
    this.sendSeq = 0;
    this.network.startSendLoop(() => {
      if (this.mode === GAME_MODE.ONLINE && this.player) {
        this.sendSeq = (this.sendSeq || 0) + 1;
        return this.player.getSendState(this.sendSeq, Date.now());
      }
      return null;
    }, () => {
      // Process newest snapshot when tab is hidden so state stays fresh
      if (document.hidden && this.mode === GAME_MODE.ONLINE && this.opponent) {
        this.opponent.applyBackgroundTick();
      }
    });

    this.weapon.resetAmmo();
    this.ui.updateHealth(CONFIG.GAME.MAX_HEALTH);
    this.ui.updateScore(0, 0, 'YOU', oppName.toUpperCase());
    this.ui.updateKillCounter(0, CONFIG.GAME.SCORE_TO_WIN);
    this.ui.showHUD();

    this.player.requestPointerLock();
  }

  handlePlayerAttack() {
    if (this.mode === GAME_MODE.NONE || !this.player.isAlive || this.bulletCam?.isActive) return;

    const moveState = this.player.getMovementState();
    const result = this.weapon.attack(moveState);
    if (!result || !result.fired) return;

    // In Practice Mode:
    if (this.mode === GAME_MODE.PRACTICE && this.opponent && this.opponent.isAlive) {
      if (result.hit && result.targetType === 'bot') {
        const isHeadshot = result.hitPart === 'head';
        const damage = isHeadshot ? CONFIG.WEAPONS.SNIPER.HEAD_DAMAGE : CONFIG.WEAPONS.SNIPER.BODY_DAMAGE;

        if (!this.opponent.isProtected) {
          this.opponent.health = Math.max(0, this.opponent.health - damage);
          this.opponent.updateNameTag();

          this.ui.showHitmarker(isHeadshot);
          this.audio.playHitMarker(isHeadshot);

          const isLethal = this.opponent.health <= 0 || damage >= 100;
          if (isLethal) {
            this.opponent.health = 0;
            this.opponent.isAlive = false;

            const startPos = this.weapon.getBarrelTipWorldPosition();
            const targetPos = result.hitPoint
              ? new Vector3(result.hitPoint.x, result.hitPoint.y, result.hitPoint.z)
              : this.opponent.rootNode.position.add(new Vector3(0, 1.4, 0));

            const killInfo = {
              killer: 'You',
              victim: this.opponent.name,
              isHeadshot,
              weaponType: result.weaponType
            };

            this.player.setInputLocked(true);
            if (this.scopeOverlay) this.scopeOverlay.forceReset();

            this.bulletCam.start(
              'shooter',
              startPos,
              targetPos,
              this.opponent,
              isHeadshot,
              killInfo,
              (info) => {
                this.player.setInputLocked(false);

                this.playerScore++;
                this.ui.updateScore(this.playerScore, this.enemyScore, 'YOU', this.opponent.name);
                this.ui.updateKillCounter(this.playerScore, CONFIG.GAME.SCORE_TO_WIN);
                this.ui.addKillFeedMessage(info.killer, info.victim, info.isHeadshot);

                if (this.playerScore >= CONFIG.GAME.SCORE_TO_WIN) {
                  this.ui.showGameOver(true, this.playerScore, this.enemyScore);
                  this.player.exitPointerLock();
                } else {
                  setTimeout(() => {
                    if (this.mode === GAME_MODE.PRACTICE && this.opponent) {
                      const playerPos = this.player.camera.position;
                      let bestSpawn = CONFIG.GAME.SPAWNS[0];
                      let maxD = -1;
                      for (const sp of CONFIG.GAME.SPAWNS) {
                        const d = Math.hypot(sp.x - playerPos.x, sp.z - playerPos.z);
                        if (d > maxD) {
                          maxD = d;
                          bestSpawn = sp;
                        }
                      }

                      this.opponent.resetRagdoll();
                      this.opponent.setPositionAndRotation(bestSpawn, bestSpawn.rotY);
                      this.opponent.health = CONFIG.GAME.MAX_HEALTH;
                      this.opponent.isAlive = true;
                      this.opponent.setVisible(true);
                      this.opponent.setProtected(true);

                      setTimeout(() => {
                        if (this.opponent) this.opponent.setProtected(false);
                      }, CONFIG.GAME.SPAWN_PROTECTION_MS);
                    }
                  }, CONFIG.GAME.RESPAWN_DELAY_MS);
                }
              }
            );
          }
        }
      }
    }

    // In Online 1v1 Mode:
    if (this.mode === GAME_MODE.ONLINE) {
      this.network.sendShoot({
        shotId: result.shotId,
        origin: result.rayOrigin || { x: this.player.camera.position.x, y: this.player.camera.position.y, z: this.player.camera.position.z },
        direction: result.rayDirection || { x: this.player.camera.getForwardRay().direction.x, y: this.player.camera.getForwardRay().direction.y, z: this.player.camera.getForwardRay().direction.z },
        weaponType: result.weaponType,
        timestamp: Date.now()
      });
    }
  }

  handlePracticePlayerKilled() {
    this.enemyScore++;
    this.ui.updateScore(this.playerScore, this.enemyScore, 'YOU', this.opponent ? this.opponent.name : 'BOT');
    this.ui.addKillFeedMessage('Bot', 'You', false);

    if (this.enemyScore >= CONFIG.GAME.SCORE_TO_WIN) {
      this.ui.showGameOver(false, this.playerScore, this.enemyScore);
      this.player.exitPointerLock();
    } else {
      setTimeout(() => {
        if (this.mode === GAME_MODE.PRACTICE) {
          const botPos = this.opponent ? this.opponent.position : new Vector3(0, 0, 0);
          let bestSpawn = CONFIG.GAME.SPAWNS[0];
          let maxD = -1;
          for (const sp of CONFIG.GAME.SPAWNS) {
            const d = Math.hypot(sp.x - botPos.x, sp.z - botPos.z);
            if (d > maxD) {
              maxD = d;
              bestSpawn = sp;
            }
          }

          this.player.spawnAt(bestSpawn, 1);
          this.weapon.resetAmmo();
          this.ui.updateHealth(CONFIG.GAME.MAX_HEALTH);
          this.ui.setSpawnProtection(true);
          setTimeout(() => {
            this.ui.setSpawnProtection(false);
          }, CONFIG.GAME.SPAWN_PROTECTION_MS);
        }
      }, CONFIG.GAME.RESPAWN_DELAY_MS);
    }
  }

  endMatchAndReturnToMenu() {
    this.mode = GAME_MODE.NONE;
    this.network.disconnect();

    if (this.opponent) {
      this.opponent.dispose();
      this.opponent = null;
    }
    this.botAI = null;
    this.clearServerHitboxMeshes();

    inputManager.clearAll();
    if (this.scopeOverlay) this.scopeOverlay.forceReset();
    this.player.exitPointerLock();
    this.ui.showMainMenu();
  }

  renderServerHitboxes(data) {
    if (!this.serverHitboxMeshes) {
      this.serverHitboxMeshes = {};
      this.serverHitboxMat = new StandardMaterial('serverHitboxMat', this.scene);
      this.serverHitboxMat.wireframe = true;
      this.serverHitboxMat.emissiveColor = new Color3(1.0, 0.4, 0.1);
      this.serverHitboxMat.disableLighting = true;
    }

    ['head', 'body', 'legs'].forEach(part => {
      const partData = data[part];
      if (!partData) return;

      const key = `${data.playerId}_${part}`;
      let mesh = this.serverHitboxMeshes[key];
      if (!mesh) {
        mesh = MeshBuilder.CreateSphere(key, { diameter: partData.radius * 2, segments: 8 }, this.scene);
        mesh.material = this.serverHitboxMat;
        mesh.isPickable = false;
        this.serverHitboxMeshes[key] = mesh;
      }
      mesh.position.set(partData.x, partData.y, partData.z);
      mesh.isVisible = true;
    });
  }

  clearServerHitboxMeshes() {
    if (this.serverHitboxMeshes) {
      Object.values(this.serverHitboxMeshes).forEach(m => m.dispose());
      this.serverHitboxMeshes = {};
    }
  }

  renderTick() {
    const now = performance.now();
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;

    const rawDt = Math.min(50, dt);
    const rawDtSec = rawDt / 1000;

    try {
      // 1. Slow-motion TimeManager update
      timeManager.update(rawDtSec);
      const scaledDt = timeManager.getDeltaTime(rawDt);

      // 2. Sniper Scope Overlay update
      if (this.scopeOverlay) {
        this.scopeOverlay.update(rawDtSec);
      }

      // 3. Bullet Cam update
      if (this.bulletCam) {
        this.bulletCam.update(rawDtSec);
      }

      // 4. Update weapon recoil, sway, equip and bolt animations
      this.weapon.update(scaledDt, this.player.getMovementState());
      const kickPitch = this.weapon.consumeCameraRecoil();

      // 5. Update local player kinematics & collisions
      this.player.update(scaledDt, this.bulletCam?.isActive ? 0 : kickPitch);

      // 6. Update UI HUD ammo and reload status
      this.ui.updateAmmo(
        this.weapon.magAmmo,
        this.weapon.reserveAmmo,
        this.weapon.isReloading
      );

      // 7. Update Bot AI in Practice Mode
      if (this.mode === GAME_MODE.PRACTICE && this.opponent) {
        if (!this.bulletCam?.isActive && this.opponent.isAlive && this.botAI) {
          this.botAI.update(scaledDt, this.coverMeshes);
        } else if (this.opponent.isRagdoll) {
          this.opponent.update(scaledDt);
        }

        if (!this.player.isAlive && this.player.health === 0 && !this.practiceDeathHandled) {
          this.practiceDeathHandled = true;
          this.handlePracticePlayerKilled();
        } else if (this.player.isAlive) {
          this.practiceDeathHandled = false;
        }
      }

      // 8. Update Blood effects
      if (this.bloodEffect) {
        this.bloodEffect.update(rawDtSec);
      }

      // 9. Update Opponent character in Online Mode
      if (this.opponent && this.mode === GAME_MODE.ONLINE) {
        this.opponent.update(scaledDt);
      }

      // 10. Server-Authoritative Match Timer in Online Mode (Section G)
      if (this.mode === GAME_MODE.ONLINE && this.network.matchStartServerTime) {
        this.ui.updateMatchTimerServerAuthoritative(
          this.network.getEstimatedServerTime(),
          this.network.matchStartServerTime,
          this.network.matchDuration || 600
        );
      }

      // 11. Performance & Telemetry Debug Overlay Update (Section J)
      this.debugUpdateTimer += rawDt;
      if (this.debugUpdateTimer >= 150) {
        this.debugUpdateTimer = 0;
        this.ui.updateDebugMetrics({
          localId: this.localId || this.network.localId || '--',
          remoteId: this.remoteId || this.network.remoteId || '--',
          sendRate: this.network.sendRate || 0,
          snapRate: this.network.snapshotsPerSecond || 0,
          snapAge: this.network.getLastSnapshotAgeMs(),
          remotePos: this.opponent ? this.opponent.getDebugPosString() : '--',
          remoteAnim: this.opponent ? this.opponent.getDebugAnimString() : '--',
          ping: this.network.smoothedPing,
          maxPing: this.network.maxPing,
          jitter: this.network.jitter,
          clockOffset: this.network.serverClockOffset,
          matchTime: this.ui.hud.timerVal?.textContent || '00:00',
          fps: this.engine.getFps(),
          serverTick: 30,
          ppsIn: this.network.ppsIn,
          ppsOut: this.network.ppsOut,
          weapon: this.weapon.currentWeaponId,
          speed: this.player.currentSpeed || 0,
          killCamState: this.bulletCam.camState,
          timeScale: timeManager.timeScale,
          events: this.network.recentEvents
        });
        this.ui.updatePing(this.network.smoothedPing, this.network.jitter);
      }
    } catch (err) {
      if (!this._hasReportedRenderError) {
        this._hasReportedRenderError = true;
        console.error('[Render Loop Subsystem Error]:', err);
      }
    }

    try {
      this.scene.render();
    } catch (renderErr) {
      if (!this._hasReportedSceneRenderError) {
        this._hasReportedSceneRenderError = true;
        console.error('[Scene.render Error]:', renderErr);
      }
    }
  }
}
