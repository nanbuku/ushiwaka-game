import * as THREE from 'three';
import type { Game } from '../core/Game';
import { DISTRICT_LABEL, HALF } from '../world/Layout';

interface Pop {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  life: number;
}

const MAP_SIZE = 720;
const MAP_SCALE = MAP_SIZE / 720; // 1px = 1m

/** 画面上の表示（ゲージ・ミニマップ・通知・タイトルなど） */
export class HUD {
  root: HTMLDivElement;
  private meterLabel!: HTMLDivElement;
  private meterValue!: HTMLSpanElement;
  private meterFill!: HTMLDivElement;
  private evilFill!: HTMLDivElement;
  private evilValue!: HTMLSpanElement;
  private hpFill!: HTMLDivElement;
  private clock!: HTMLDivElement;
  private place!: HTMLDivElement;
  private prompt!: HTMLDivElement;
  private toasts!: HTMLDivElement;
  private charge!: HTMLDivElement;
  private mini!: HTMLCanvasElement;
  private miniCtx!: CanvasRenderingContext2D;
  private mapCanvas: HTMLCanvasElement | null = null;
  private pops: Pop[] = [];
  private flash!: HTMLDivElement;
  private overlay!: HTMLDivElement;
  private fadeEl!: HTMLDivElement;
  private bigMap!: HTMLCanvasElement;
  private heatIcons!: HTMLSpanElement;
  private heatBox!: HTMLDivElement;
  private request!: HTMLDivElement;
  private captureEl!: HTMLDivElement;
  private v = new THREE.Vector3();
  private miniT = 0;

  constructor(private game: Game) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    document.body.appendChild(this.root);
    this.root.innerHTML = `
      <div class="panel meter">
        <div class="meter-label"><span class="ml">なんくの幸福度</span><span class="mv">0</span></div>
        <div class="bar main"><div></div></div>
        <div class="meter-sub"><span>うしわかの悪行</span><span class="ev">0</span></div>
        <div class="bar evil"><div></div></div>
        <div class="meter-sub"><span>うしわかの元気</span></div>
        <div class="bar hp"><div></div></div>
      </div>
      <div class="panel status"><div class="clock">09:00</div><div class="place">ひだまり町</div><div class="heat"><span class="heat-label">保健所</span><span class="heat-icons"></span></div></div>
      <div class="panel request hidden"></div>
      <div class="capture"><div class="capture-label">つかまりそう！ 走って逃げろ！</div><div class="capture-bar"><div></div></div></div>
      <div class="prompt"></div>
      <div class="charge"><div></div></div>
      <div class="toasts"></div>
      <canvas class="minimap" width="200" height="200"></canvas>
      <div class="help">WASD 移動 / Shift 走る / Space ジャンプ / 左クリック 噛む / 右クリック 吠える（長押しで大吠え） / E くわえる・話す / Q 投げる / M 地図</div>
      <div class="flash"></div>
      <div class="fade"></div>
      <canvas class="bigmap hidden" width="720" height="720"></canvas>
      <div class="overlay"></div>`;
    const q = <T extends Element>(s: string) => this.root.querySelector(s) as T;
    this.meterLabel = q('.ml');
    this.meterValue = q('.mv');
    this.meterFill = q('.bar.main > div');
    this.evilFill = q('.bar.evil > div');
    this.evilValue = q('.ev');
    this.hpFill = q('.bar.hp > div');
    this.clock = q('.clock');
    this.place = q('.place');
    this.prompt = q('.prompt');
    this.toasts = q('.toasts');
    this.charge = q('.charge');
    this.mini = q('.minimap');
    this.miniCtx = this.mini.getContext('2d')!;
    this.flash = q('.flash');
    this.fadeEl = q('.fade');
    this.overlay = q('.overlay');
    this.bigMap = q('.bigmap');
    this.heatIcons = q('.heat-icons');
    this.heatBox = q('.heat');
    this.request = q('.request');
    this.captureEl = q('.capture');
    this.setGameUIVisible(false);
  }

  setGameUIVisible(v: boolean) {
    this.root.classList.toggle('ingame', v);
  }

  // ---------- オーバーレイ ----------
  setLoading(text: string) {
    this.overlay.className = 'overlay show loading';
    this.overlay.innerHTML = `<div class="logo">うしわか</div><div class="sub">${text}</div>`;
  }

  showTitle(hasSave: boolean, onStart: (fresh: boolean) => void) {
    this.overlay.className = 'overlay show title';
    this.overlay.innerHTML = `
      <div class="logo">うしわか</div>
      <div class="sub">〜 元ぬいぐるみの、しろいいぬ 〜</div>
      <div class="buttons">
        <button class="btn new">はじめから</button>
        ${hasSave ? '<button class="btn cont">つづきから</button>' : ''}
      </div>
      <div class="controls">
        <div><b>WASD</b> 移動　<b>Shift</b> 走る　<b>Space</b> ジャンプ　<b>マウス</b> カメラ</div>
        <div><b>左クリック</b> 噛みつく　<b>右クリック</b> 吠える（長押しで大吠え）</div>
        <div><b>E</b> くわえる・はなす・話す　<b>Q</b> 投げる　<b>M</b> 地図　<b>Esc</b> 一時停止</div>
      </div>
      <div class="note">音が出ます。クリックするとマウスがゲーム画面に固定されます（Escで解除）。</div>`;
    this.overlay.querySelector('.new')?.addEventListener('click', () => onStart(true));
    this.overlay.querySelector('.cont')?.addEventListener('click', () => onStart(false));
  }

  showPause(show: boolean, onResume?: () => void) {
    if (!show) {
      this.overlay.className = 'overlay';
      this.overlay.innerHTML = '';
      return;
    }
    this.overlay.className = 'overlay show pause';
    this.overlay.innerHTML = `<div class="logo small">一時停止</div><div class="sub">クリックで再開</div>
      <div class="controls">
        <div><b>WASD</b> 移動　<b>Shift</b> 走る　<b>Space</b> ジャンプ</div>
        <div><b>左クリック</b> 噛みつく　<b>右クリック</b> 吠える（長押しで大吠え）</div>
        <div><b>E</b> くわえる・はなす・話す　<b>Q</b> 投げる　<b>M</b> 地図</div>
      </div>`;
    this.overlay.onclick = () => onResume?.();
  }

  showEnding(kind: 'happy' | 'devil') {
    const g = this.game;
    const s = g.karma.stats;
    g.input.unlock();
    g.paused = true;
    this.overlay.className = `overlay show ending ${kind}`;
    this.overlay.onclick = null;
    this.overlay.innerHTML = `
      <div class="logo">${kind === 'happy' ? 'しあわせエンド' : 'あくまエンド'}</div>
      <div class="sub">${kind === 'happy' ? '〜 なんくの笑顔 〜' : '〜 ふたりきりの楽園 〜'}</div>
      <div class="stats">
        <div>届けた物 <b>${s.gifts}</b></div><div>噛みついた回数 <b>${s.bites}</b></div>
        <div>気絶させた人 <b>${s.faints}</b></div><div>盗んだ物 <b>${s.steals}</b></div>
        <div>犠牲者 <b>${s.kills}</b></div>
      </div>
      <div class="buttons"><button class="btn cont">このまま遊ぶ</button></div>`;
    this.overlay.querySelector('.cont')?.addEventListener('click', () => {
      this.showPause(false);
      g.paused = false;
      g.input.lock();
    });
  }

  hideOverlay() {
    this.overlay.className = 'overlay';
    this.overlay.innerHTML = '';
    this.overlay.onclick = null;
  }

  fade(on: boolean) {
    this.fadeEl.classList.toggle('on', on);
  }

  // ---------- 通知 ----------
  toast(text: string, kind: 'good' | 'bad' | 'evil' | 'info' = 'info', secs = 3.5) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    el.style.animationDuration = `${secs}s`;
    this.toasts.prepend(el);
    while (this.toasts.children.length > 6) this.toasts.lastChild?.remove();
    setTimeout(() => el.remove(), secs * 1000);
  }

  popText(pos: THREE.Vector3, text: string, color = '#ffffff', size = 24) {
    const el = document.createElement('div');
    el.className = 'pop';
    el.textContent = text;
    el.style.color = color;
    el.style.fontSize = `${size}px`;
    this.root.appendChild(el);
    this.pops.push({ el, pos: pos.clone(), t: 0, life: 1.3 });
    if (this.pops.length > 24) this.pops.shift()?.el.remove();
  }

  flashDamage() {
    this.flash.classList.remove('on');
    void this.flash.offsetWidth;
    this.flash.classList.add('on');
  }

  // ---------- 地図 ----------
  buildMap() {
    const g = this.game;
    const c = document.createElement('canvas');
    c.width = MAP_SIZE;
    c.height = MAP_SIZE;
    const ctx = c.getContext('2d')!;
    const tx = (x: number) => (x + 360) * MAP_SCALE;
    ctx.fillStyle = '#6f9a4e';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    const col: Record<string, string> = {
      town: '#e9dfc9',
      city: '#c9ccd2',
      downtown: '#e3c8d2',
      civic: '#d9e2c9',
      riverside: '#c4c2b4',
      park: '#8fcf6e',
      amusement: '#f4d8e8',
      countryHill: '#9fc77a',
      countryField: '#b5d48a',
    };
    for (const l of g.world.lots) {
      ctx.fillStyle = col[l.district];
      ctx.fillRect(tx(l.x0), tx(l.z0), (l.x1 - l.x0) * MAP_SCALE, (l.z1 - l.z0) * MAP_SCALE);
    }
    for (const w of g.world.waters) {
      ctx.fillStyle = '#5aa7e0';
      ctx.beginPath();
      ctx.ellipse(tx(w.x), tx(w.z), w.rx * MAP_SCALE, w.rz * MAP_SCALE, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const r of g.world.roads) {
      ctx.fillStyle = r.kind === 'rural' ? '#a39a80' : '#5b5e66';
      const hw = r.kind === 'avenue' ? 7 : r.kind === 'street' ? 4.5 : 3;
      if (r.axis === 'h') ctx.fillRect(tx(r.a - hw), tx(r.line - hw), (r.b - r.a + hw * 2) * MAP_SCALE, hw * 2 * MAP_SCALE);
      else ctx.fillRect(tx(r.line - hw), tx(r.a - hw), hw * 2 * MAP_SCALE, (r.b - r.a + hw * 2) * MAP_SCALE);
    }
    this.mapCanvas = c;
    // 大きい地図
    const b = this.bigMap.getContext('2d')!;
    b.drawImage(c, 0, 0);
    b.font = 'bold 15px "M PLUS Rounded 1c", sans-serif';
    b.textAlign = 'center';
    for (let r = 0; r < 3; r++)
      for (let k = 0; k < 3; k++) {
        const x = -200 + k * 200;
        const z = -200 + r * 200;
        const d = g.world.district(x, z);
        b.fillStyle = 'rgba(0,0,0,0.55)';
        b.fillText(DISTRICT_LABEL[d], tx(x) + 1, tx(z) + 1);
        b.fillStyle = '#ffffff';
        b.fillText(DISTRICT_LABEL[d], tx(x), tx(z));
      }
  }

  private drawMini() {
    const g = this.game;
    const ctx = this.miniCtx;
    const W = this.mini.width;
    const p = g.player.pos;
    const zoom = 1.05;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#6f9a4e';
    ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2, W / 2);
    ctx.rotate(g.camRig.yaw);
    ctx.scale(zoom, zoom);
    if (this.mapCanvas) ctx.drawImage(this.mapCanvas, -(p.x + 360) * MAP_SCALE, -(p.z + 360) * MAP_SCALE);
    for (const n of g.npcs.list) {
      const dx = n.pos.x - p.x;
      const dz = n.pos.z - p.z;
      if (Math.abs(dx) > 110 || Math.abs(dz) > 110) continue;
      ctx.fillStyle = !n.alive ? '#5a0a0a' : n.state === 'flee' || n.state === 'startle' ? '#ff4040' : n.state === 'faint' ? '#ffd23f' : '#ffffff';
      ctx.fillRect(dx - 1.6, dz - 1.6, 3.2, 3.2);
    }
    // 家
    const h = g.nanku.pos;
    let hx = h.x - p.x;
    let hz = h.z - p.z;
    const hd = Math.hypot(hx, hz);
    const lim = W / 2 / zoom - 8;
    if (hd > lim) {
      hx = (hx / hd) * lim;
      hz = (hz / hd) * lim;
    }
    ctx.save();
    ctx.translate(hx, hz);
    ctx.rotate(-g.camRig.yaw);
    ctx.fillStyle = g.karma.mode === 'devil' ? '#ff2a55' : '#ff7eb6';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♥', 0, 0);
    ctx.restore();
    // うしわか
    ctx.save();
    ctx.rotate(Math.atan2(Math.cos(g.player.yaw), Math.sin(g.player.yaw)));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  // ---------- 毎フレーム ----------
  update(dt: number) {
    const g = this.game;
    const k = g.karma;
    const devil = k.mode === 'devil';
    this.root.classList.toggle('devil', devil);
    this.meterLabel.textContent = devil ? 'なんくの悪魔度' : 'なんくの幸福度';
    const mv = Math.round(devil ? k.devil : k.happiness);
    this.meterValue.textContent = `${mv} / 100`;
    this.meterFill.style.width = `${mv}%`;
    this.evilValue.textContent = devil ? `${Math.round(k.evil)}` : `${Math.round(k.evil)} / 100`;
    this.evilFill.style.width = `${Math.min(100, k.evil)}%`;
    this.hpFill.style.width = `${(g.player.hp / g.player.maxHp) * 100}%`;
    this.clock.textContent = g.sky.clockText;
    this.place.textContent = DISTRICT_LABEL[g.world.district(g.player.pos.x, g.player.pos.z)] + (g.world.zoneAt(g.player.pos.x, g.player.pos.z) === 'supermarket' ? '・スーパーまるなか' : '');
    const hint = g.dialogue.active ? '' : g.player.hint;
    if (this.prompt.textContent !== hint) this.prompt.textContent = hint;
    const ch = g.player.chargeLevel;
    this.charge.style.opacity = ch > 0.02 ? '1' : '0';
    (this.charge.firstElementChild as HTMLDivElement).style.width = `${ch * 100}%`;
    this.charge.classList.toggle('full', ch >= 1);

    this.bigMap.classList.toggle('hidden', !g.input.down('KeyM') && !g.input.down('Tab'));

    // 通報レベル
    const lv = g.heat.level;
    const part = g.heat.value - lv;
    let icons = '';
    for (let i = 0; i < 5; i++) icons += `<i class="${i < lv ? 'on' : i === lv && part > 0.05 ? 'half' : ''}"></i>`;
    if (this.heatIcons.innerHTML !== icons) this.heatIcons.innerHTML = icons;
    this.heatBox.classList.toggle('seen', g.heat.seen && lv > 0);
    // おつかい
    const rl = g.requests.label;
    this.request.classList.toggle('hidden', !rl);
    const rt = rl ? `<b>おつかい</b>　${rl}` : '';
    if (this.request.innerHTML !== rt) this.request.innerHTML = rt;
    this.request.classList.toggle('done', g.requests.complete);
    // 捕獲
    this.captureEl.style.opacity = g.heat.capturing ? '1' : '0';
    (this.captureEl.querySelector('.capture-bar > div') as HTMLDivElement).style.width = `${g.heat.captureProgress * 100}%`;

    this.miniT -= dt;
    if (this.miniT <= 0) {
      this.miniT = 1 / 30;
      this.drawMini();
    }

    // 吹き出し文字
    const cam = g.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      if (p.t > p.life) {
        p.el.remove();
        this.pops.splice(i, 1);
        continue;
      }
      this.v.copy(p.pos);
      this.v.y += p.t * 0.6;
      this.v.project(cam);
      if (this.v.z > 1) {
        p.el.style.display = 'none';
        continue;
      }
      p.el.style.display = '';
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      const s = p.t < 0.12 ? 0.6 + (p.t / 0.12) * 0.6 : 1.2 - Math.min(0.2, (p.t - 0.12) * 0.6);
      p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
      p.el.style.opacity = `${Math.min(1, (p.life - p.t) * 3)}`;
    }
  }
}

void HALF;
