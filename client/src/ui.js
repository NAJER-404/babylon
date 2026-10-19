// Comprehensive HUD, UI, Performance Overlay & 1v1 Room Lifecycle Manager
export class UIManager {
  constructor() {
    this.elements = {};
    this.callbacks = {};
    this.matchTimerInterval = null;
    this.matchStartSeconds = 0;
    this.hitmarkerTimeout = null;
    this.damageIndicatorTimeout = null;
    this.isMenuOpen = true;
    this.isDebugVisible = false;

    this.cacheDOMElements();
    this.loadSavedPlayerName();
    this.bindEvents();
  }

  cacheDOMElements() {
    // Screens & Modals
    this.screens = {
      loading: document.getElementById('loading-screen'),
      mainMenu: document.getElementById('main-menu'),
      practiceSelect: document.getElementById('practice-select-modal'),
      onlineModal: document.getElementById('online-modal'),
      waitingRoom: document.getElementById('waiting-modal'),
      pauseMenu: document.getElementById('pause-menu'),
      gameOver: document.getElementById('game-over-modal'),
      settingsModal: document.getElementById('settings-modal'),
      countdown: document.getElementById('countdown-overlay'),
      hud: document.getElementById('game-hud')
    };

    // HUD items
    this.hud = {
      healthValue: document.getElementById('health-val'),
      healthBarFill: document.getElementById('health-bar-fill'),
      staminaBarFill: document.getElementById('stamina-bar-fill'),
      ammoCurrent: document.getElementById('ammo-val'),
      ammoDivider: document.getElementById('ammo-divider'),
      ammoReserve: document.getElementById('reserve-val'),
      reloadNotice: document.getElementById('reload-notice'),
      scorePlayer: document.getElementById('score-player'),
      scoreEnemy: document.getElementById('score-enemy'),
      scoreLabelPlayer: document.getElementById('score-label-player'),
      scoreLabelEnemy: document.getElementById('score-label-enemy'),
      timerVal: document.getElementById('match-timer'),
      pingVal: document.getElementById('ping-display'),
      crosshair: document.getElementById('crosshair'),
      hitmarker: document.getElementById('hitmarker'),
      killFeed: document.getElementById('kill-feed'),
      damageVignette: document.getElementById('damage-vignette'),
      damageIndicator: document.getElementById('damage-indicator'),
      spawnProtectIndicator: document.getElementById('spawn-protect-indicator'),
      sniperScope: document.getElementById('sniper-scope'),
      weaponName: document.getElementById('weapon-name-display'),
      killsTargetCounter: document.getElementById('kills-target-counter'),
      slotSniper: document.getElementById('slot-sniper'),
      slotKnife: document.getElementById('slot-knife')
    };

    // Countdown Screen
    this.countdown = {
      overlay: document.getElementById('countdown-overlay'),
      number: document.getElementById('countdown-number'),
      matchup: document.getElementById('countdown-matchup')
    };

    this.resumeBanner = document.getElementById('resume-banner');

    // Performance & Telemetry Debug Overlay (Section J)
    this.debug = {
      overlay: document.getElementById('debug-overlay'),
      localId: document.getElementById('debug-local-id'),
      remoteId: document.getElementById('debug-remote-id'),
      sendRate: document.getElementById('debug-send-rate'),
      snapRate: document.getElementById('debug-snap-rate'),
      snapAge: document.getElementById('debug-snap-age'),
      remotePos: document.getElementById('debug-remote-pos'),
      remoteAnim: document.getElementById('debug-remote-anim'),
      ping: document.getElementById('debug-ping'),
      clockOffset: document.getElementById('debug-clock-offset'),
      matchTime: document.getElementById('debug-match-time'),
      fps: document.getElementById('debug-fps'),
      serverTick: document.getElementById('debug-server-tick'),
      packetRate: document.getElementById('debug-packet-rate'),
      weapon: document.getElementById('debug-weapon'),
      speed: document.getElementById('debug-speed'),
      killCamState: document.getElementById('debug-killcam-state'),
      timeScale: document.getElementById('debug-timescale'),
      clientHitboxBtn: document.getElementById('btn-toggle-client-hitboxes'),
      serverHitboxBtn: document.getElementById('btn-toggle-server-hitboxes'),
      simLatencySelect: document.getElementById('select-debug-latency'),
      simLossSelect: document.getElementById('select-debug-loss'),
      eventsList: document.getElementById('debug-server-events')
    };

    // Online UI elements
    this.online = {
      connStatus: document.getElementById('online-conn-status'),
      connLabel: document.querySelector('#online-conn-status .conn-label'),
      roomCodeDisplay: document.getElementById('display-room-code'),
      copyCodeBtn: document.getElementById('btn-copy-code'),
      cancelRoomBtn: document.getElementById('btn-cancel-room'),
      joinCodeInput: document.getElementById('input-room-code'),
      joinRoomBtn: document.getElementById('btn-join-room'),
      createRoomBtn: document.getElementById('btn-create-room'),
      playerNameInput: document.getElementById('input-player-name'),
      onlineErrorMsg: document.getElementById('online-error-msg')
    };

    // Settings elements
    this.settings = {
      sensSlider: document.getElementById('slider-sensitivity'),
      sensVal: document.getElementById('val-sensitivity'),
      volSlider: document.getElementById('slider-volume'),
      volVal: document.getElementById('val-volume'),
      fovSlider: document.getElementById('slider-fov'),
      fovVal: document.getElementById('val-fov'),
      invertYCheck: document.getElementById('check-invert-y'),
      bulletCamCheck: document.getElementById('check-bullet-cam')
    };

    // Game Over elements
    this.gameOver = {
      title: document.getElementById('game-over-title'),
      subtitle: document.getElementById('game-over-subtitle'),
      scoreDisplay: document.getElementById('game-over-score'),
      rematchBtn: document.getElementById('btn-rematch'),
      rematchStatus: document.getElementById('rematch-status')
    };
  }

  loadSavedPlayerName() {
    try {
      const saved = localStorage.getItem('sniper_1v1_player_name');
      if (saved && saved.trim()) {
        const clean = this.sanitizeName(saved);
        if (this.online.playerNameInput) {
          this.online.playerNameInput.value = clean;
        }
      }
    } catch (e) {
      // localStorage disabled or not available
    }
  }

  savePlayerName(name) {
    try {
      const clean = this.sanitizeName(name);
      localStorage.setItem('sniper_1v1_player_name', clean);
    } catch (e) {}
  }

  sanitizeName(raw) {
    if (!raw || typeof raw !== 'string') {
      return `Player ${Math.floor(100 + Math.random() * 900)}`;
    }
    const clean = raw.trim().replace(/[<>\"\'&]/g, '').slice(0, 12);
    return clean.length > 0 ? clean : `Player ${Math.floor(100 + Math.random() * 900)}`;
  }

  getPlayerName() {
    if (!this.online.playerNameInput) return 'Player 1';
    const val = this.online.playerNameInput.value;
    const clean = this.sanitizeName(val);
    this.online.playerNameInput.value = clean;
    this.savePlayerName(clean);
    return clean;
  }

  bindEvents() {
    // 1. Toggle performance debug overlay with F3
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggleDebugOverlay();
      } else if (e.code === 'Escape') {
        // If an overlay modal is open (like settings or online), close it cleanly
        if (!this.screens.onlineModal.classList.contains('hidden') ||
            !this.screens.waitingRoom.classList.contains('hidden')) {
          this.callbacks.onCancelRoom?.();
          this.hideAllModals();
        } else if (!this.screens.practiceSelect.classList.contains('hidden') ||
                   !this.screens.settingsModal.classList.contains('hidden')) {
          this.hideAllModals();
        }
      }
    });

    // 2. Name input auto-save on blur & sanitization
    this.online.playerNameInput?.addEventListener('blur', () => {
      this.getPlayerName();
    });

    // 3. Room Code Input (auto-uppercase, letters only, 4 chars max)
    this.online.joinCodeInput?.addEventListener('input', (e) => {
      const clean = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      e.target.value = clean;
      if (this.online.joinRoomBtn) {
        this.online.joinRoomBtn.disabled = clean.length !== 4;
      }
    });

    this.online.joinCodeInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const code = this.online.joinCodeInput.value.trim().toUpperCase();
        if (code.length === 4 && !this.online.joinRoomBtn.disabled) {
          this.triggerJoinRoom();
        }
      }
    });

    // 4. Main Menu Buttons
    document.getElementById('btn-open-practice')?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.showModal('practiceSelect');
    });

    document.getElementById('btn-open-online')?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.showModal('onlineModal');
      this.callbacks.onOpenOnlineModal?.();
    });

    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.showModal('settingsModal');
    });

    // 5. Practice Mode Difficulty Select
    document.querySelectorAll('.btn-diff-select').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.callbacks.onUiClick?.();
        const diff = e.target.getAttribute('data-diff') || 'medium';
        this.hideAllModals();
        this.callbacks.onStartPractice?.(diff);
      });
    });

    // 6. Online Mode Buttons with double-click prevention
    this.online.createRoomBtn?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.online.createRoomBtn.disabled = true;
      const name = this.getPlayerName();
      this.callbacks.onCreateRoom?.(name);
      setTimeout(() => {
        if (this.online.createRoomBtn) this.online.createRoomBtn.disabled = false;
      }, 3000);
    });

    this.online.joinRoomBtn?.addEventListener('click', () => {
      this.triggerJoinRoom();
    });

    this.online.cancelRoomBtn?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.callbacks.onCancelRoom?.();
      this.hideAllModals();
      this.showModal('onlineModal');
    });

    this.online.copyCodeBtn?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      const code = this.online.roomCodeDisplay.textContent;
      if (code && navigator.clipboard) {
        navigator.clipboard.writeText(code);
        this.online.copyCodeBtn.textContent = 'COPIED!';
        setTimeout(() => {
          if (this.online.copyCodeBtn) this.online.copyCodeBtn.textContent = 'COPY CODE';
        }, 1500);
      }
    });

    // 7. Pause Menu
    document.getElementById('btn-resume')?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.callbacks.onResumeGame?.();
    });

    document.getElementById('btn-pause-settings')?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.showModal('settingsModal');
    });

    document.getElementById('btn-leave-match')?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.callbacks.onLeaveMatch?.();
    });

    // 8. Settings Sliders & Checkboxes
    this.settings.sensSlider?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.settings.sensVal.textContent = val.toFixed(1);
      this.callbacks.onSensitivityChange?.(val);
    });

    this.settings.invertYCheck?.addEventListener('change', (e) => {
      this.callbacks.onInvertYChange?.(e.target.checked);
    });

    this.settings.volSlider?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.settings.volVal.textContent = `${Math.round(val * 100)}%`;
      this.callbacks.onVolumeChange?.(val);
    });

    this.settings.fovSlider?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.settings.fovVal.textContent = `${val}°`;
      this.callbacks.onFovChange?.(val);
    });

    this.settings.bulletCamCheck?.addEventListener('change', (e) => {
      this.callbacks.onBulletCamToggle?.(e.target.checked);
    });

    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.hideModal('settingsModal');
    });

    // 9. Game Over Buttons
    this.gameOver.rematchBtn?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.gameOver.rematchBtn.disabled = true;
      this.gameOver.rematchStatus.textContent = 'Waiting for opponent rematch...';
      this.callbacks.onRematch?.();
    });

    document.getElementById('btn-menu-from-gameover')?.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.callbacks.onLeaveMatch?.();
    });

    // 10. Modal Close Buttons (X)
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        this.callbacks.onUiClick?.();
        this.callbacks.onCancelRoom?.();
        this.hideAllModals();
      });
    });

    // 11. Debug Controls (Hitboxes & Network Sim)
    this.debug.clientHitboxBtn?.addEventListener('click', () => {
      this.callbacks.onToggleClientHitboxes?.();
    });

    this.debug.serverHitboxBtn?.addEventListener('click', () => {
      this.callbacks.onToggleServerHitboxes?.();
    });

    this.debug.simLatencySelect?.addEventListener('change', (e) => {
      const lat = parseInt(e.target.value, 10) || 0;
      const loss = parseFloat(this.debug.simLossSelect?.value || '0');
      this.callbacks.onSimulatedNetworkChange?.(lat, loss);
    });

    this.debug.simLossSelect?.addEventListener('change', (e) => {
      const loss = parseFloat(e.target.value) || 0;
      const lat = parseInt(this.debug.simLatencySelect?.value || '0', 10) || 0;
      this.callbacks.onSimulatedNetworkChange?.(lat, loss);
    });
  }

  triggerJoinRoom() {
    this.callbacks.onUiClick?.();
    const code = this.online.joinCodeInput.value.trim().toUpperCase();
    const name = this.getPlayerName();

    if (!code || code.length !== 4) {
      this.showOnlineError('Please enter a valid 4-letter room code');
      return;
    }

    if (this.online.joinRoomBtn) {
      this.online.joinRoomBtn.disabled = true;
    }

    this.callbacks.onJoinRoom?.(code, name);

    setTimeout(() => {
      if (this.online.joinRoomBtn) {
        this.online.joinRoomBtn.disabled = this.online.joinCodeInput?.value.length !== 4;
      }
    }, 4000);
  }

  registerCallbacks(cbs) {
    this.callbacks = { ...this.callbacks, ...cbs };
  }

  updateConnectionStatus(status) {
    if (!this.online.connStatus) return;

    this.online.connStatus.className = `conn-pill ${status}`;
    if (this.online.connLabel) {
      this.online.connLabel.textContent = status.toUpperCase();
    }
  }

  showCountdown(count, p1Name = 'PLAYER 1', p2Name = 'PLAYER 2') {
    if (!this.countdown.overlay) return;
    this.countdown.overlay.classList.remove('hidden');
    this.countdown.number.textContent = count;
    this.countdown.matchup.textContent = `${p1Name.toUpperCase()} vs ${p2Name.toUpperCase()}`;
  }

  hideCountdown() {
    if (this.countdown.overlay) {
      this.countdown.overlay.classList.add('hidden');
    }
  }

  setActiveWeaponSlot(weaponId) {
    if (weaponId === 'knife') {
      this.hud.slotSniper?.classList.remove('active');
      this.hud.slotKnife?.classList.add('active');
      if (this.hud.weaponName) this.hud.weaponName.textContent = 'TACTICAL COMBAT KNIFE';
      if (this.hud.ammoCurrent) this.hud.ammoCurrent.textContent = '∞';
      if (this.hud.ammoDivider) this.hud.ammoDivider.style.display = 'none';
      if (this.hud.ammoReserve) this.hud.ammoReserve.textContent = 'MELEE';
      if (this.hud.reloadNotice) this.hud.reloadNotice.classList.add('hidden');
    } else {
      this.hud.slotSniper?.classList.add('active');
      this.hud.slotKnife?.classList.remove('active');
      if (this.hud.weaponName) this.hud.weaponName.textContent = 'HEAVY SNIPER .50 BMG';
      if (this.hud.ammoDivider) this.hud.ammoDivider.style.display = 'inline';
    }
  }

  toggleDebugOverlay() {
    this.isDebugVisible = !this.isDebugVisible;
    if (this.debug.overlay) {
      if (this.isDebugVisible) {
        this.debug.overlay.classList.remove('hidden');
      } else {
        this.debug.overlay.classList.add('hidden');
      }
    }
  }

  updateDebugMetrics(data = {}) {
    if (!this.isDebugVisible) return;
    if (this.debug.localId && data.localId !== undefined) {
      this.debug.localId.textContent = data.localId || '--';
    }
    if (this.debug.remoteId && data.remoteId !== undefined) {
      this.debug.remoteId.textContent = data.remoteId || '--';
    }
    if (this.debug.sendRate && data.sendRate !== undefined) {
      this.debug.sendRate.textContent = `${data.sendRate} pps`;
    }
    if (this.debug.snapRate && data.snapRate !== undefined) {
      this.debug.snapRate.textContent = `${data.snapRate} /s`;
    }
    if (this.debug.snapAge && data.snapAge !== undefined) {
      this.debug.snapAge.textContent = `${Math.round(data.snapAge)} ms`;
    }
    if (this.debug.remotePos && data.remotePos !== undefined) {
      this.debug.remotePos.textContent = data.remotePos;
    }
    if (this.debug.remoteAnim && data.remoteAnim !== undefined) {
      this.debug.remoteAnim.textContent = data.remoteAnim;
    }
    if (this.debug.ping && data.ping !== undefined) {
      if (typeof data.ping === 'number' && Number.isFinite(data.ping) && data.ping > 0) {
        this.debug.ping.textContent = `${Math.round(data.ping)} ms`;
      } else {
        this.debug.ping.textContent = '--';
      }
    }
    if (this.debug.clockOffset && data.clockOffset !== undefined) {
      this.debug.clockOffset.textContent = `${Math.round(data.clockOffset)} ms`;
    }
    if (this.debug.matchTime && data.matchTime !== undefined) {
      this.debug.matchTime.textContent = data.matchTime;
    }
    if (this.debug.fps && data.fps !== undefined) {
      this.debug.fps.textContent = Math.round(data.fps);
    }
    if (this.debug.serverTick && data.serverTick !== undefined) {
      this.debug.serverTick.textContent = `${data.serverTick} Hz`;
    }
    if (this.debug.packetRate) {
      this.debug.packetRate.textContent = `${data.ppsIn || 0} in / ${data.ppsOut || 0} out pps`;
    }
    if (this.debug.weapon && data.weapon) {
      this.debug.weapon.textContent = data.weapon.toUpperCase();
    }
    if (this.debug.speed !== undefined && data.speed !== undefined) {
      this.debug.speed.textContent = `${data.speed.toFixed(2)} u/s`;
    }
    if (this.debug.killCamState && data.killCamState) {
      this.debug.killCamState.textContent = data.killCamState;
    }
    if (this.debug.timeScale !== undefined && data.timeScale !== undefined) {
      this.debug.timeScale.textContent = `${data.timeScale.toFixed(2)}x`;
    }
    if (this.debug.eventsList && Array.isArray(data.events)) {
      if (data.events.length === 0) {
        this.debug.eventsList.innerHTML = '<div class="debug-event-item">No events yet</div>';
      } else {
        this.debug.eventsList.innerHTML = data.events.map(ev => `<div class="debug-event-item">${ev.time ? `[${ev.time}] ` : ''}${ev.text || ev}</div>`).join('');
      }
    }
  }

  setClientHitboxesButtonState(active) {
    if (this.debug.clientHitboxBtn) {
      this.debug.clientHitboxBtn.textContent = `CLIENT HITBOXES: ${active ? 'ON' : 'OFF'}`;
      this.debug.clientHitboxBtn.classList.toggle('active', !!active);
    }
  }

  setServerHitboxesButtonState(active) {
    if (this.debug.serverHitboxBtn) {
      this.debug.serverHitboxBtn.textContent = `SERVER HITBOXES: ${active ? 'ON' : 'OFF'}`;
      this.debug.serverHitboxBtn.classList.toggle('active', !!active);
    }
  }

  hideLoadingScreen() {
    if (this.screens.loading) {
      this.screens.loading.classList.add('hidden');
    }
  }

  showMainMenu() {
    this.isMenuOpen = true;
    this.hideAllModals();
    this.screens.hud.classList.add('hidden');
    this.screens.mainMenu.classList.remove('hidden');
    this.stopMatchTimer();
  }

  showHUD() {
    this.isMenuOpen = false;
    this.screens.mainMenu.classList.add('hidden');
    this.hideAllModals();
    this.screens.hud.classList.remove('hidden');
  }

  showWaitingRoom(roomCode) {
    if (this.online.roomCodeDisplay) {
      this.online.roomCodeDisplay.textContent = roomCode;
    }
    this.showModal('waitingRoom');
  }

  showOnlineError(msg) {
    if (this.online.onlineErrorMsg) {
      this.online.onlineErrorMsg.textContent = msg;
      this.online.onlineErrorMsg.classList.remove('hidden');
      setTimeout(() => {
        if (this.online.onlineErrorMsg) {
          this.online.onlineErrorMsg.classList.add('hidden');
        }
      }, 4500);
    }
  }

  showPauseMenu() {
    this.screens.pauseMenu.classList.remove('hidden');
  }

  hidePauseMenu() {
    this.screens.pauseMenu.classList.add('hidden');
  }

  showResumeBanner() {
    if (this.resumeBanner) {
      this.resumeBanner.classList.remove('hidden');
    }
  }

  hideResumeBanner() {
    if (this.resumeBanner) {
      this.resumeBanner.classList.add('hidden');
    }
  }

  showModal(modalName) {
    if (this.screens[modalName]) {
      this.screens[modalName].classList.remove('hidden');
    }
  }

  hideModal(modalName) {
    if (this.screens[modalName]) {
      this.screens[modalName].classList.add('hidden');
    }
  }

  hideAllModals() {
    Object.keys(this.screens).forEach(key => {
      if (key !== 'mainMenu' && key !== 'hud' && key !== 'loading') {
        this.screens[key].classList.add('hidden');
      }
    });
  }

  updateHealth(hp, maxHp = 100) {
    const safeHp = Math.max(0, Math.min(maxHp, hp));
    if (this.hud.healthValue) this.hud.healthValue.textContent = safeHp;
    const pct = (safeHp / maxHp) * 100;
    if (this.hud.healthBarFill) {
      this.hud.healthBarFill.style.width = `${pct}%`;
      if (safeHp <= 30) {
        this.hud.healthBarFill.classList.add('low-hp');
      } else {
        this.hud.healthBarFill.classList.remove('low-hp');
      }
    }
  }

  updateStamina(stamina, maxStamina = 5.0) {
    if (!this.hud.staminaBarFill) return;
    const pct = Math.max(0, Math.min(100, (stamina / maxStamina) * 100));
    this.hud.staminaBarFill.style.width = `${pct}%`;
    if (pct < 15) {
      this.hud.staminaBarFill.classList.add('exhausted');
    } else {
      this.hud.staminaBarFill.classList.remove('exhausted');
    }
  }

  updateAmmo(current, reserve, isReloading, noticeText = 'BOLT RELOADING...') {
    if (this.hud.ammoCurrent) this.hud.ammoCurrent.textContent = current;
    if (this.hud.ammoReserve) this.hud.ammoReserve.textContent = reserve;

    if (this.hud.reloadNotice) {
      if (isReloading) {
        this.hud.reloadNotice.textContent = noticeText;
        this.hud.reloadNotice.classList.remove('hidden');
      } else {
        this.hud.reloadNotice.classList.add('hidden');
      }
    }
  }

  updateScore(myScore, enemyScore, myLabel = 'YOU', enemyLabel = 'ENEMY') {
    if (this.hud.scorePlayer) this.hud.scorePlayer.textContent = myScore;
    if (this.hud.scoreEnemy) this.hud.scoreEnemy.textContent = enemyScore;
    if (this.hud.scoreLabelPlayer) this.hud.scoreLabelPlayer.textContent = myLabel;
    if (this.hud.scoreLabelEnemy) this.hud.scoreLabelEnemy.textContent = enemyLabel;
    this.updateKillCounter(myScore);
  }

  updateKillCounter(currentKills, maxKills = 10) {
    if (this.hud.killsTargetCounter) {
      this.hud.killsTargetCounter.textContent = `${currentKills}/${maxKills}`;
    }
  }

  setBulletCamActive(isActive) {
    if (this.screens.hud) {
      if (isActive) {
        this.screens.hud.classList.add('bullet-cam-active');
      } else {
        this.screens.hud.classList.remove('bullet-cam-active');
      }
    }
  }

  updatePing(pingMs, jitterMs = 0) {
    if (!this.hud.pingVal) return;
    if (!pingMs || !Number.isFinite(pingMs) || pingMs <= 0) {
      this.hud.pingVal.textContent = '--';
      this.hud.pingVal.style.color = 'var(--text-muted)';
      return;
    }
    const val = Math.round(pingMs);
    const jitterIcon = jitterMs > 25 ? ' ⚠️' : '';
    this.hud.pingVal.textContent = `${val}ms${jitterIcon}`;
    if (val < 80) {
      this.hud.pingVal.style.color = '#10b981';
    } else if (val <= 150) {
      this.hud.pingVal.style.color = '#f59e0b';
    } else {
      this.hud.pingVal.style.color = '#ef4444';
    }
  }

  // Section G: Server-Authoritative Match Timer (both windows agree)
  updateMatchTimerServerAuthoritative(estimatedServerNow, matchStartServerTime, duration = 600) {
    if (!this.hud.timerVal) return;
    if (!matchStartServerTime) {
      this.hud.timerVal.textContent = '00:00';
      return;
    }
    const elapsedSec = Math.max(0, Math.floor((estimatedServerNow - matchStartServerTime) / 1000));
    const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const secs = (elapsedSec % 60).toString().padStart(2, '0');
    const formatted = `${mins}:${secs}`;
    this.hud.timerVal.textContent = formatted;
    if (this.debug.matchTime) {
      this.debug.matchTime.textContent = formatted;
    }
  }

  setAds(isAds) {
    if (this.hud.crosshair) {
      if (isAds) {
        this.hud.crosshair.classList.add('ads-active');
      } else {
        this.hud.crosshair.classList.remove('ads-active');
      }
    }
  }

  setSniperScope(isScoped) {
    if (this.hud.sniperScope) {
      if (isScoped) {
        this.hud.sniperScope.classList.remove('hidden');
      } else {
        this.hud.sniperScope.classList.add('hidden');
      }
    }
  }

  showHitmarker(isHeadshot = false) {
    if (this.hitmarkerTimeout) clearTimeout(this.hitmarkerTimeout);

    this.hud.hitmarker?.classList.remove('hidden', 'headshot');
    if (isHeadshot) {
      this.hud.hitmarker?.classList.add('headshot');
    }

    this.hitmarkerTimeout = setTimeout(() => {
      this.hud.hitmarker?.classList.add('hidden');
      this.hud.hitmarker?.classList.remove('headshot');
    }, 120);
  }

  showDamageFeedback(amount, attackerPosition, playerPosition, playerYaw) {
    if (this.hud.damageVignette) {
      this.hud.damageVignette.classList.remove('hidden');
      this.hud.damageVignette.style.opacity = Math.min(0.8, 0.3 + (amount / 50) * 0.4);
    }

    if (this.damageIndicatorTimeout) clearTimeout(this.damageIndicatorTimeout);

    if (attackerPosition && playerPosition && this.hud.damageIndicator) {
      const dx = attackerPosition.x - playerPosition.x;
      const dz = attackerPosition.z - playerPosition.z;
      const angleToAttacker = Math.atan2(dx, dz);
      let relativeAngle = angleToAttacker - playerYaw;

      this.hud.damageIndicator.style.transform = `translate(-50%, -50%) rotate(${relativeAngle}rad)`;
      this.hud.damageIndicator.classList.remove('hidden');
    }

    this.damageIndicatorTimeout = setTimeout(() => {
      if (this.hud.damageVignette) this.hud.damageVignette.style.opacity = '0';
      if (this.hud.damageIndicator) this.hud.damageIndicator.classList.add('hidden');
      setTimeout(() => {
        if (this.hud.damageVignette) this.hud.damageVignette.classList.add('hidden');
      }, 250);
    }, 300);
  }

  setSpawnProtection(isProtected) {
    if (this.hud.spawnProtectIndicator) {
      if (isProtected) {
        this.hud.spawnProtectIndicator.classList.remove('hidden');
      } else {
        this.hud.spawnProtectIndicator.classList.add('hidden');
      }
    }
  }

  addKillFeedMessage(killerName, victimName, isHeadshot = false) {
    if (!this.hud.killFeed) return;
    const item = document.createElement('div');
    item.className = 'kill-feed-item';
    item.innerHTML = `<span class="killer">${killerName}</span> eliminated <span class="victim">${victimName}</span> ${isHeadshot ? '<span class="headshot-tag">🎯 HEADSHOT</span>' : ''}`;

    this.hud.killFeed.appendChild(item);

    setTimeout(() => {
      item.classList.add('fade-out');
      setTimeout(() => item.remove(), 400);
    }, 4000);
  }

  startMatchTimer() {
    this.stopMatchTimer();
    this.matchStartSeconds = 0;
    if (this.hud.timerVal) this.hud.timerVal.textContent = '00:00';

    this.matchTimerInterval = setInterval(() => {
      this.matchStartSeconds++;
      const mins = Math.floor(this.matchStartSeconds / 60).toString().padStart(2, '0');
      const secs = (this.matchStartSeconds % 60).toString().padStart(2, '0');
      if (this.hud.timerVal) this.hud.timerVal.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  stopMatchTimer() {
    if (this.matchTimerInterval) {
      clearInterval(this.matchTimerInterval);
      this.matchTimerInterval = null;
    }
  }

  showGameOver(isVictory, finalPlayerScore, finalEnemyScore, message = null) {
    this.stopMatchTimer();
    this.hideAllModals();

    if (isVictory) {
      this.gameOver.title.textContent = 'VICTORY';
      this.gameOver.title.className = 'title victory';
      this.gameOver.subtitle.textContent = message || 'You won the match!';
    } else {
      this.gameOver.title.textContent = 'DEFEAT';
      this.gameOver.title.className = 'title defeat';
      this.gameOver.subtitle.textContent = message || 'You were defeated in the arena';
    }

    this.gameOver.scoreDisplay.textContent = `FINAL SCORE: ${finalPlayerScore} - ${finalEnemyScore}`;
    this.gameOver.rematchBtn.disabled = false;
    this.gameOver.rematchStatus.textContent = '';

    this.screens.gameOver.classList.remove('hidden');
  }

  showOpponentLeftNotice(message) {
    this.showGameOver(true, this.hud.scorePlayer.textContent, this.hud.scoreEnemy.textContent, message || 'Opponent left the match');
  }
}
