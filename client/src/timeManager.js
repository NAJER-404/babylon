// Time Manager: Controls Cinematic Slow-Motion Time Scaling across the Game
export class TimeManager {
  constructor() {
    this.timeScale = 1.0;
    this.targetScale = 1.0;
    this.easeSpeed = 3.0; // Units per second
    this.isPaused = false;
  }

  setTimeScale(scale, instant = false) {
    this.targetScale = Math.max(0.0, Math.min(2.0, scale));
    if (instant) {
      this.timeScale = this.targetScale;
    }
  }

  setHitStop(durationMs, onComplete = null) {
    const prevTarget = this.targetScale;
    this.timeScale = 0.0;
    setTimeout(() => {
      this.timeScale = prevTarget;
      if (onComplete) onComplete();
    }, durationMs);
  }

  update(rawDtSec) {
    if (Math.abs(this.timeScale - this.targetScale) > 0.001) {
      const step = (this.targetScale - this.timeScale) * Math.min(1.0, this.easeSpeed * rawDtSec);
      this.timeScale += step;
    } else {
      this.timeScale = this.targetScale;
    }
  }

  getDeltaTime(rawDt) {
    return rawDt * this.timeScale;
  }

  reset() {
    this.timeScale = 1.0;
    this.targetScale = 1.0;
    this.isPaused = false;
  }
}

export const timeManager = new TimeManager();
