/** キーボード・マウス入力（ポインターロック対応） */
export class Input {
  private keys = new Set<string>();
  private pressedK = new Set<string>();
  private releasedK = new Set<string>();
  private buttons = new Set<number>();
  private pressedB = new Set<number>();
  private releasedB = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** テスト時などポインターロックなしで操作を受け付ける */
  forceLocked = false;
  onLockChange?: (locked: boolean) => void;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedK.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.releasedK.add(e.code);
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      this.buttons.add(e.button);
      this.pressedB.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      if (this.buttons.has(e.button)) {
        this.buttons.delete(e.button);
        this.releasedB.add(e.button);
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    window.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.buttons.clear();
      this.onLockChange?.(this.locked);
    });
  }

  get active() {
    return this.locked || this.forceLocked;
  }

  lock() {
    if (this.locked) return;
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* 一部ブラウザでは連続要求で失敗する */
    }
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  down(code: string) {
    return this.keys.has(code);
  }
  pressed(code: string) {
    return this.pressedK.has(code);
  }
  released(code: string) {
    return this.releasedK.has(code);
  }
  mouseDown(b: number) {
    return this.buttons.has(b);
  }
  mousePressed(b: number) {
    return this.pressedB.has(b);
  }
  mouseReleased(b: number) {
    return this.releasedB.has(b);
  }

  /** テスト用: 仮想的にキーを押す/離す */
  simulateKey(code: string, isDown: boolean) {
    if (isDown) {
      if (!this.keys.has(code)) this.pressedK.add(code);
      this.keys.add(code);
    } else {
      this.keys.delete(code);
      this.releasedK.add(code);
    }
  }
  simulateButton(b: number, isDown: boolean) {
    if (isDown) {
      this.buttons.add(b);
      this.pressedB.add(b);
    } else {
      this.buttons.delete(b);
      this.releasedB.add(b);
    }
  }

  endFrame() {
    this.pressedK.clear();
    this.releasedK.clear();
    this.pressedB.clear();
    this.releasedB.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
