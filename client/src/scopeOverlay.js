// Tactical Sniper Scope State Machine & Overlay with Hold-Breath Steady Aim
import { CONFIG } from './config.js';

export const SCOPE_STATE = {
  HIP: 'HIP',
  SCOPING_IN: 'SCOPING_IN',
  SCOPED: 'SCOPED',
  SCOPING_OUT: 'SCOPING_OUT'
};

export class ScopeOverlay {
  constructor(audioManager, uiManager) {
    this.audio = audioManager;
    this.ui = uiManager;

    // Single source of truth: Scope State Machine
    this.state = SCOPE_STATE.HIP;
    this.blend = 0.0; // 0.0 (hipfire) to 1.0 (fully scoped)
    this.transitionDuration = CONFIG.WEAPONS.SNIPER.SCOPE_TRANSITION_SEC || 0.18;

    // Steady Aim / Breath System
    this.isHoldingBreath = false;
    this.breathTimer = CONFIG.WEAPONS.SNIPER.STEADY_AIM_DURATION_SEC;
    this.breathExhausted = false;
    this.swayTime = 0;
    this.swayPitch = 0;
    this.swayYaw = 0;

    this.scopeElem = document.getElementById('sniper-scope');
    this.breathBarFill = null;
    this.setupUI();
  }

  setupUI() {
    if (this.scopeElem) {
      // Ensure steady indicator is only appended once
      if (!this.scopeElem.querySelector('.scope-breath-indicator')) {
        const steadyIndicator = document.createElement('div');
        steadyIndicator.className = 'scope-breath-indicator';
        steadyIndicator.innerHTML = `
          <div class="breath-label">HOLD SHIFT TO STEADY AIM</div>
          <div class="breath-bar-bg"><div id="breath-bar-fill" class="breath-bar-fill"></div></div>
        `;
        this.scopeElem.appendChild(steadyIndicator);
      }
      this.breathBarFill = document.getElementById('breath-bar-fill');
      this.scopeElem.classList.add('hidden');
      this.scopeElem.style.opacity = '0';
    }
  }

  // Request scope in/out toggle or hold
  setScoped(scoped) {
    if (scoped) {
      if (this.state === SCOPE_STATE.HIP || this.state === SCOPE_STATE.SCOPING_OUT) {
        this.state = SCOPE_STATE.SCOPING_IN;
        if (this.scopeElem) {
          this.scopeElem.classList.remove('hidden');
        }
      }
    } else {
      if (this.state === SCOPE_STATE.SCOPED || this.state === SCOPE_STATE.SCOPING_IN) {
        this.state = SCOPE_STATE.SCOPING_OUT;
        this.isHoldingBreath = false;
      }
    }
  }

  // Force reset scope state instantly on reload, death, respawn, pause, bullet cam, or blur
  forceReset() {
    this.state = SCOPE_STATE.HIP;
    this.blend = 0.0;
    this.isHoldingBreath = false;
    this.breathTimer = CONFIG.WEAPONS.SNIPER.STEADY_AIM_DURATION_SEC;
    this.breathExhausted = false;
    this.swayPitch = 0;
    this.swayYaw = 0;

    if (this.scopeElem) {
      this.scopeElem.classList.add('hidden');
      this.scopeElem.style.opacity = '0';
    }
  }

  setHoldingBreath(holding) {
    if (this.state !== SCOPE_STATE.SCOPED || this.blend < 0.95) {
      this.isHoldingBreath = false;
      return;
    }

    if (holding && !this.breathExhausted && this.breathTimer > 0) {
      if (!this.isHoldingBreath) {
        this.isHoldingBreath = true;
        if (this.audio) {
          this.audio.playTone(180, 'sine', 0.25, this.audio.ctx?.currentTime || 0, 0.2);
        }
      }
    } else {
      this.isHoldingBreath = false;
    }
  }

  update(dtSec) {
    const rate = 1.0 / Math.max(0.01, this.transitionDuration);

    // Update State Machine & Blend
    if (this.state === SCOPE_STATE.SCOPING_IN) {
      this.blend += rate * dtSec;
      if (this.blend >= 1.0) {
        this.blend = 1.0;
        this.state = SCOPE_STATE.SCOPED;
      }
    } else if (this.state === SCOPE_STATE.SCOPING_OUT) {
      this.blend -= rate * dtSec;
      if (this.blend <= 0.0) {
        this.blend = 0.0;
        this.state = SCOPE_STATE.HIP;
        if (this.scopeElem) {
          this.scopeElem.classList.add('hidden');
        }
      }
    }

    // Update DOM overlay opacity directly from blend
    if (this.scopeElem && this.blend > 0) {
      this.scopeElem.classList.remove('hidden');
      // Smooth fade-in overlay curve
      const alpha = Math.min(1.0, Math.max(0.0, (this.blend - 0.15) / 0.85));
      this.scopeElem.style.opacity = alpha.toFixed(3);
    }

    // Steady Aim / Breath Timer
    if (this.state === SCOPE_STATE.SCOPED && this.isHoldingBreath) {
      this.breathTimer = Math.max(0, this.breathTimer - dtSec);
      if (this.breathTimer <= 0) {
        this.isHoldingBreath = false;
        this.breathExhausted = true;
        if (this.audio) {
          this.audio.playTone(320, 'sawtooth', 0.15, this.audio.ctx?.currentTime || 0, 0.25);
        }
      }
    } else {
      // Regenerate breath
      const regenRate = this.state === SCOPE_STATE.HIP ? 1.5 : 0.8;
      this.breathTimer = Math.min(
        CONFIG.WEAPONS.SNIPER.STEADY_AIM_DURATION_SEC,
        this.breathTimer + dtSec * regenRate
      );
      if (this.breathTimer >= 1.5) {
        this.breathExhausted = false;
      }
    }

    // Update UI breath bar fill
    if (this.breathBarFill) {
      const pct = (this.breathTimer / CONFIG.WEAPONS.SNIPER.STEADY_AIM_DURATION_SEC) * 100;
      this.breathBarFill.style.width = `${pct}%`;
      if (this.isHoldingBreath) {
        this.breathBarFill.style.background = '#00f2fe';
      } else if (this.breathExhausted) {
        this.breathBarFill.style.background = '#ef4444';
      } else {
        this.breathBarFill.style.background = '#10b981';
      }
    }

    // Breathing Sway: Lissajous figure-8, scaled by blend
    if (this.blend > 0.01) {
      this.swayTime += dtSec * 2.2;
      if (this.isHoldingBreath) {
        this.swayPitch *= Math.pow(0.05, dtSec);
        this.swayYaw *= Math.pow(0.05, dtSec);
      } else {
        const swayScale = (this.breathExhausted ? 0.0035 : 0.0016) * this.blend;
        this.swayYaw = Math.sin(this.swayTime) * swayScale;
        this.swayPitch = Math.cos(this.swayTime * 2.0) * swayScale * 0.7;
      }
    } else {
      this.swayPitch = 0;
      this.swayYaw = 0;
    }
  }

  getBlend() {
    return this.blend;
  }

  // Derive sensitivity scale directly from blend (1.0 in hip down to 0.25 in scoped)
  getSensitivityScale() {
    const minSens = CONFIG.WEAPONS.SNIPER.SENSITIVITY_SCALE_SCOPED;
    return 1.0 - this.blend * (1.0 - minSens);
  }

  // Derive movement speed multiplier (1.0 in hip down to ~0.33 when fully scoped: 4.5 * 0.33 = 1.5 u/s)
  getMoveSpeedMultiplier() {
    const scopedSpeed = CONFIG.PLAYER.SCOPED_SPEED || CONFIG.PLAYER.KINEMATICS?.sniper?.SCOPED_SPEED || 1.5;
    const walkSpeed = CONFIG.PLAYER.WALK_SPEED || CONFIG.PLAYER.KINEMATICS?.sniper?.WALK_SPEED || 4.5;
    const targetMultiplier = scopedSpeed / walkSpeed; // 1.5 / 4.5 = 0.333
    return 1.0 - this.blend * (1.0 - targetMultiplier);
  }

  // Prevent shooting during scope transitions
  canShoot() {
    return this.state === SCOPE_STATE.HIP || this.state === SCOPE_STATE.SCOPED;
  }

  isScoped() {
    return this.blend > 0.5;
  }
}
