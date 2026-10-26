/* FlipDrive: EV Chaos - input.js
 * Keyboard + multi-touch controls. Produces a control sample {throttle, brake, rot, boost}.
 * rot > 0 pitches the nose up (backflip), rot < 0 pitches it down (front flip).
 */
(function (root) {
  'use strict';
  const FD = (root.FD = root.FD || {});

  const Input = {
    keys: Object.create(null),
    touch: { throttle: false, brake: false, left: false, right: false, boost: false },
    handlers: {},
    enabled: true,
    usedTouch: false,
    on(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
    fire(name, arg) { (this.handlers[name] || []).forEach((fn) => fn(arg)); },

    init(touchRoot) {
      const prevent = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
      root.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
          // Form controls keep their own keys, but Escape must still back out of menus.
          if (e.code === 'Escape' && !e.repeat) this.fire('pause');
          return;
        }
        if (prevent.has(e.code) && this.enabled) e.preventDefault();
        if (e.repeat) { this.keys[e.code] = true; return; }
        this.keys[e.code] = true;
        if (e.code === 'KeyR') this.fire('restart');
        else if (e.code === 'Escape' || e.code === 'KeyP') this.fire('pause');
        else if (e.code === 'KeyC') this.fire('suspension');
        else if (e.code === 'KeyM') this.fire('mute');
        else if (e.code === 'Enter') this.fire('confirm');
      });
      root.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
      root.addEventListener('blur', () => { this.keys = Object.create(null); this.clearTouch(); });

      if (touchRoot) {
        const buttons = touchRoot.querySelectorAll('[data-act]');
        buttons.forEach((b) => {
          const act = b.getAttribute('data-act');
          const down = (e) => { e.preventDefault(); this.usedTouch = true; this.touch[act] = true; b.classList.add('down'); try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } };
          const up = (e) => { e.preventDefault(); this.touch[act] = false; b.classList.remove('down'); };
          b.addEventListener('pointerdown', down);
          b.addEventListener('pointerup', up);
          b.addEventListener('pointercancel', up);
          b.addEventListener('lostpointercapture', up);
          b.addEventListener('contextmenu', (e) => e.preventDefault());
        });
      }
    },
    clearTouch() {
      for (const k in this.touch) this.touch[k] = false;
      document.querySelectorAll('[data-act].down').forEach((b) => b.classList.remove('down'));
    },
    down(...codes) { for (const c of codes) if (this.keys[c]) return true; return false; },

    /** Raw control sample for this instant. */
    sample() {
      if (!this.enabled) return { throttle: 0, brake: 0, rot: 0, boost: false };
      const k = this.keys, t = this.touch;
      const throttle = (this.down('ArrowUp', 'KeyW') || t.throttle) ? 1 : 0;
      const brake = (this.down('ArrowDown', 'KeyS') || t.brake) ? 1 : 0;
      const left = this.down('ArrowLeft', 'KeyA') || t.left;
      const right = this.down('ArrowRight', 'KeyD') || t.right;
      const rot = (left ? 1 : 0) - (right ? 1 : 0);
      const boost = !!(k.Space || t.boost);
      return { throttle, brake, rot, boost };
    }
  };
  FD.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
