// Centralized InputManager: tracks key/mouse/wheel states, prevents phantom movement, clears state on focus loss
export class InputManager {
  constructor() {
    this.pressedKeys = new Set();
    this.mouseButtons = new Set();
    this.listeners = new Map();

    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundMouseDown = this.handleMouseDown.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
    this.boundWheel = this.handleWheel.bind(this);
    this.boundBlur = this.handleBlur.bind(this);
    this.boundVisibilityChange = this.handleVisibilityChange.bind(this);

    this.attach();
  }

  attach() {
    window.addEventListener('keydown', this.boundKeyDown, { passive: false });
    window.addEventListener('keyup', this.boundKeyUp, { passive: false });
    window.addEventListener('mousedown', this.boundMouseDown);
    window.addEventListener('mouseup', this.boundMouseUp);
    window.addEventListener('wheel', this.boundWheel, { passive: true });
    window.addEventListener('blur', this.boundBlur);
    document.addEventListener('visibilitychange', this.boundVisibilityChange);
  }

  detach() {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('mousedown', this.boundMouseDown);
    window.removeEventListener('mouseup', this.boundMouseUp);
    window.removeEventListener('wheel', this.boundWheel);
    window.removeEventListener('blur', this.boundBlur);
    document.removeEventListener('visibilitychange', this.boundVisibilityChange);
    this.clearAll();
  }

  handleKeyDown(e) {
    // Ignore key repeat events so holding a key doesn't flood repeated actions
    if (e.repeat) return;
    this.pressedKeys.add(e.code);
    this.emit('keydown', e.code, e);
  }

  handleKeyUp(e) {
    this.pressedKeys.delete(e.code);
    this.emit('keyup', e.code, e);
  }

  handleMouseDown(e) {
    this.mouseButtons.add(e.button);
    this.emit('mousedown', e.button, e);
  }

  handleMouseUp(e) {
    this.mouseButtons.delete(e.button);
    this.emit('mouseup', e.button, e);
  }

  handleWheel(e) {
    const dir = Math.sign(e.deltaY);
    this.emit('wheel', dir, e);
  }

  handleBlur() {
    this.clearAll();
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.clearAll();
    }
  }

  isKeyDown(code) {
    return this.pressedKeys.has(code);
  }

  isAnyKeyDown(codes) {
    for (const code of codes) {
      if (this.pressedKeys.has(code)) return true;
    }
    return false;
  }

  isMouseDown(button) {
    return this.mouseButtons.has(button);
  }

  clearAll() {
    this.pressedKeys.clear();
    this.mouseButtons.clear();
    this.emit('cleared');
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  emit(event, ...args) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(fn => {
        try {
          fn(...args);
        } catch (err) {
          console.error('[InputManager Event Error]:', err);
        }
      });
    }
  }
}

export const inputManager = new InputManager();
