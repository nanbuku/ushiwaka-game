import * as THREE from 'three';
import type { Game } from '../core/Game';

/** なんくの家のテレビ。うしわかの悪事がニュースになる */
export class NewsTV {
  canvas = document.createElement('canvas');
  texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private t = 99;
  private last = '';
  private scroll = 0;

  constructor(private game: Game) {
    this.canvas.width = 512;
    this.canvas.height = 288;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  private headline(): [string, string] {
    const g = this.game;
    const k = g.karma;
    const s = k.stats;
    if (k.mode === 'devil') {
      if (s.kills > 0) return ['【速報】謎の女と白い犬 町を恐怖に', `犠牲者 ${s.kills}人　気絶 ${s.faints}人　保健所は警戒を強化`];
      return ['謎の女と白い犬 目撃情報あいつぐ', '住民「目が赤く光っていた」'];
    }
    if (g.heat.level >= 3) return ['保健所 白い犬の捕獲作戦を展開', '住民に外出の自粛を呼びかけ'];
    if (s.kills > 0) return [`【速報】白い犬による死者 ${s.kills}人`, `かまれる被害は ${s.bites}件に`];
    if (s.bites > 0) return [`白い犬にかまれる被害 ${s.bites}件`, '保健所が注意を呼びかけ'];
    if (s.steals > 0) return ['商店街で万引き相次ぐ 犯人は…犬？', `被害 ${s.steals}件　「白くてふわふわだった」`];
    if (s.faints > 0) return ['謎の鳴き声で通行人が気絶', `${s.faints}人が一時意識を失う`];
    if (k.happiness >= 60) return ['ひだまり町 きょうも平和', '白い犬が花を運ぶ姿が話題に'];
    return ['ひだまり町 きょうも平和', 'あすは晴れ　洗濯日和でしょう'];
  }

  update(dt: number) {
    this.t += dt;
    this.scroll += dt * 60;
    if (this.t < 0.25) return;
    this.t = 0;
    const [h, sub] = this.headline();
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const breaking = h.startsWith('【速報】') || this.game.karma.mode === 'devil';
    const grad = c.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1d3557');
    grad.addColorStop(1, '#0b1626');
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 6; i++) c.fillRect(30 + i * 80, 40, 50, 110);
    c.fillStyle = breaking ? '#d62828' : '#2a9d8f';
    c.fillRect(0, 168, W, 46);
    c.fillStyle = '#ffffff';
    c.font = 'bold 26px "M PLUS Rounded 1c", sans-serif';
    c.textBaseline = 'middle';
    let size = 26;
    while (c.measureText(h).width > W - 24 && size > 14) {
      size -= 2;
      c.font = `bold ${size}px "M PLUS Rounded 1c", sans-serif`;
    }
    c.fillText(h, 12, 191);
    c.fillStyle = '#f1faee';
    c.fillRect(0, 214, W, 34);
    c.fillStyle = '#1d3557';
    c.font = 'bold 18px "M PLUS Rounded 1c", sans-serif';
    const tw = c.measureText(sub).width + 80;
    const x = W - (this.scroll % (tw + W));
    c.fillText(sub, x, 231);
    c.fillStyle = breaking ? '#d62828' : '#e9c46a';
    c.fillRect(10, 12, 128, 30);
    c.fillStyle = '#ffffff';
    c.font = 'bold 18px "M PLUS Rounded 1c", sans-serif';
    c.fillText(breaking ? 'ニュース速報' : 'ひだまりTV', 18, 28);
    c.fillStyle = '#ffffff';
    c.font = 'bold 16px sans-serif';
    c.fillText(this.game.sky.clockText, W - 64, 28);
    this.texture.needsUpdate = true;
    this.last = h;
  }
}
