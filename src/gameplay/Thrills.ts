import type { Game } from '../core/Game';
import { CARRIER, ISLE } from '../world/Frontier';

type Ev = 'kill' | 'faint' | 'wreck' | 'tower' | 'vehicle' | 'air' | 'nuke' | 'boss';
const PTS: Record<Ev, number> = { kill: 100, faint: 30, wreck: 250, tower: 1200, vehicle: 150, air: 900, nuke: 3000, boss: 5000 };

const ACH: [string, string, string][] = [
  ['kill1', 'はじめての犠牲者', '人を倒す'],
  ['kill100', '百人斬り', '100人倒す'],
  ['wreck20', '解体屋', '建物を20棟こわす'],
  ['tower5', '摩天楼崩し', '高層ビルを5棟こわす'],
  ['veh30', 'スクラップ工場', '乗り物を30台こわす'],
  ['nuke1', '核の冬', '核爆弾を爆発させる'],
  ['nuke10', '終末の白い犬', '核爆発を10回おこす'],
  ['air1', '撃墜', '敵機を撃ち落とす'],
  ['air5', '撃墜王', '敵機を5機撃ち落とす'],
  ['dodge5', '回避の達人', 'フレアでミサイルを5発そらす'],
  ['sky', '空飛ぶ犬', '戦闘機で離陸する'],
  ['mach', '音速の犬', '戦闘機で時速330kmを出す'],
  ['carrier', '空母着艦', '戦闘機で空母に着艦する'],
  ['heli', 'ヘリパイロット', 'ヘリで飛ぶ'],
  ['balloon', '風まかせ', '気球で高さ100mまで上がる'],
  ['summit', '山頂の犬', '歩いて高さ120mの山に登る'],
  ['island', '島流し', '海の島にたどりつく'],
  ['desert', '砂漠の犬', '西の演習場に行く'],
  ['combo10', '大暴れ', 'コンボ x10 を出す'],
  ['combo25', '伝説の暴れ犬', 'コンボ x25 を出す'],
  ['score100k', '10万点の破壊', '1回のコンボで100,000点'],
  ['slowmo', 'うしわかタイム', 'T でスローモーションを使う'],
  ['kaiju', '怪獣退治', '灰色の怪獣〈グレイ〉を倒す'],
  ['story', 'グレイハート壊滅', 'メインストーリーをクリアする'],
];
const KEY = 'ushiwaka-thrills-v1';

/**
 * 暴れるほど気持ちいい仕組み：コンボ（倍率と点数）、スローモーション、実績。
 * P で画面効果（光のにじみ）の切り替え、T でうしわかタイム、J で実績一覧。
 */
export class Thrills {
  timeScale = 1;
  mult = 0;
  score = 0;
  best = 0;
  private comboT = 0;
  private slowT = 0;
  private slowScale = 1;
  private slowCd = 0;
  private checkT = 0;
  private flewJet = false;
  private got = new Set<string>();
  counts: Record<string, number> = {};
  private el: HTMLDivElement;
  private vignette: HTMLDivElement;
  private panel: HTMLDivElement;
  private shown = '';
  /** 実績のお知らせ（重ならないよう1つずつ出す） */
  private queue: string[] = [];
  private bannerT = 0;
  private banner: HTMLDivElement;

  constructor(private game: Game) {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (d) {
        for (const id of d.got ?? []) this.got.add(id);
        this.counts = d.counts ?? {};
        this.best = d.best ?? 0;
      }
    } catch {
      /* noop */
    }
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;left:28px;top:34%;text-align:left;pointer-events:none;z-index:25;font-family:"M PLUS Rounded 1c",sans-serif;color:#fff;text-shadow:0 0 10px #000,0 0 3px #000;display:none';
    this.vignette = document.createElement('div');
    this.vignette.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:20;opacity:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 50%,rgba(20,30,70,0.6) 100%);transition:opacity .2s';
    this.panel = document.createElement('div');
    this.panel.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,92vw);max-height:80vh;overflow:auto;background:rgba(20,22,30,0.92);color:#fff;border-radius:16px;padding:18px 22px;z-index:60;font:14px "M PLUS Rounded 1c",sans-serif;display:none;box-shadow:0 10px 40px rgba(0,0,0,.5)';
    this.banner = document.createElement('div');
    this.banner.style.cssText = 'position:fixed;left:50%;bottom:150px;transform:translateX(-50%);padding:8px 18px;border-radius:12px;background:rgba(40,30,10,0.85);color:#ffd166;font:800 16px "M PLUS Rounded 1c",sans-serif;pointer-events:none;z-index:26;display:none;box-shadow:0 4px 20px rgba(0,0,0,.4)';
    document.body.append(this.el, this.vignette, this.panel, this.banner);
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ got: [...this.got], counts: this.counts, best: this.best }));
    } catch {
      /* noop */
    }
  }

  /** 暴れたできごと（コンボがつながる） */
  event(kind: Ev, n = 1) {
    if (n <= 0) return;
    this.mult = Math.min(99, this.mult + n);
    this.comboT = 4.5;
    this.score += PTS[kind] * n * Math.max(1, this.mult);
    this.count(kind, n);
    if (this.mult >= 10) this.unlock('combo10');
    if (this.mult >= 25) this.unlock('combo25');
    if (this.score >= 100000) this.unlock('score100k');
    this.render(kind === 'nuke' || kind === 'boss' || kind === 'air');
  }

  count(kind: string, n = 1) {
    this.counts[kind] = (this.counts[kind] ?? 0) + n;
    const c = this.counts;
    if (c.kill >= 1) this.unlock('kill1');
    if (c.kill >= 100) this.unlock('kill100');
    if (c.wreck >= 20) this.unlock('wreck20');
    if (c.tower >= 5) this.unlock('tower5');
    if (c.vehicle >= 30) this.unlock('veh30');
    if (c.nuke >= 1) this.unlock('nuke1');
    if (c.nuke >= 10) this.unlock('nuke10');
    if (c.air >= 1) this.unlock('air1');
    if (c.air >= 5) this.unlock('air5');
    if (c.dodge >= 5) this.unlock('dodge5');
  }

  unlock(id: string) {
    if (this.got.has(id)) return;
    const a = ACH.find((x) => x[0] === id);
    if (!a) return;
    this.got.add(id);
    this.save();
    this.queue.push(`🏆 実績解除「${a[1]}」 <span style="color:#fff;font-weight:600">${a[2]}（J で一覧）</span>`);
  }

  /** スローモーション（secs 秒、速さ scale 倍） */
  slowmo(secs: number, scale: number) {
    if (this.slowT < secs) this.slowT = secs;
    this.slowScale = Math.min(this.slowT > 0 && this.slowScale < 1 ? this.slowScale : 1, scale);
  }

  private render(big: boolean) {
    const label = this.mult >= 25 ? '伝説の暴れ犬!!' : this.mult >= 15 ? '大災害!' : this.mult >= 10 ? '大暴れ!' : this.mult >= 5 ? 'いいぞ!' : '';
    const html = `<div style="font-size:${big ? 54 : 40}px;font-weight:900;line-height:1;color:${this.mult >= 10 ? '#ffd166' : '#ffffff'}">x${this.mult}</div><div style="font-size:20px;font-weight:800">${this.score.toLocaleString()} 点</div><div style="font-size:16px;color:#ff9f9f;font-weight:800">${label}</div>`;
    if (html !== this.shown) {
      this.el.innerHTML = html;
      this.shown = html;
      this.el.animate([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 180 });
    }
    this.el.style.display = 'block';
  }

  private togglePanel() {
    const show = this.panel.style.display === 'none';
    if (!show) {
      this.panel.style.display = 'none';
      return;
    }
    const rows = ACH.map(([id, name, how]) => `<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08);opacity:${this.got.has(id) ? 1 : 0.45}"><span>${this.got.has(id) ? '🏆' : '🔒'}</span><b style="min-width:9em">${name}</b><span>${how}</span></div>`).join('');
    this.panel.innerHTML = `<div style="font-size:20px;font-weight:900;margin-bottom:8px">実績 ${this.got.size} / ${ACH.length}</div><div style="margin-bottom:10px;color:#ffd166">最高コンボ点 ${this.best.toLocaleString()} 点</div>${rows}<div style="margin-top:10px;opacity:.7">J で閉じる</div>`;
    this.panel.style.display = 'block';
  }

  /** 毎フレーム（実時間で） */
  update(dt: number) {
    const g = this.game;
    const inp = g.input;
    if (inp.pressed('KeyJ')) this.togglePanel();
    if (inp.pressed('KeyP')) g.setFx(!g.fxOn);
    this.slowCd -= dt;
    if (inp.pressed('KeyT') && g.started && !g.paused) {
      if (this.slowCd <= 0) {
        this.slowCd = 18;
        this.slowmo(5, 0.3);
        this.unlock('slowmo');
        g.hud.toast('うしわかタイム！', 'evil', 2);
      } else g.hud.toast(`うしわかタイムはあと ${Math.ceil(this.slowCd)} 秒で使える`, 'info', 1.5);
    }
    if (this.slowT > 0) {
      this.slowT -= dt;
      this.timeScale += (this.slowScale - this.timeScale) * Math.min(1, dt * 10);
    } else {
      this.slowScale = 1;
      this.timeScale += (1 - this.timeScale) * Math.min(1, dt * 3);
    }
    this.vignette.style.opacity = `${Math.min(1, (1 - this.timeScale) * 1.6)}`;
    this.bannerT -= dt;
    if (this.bannerT <= 0) {
      const next = this.queue.shift();
      this.banner.style.display = next ? 'block' : 'none';
      if (next) {
        this.banner.innerHTML = next;
        this.bannerT = 2.6;
        g.audio.play('happy', undefined, 0.6, 1.2);
      }
    }
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        if (this.mult >= 3) g.hud.toast(`コンボ終了　x${this.mult}　${this.score.toLocaleString()} 点${this.score > this.best ? '（自己ベスト！）' : ''}`, 'evil', 4);
        if (this.score > this.best) {
          this.best = this.score;
          this.save();
        }
        this.mult = 0;
        this.score = 0;
        this.el.style.display = 'none';
        this.shown = '';
      }
    }
    // 状態で解除される実績
    this.checkT -= dt;
    if (this.checkT > 0 || !g.started) return;
    this.checkT = 0.5;
    const p = g.player;
    const v = p.driving;
    if (v) {
      const alt = v.pos.y - g.world.groundHeight(v.pos.x, v.pos.z);
      if (v.kind === 'jet' && alt > 5) {
        this.flewJet = true;
        this.unlock('sky');
        if (Math.abs(v.speed) * 3.6 >= 330) this.unlock('mach');
      }
      if (v.kind === 'jet' && this.flewJet && Math.abs(v.speed) < 3 && Math.abs(v.pos.x - CARRIER.x) < CARRIER.hw && Math.abs(v.pos.z - CARRIER.z) < CARRIER.hl && v.pos.y > CARRIER.h - 1) this.unlock('carrier');
      if (v.kind === 'heli' && alt > 5) this.unlock('heli');
      if (v.kind === 'balloon' && alt > 100) this.unlock('balloon');
    } else {
      this.flewJet = false;
      if (p.pos.y > 120) this.unlock('summit');
    }
    if (Math.hypot(p.pos.x - ISLE.x, p.pos.z - ISLE.z) < ISLE.r) this.unlock('island');
    const r = g.world.landmarks.range;
    if (r && Math.hypot(p.pos.x - r.x, p.pos.z - r.z) < 200) this.unlock('desert');
    if (g.story.done) this.unlock('story');
  }
}
