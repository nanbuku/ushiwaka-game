import * as THREE from 'three';
import type { Game } from '../core/Game';
import { rand } from '../core/Rng';
import type { HumanLook } from '../npc/Human';
import type { NPC } from '../npc/NPC';
import { Vehicle } from '../vehicles/Vehicle';
import type { Destructible } from '../world/Destruction';
import { DISTRICT_CENTER, type Target } from './Guide';
import { Kaiju } from './Kaiju';

type What = 'drain' | 'cage' | 'engine';
type BossId = 'junkTank' | 'tetsumen' | 'doberman' | 'kaiju';
type Step =
  | { k: 'talk'; who: string; lines: string[]; devil?: string[] }
  | { k: 'goto'; label: string; at: (g: Game) => THREE.Vector3; r: number }
  | { k: 'destroy'; label: string; what: What; spots: (g: Game) => THREE.Vector3[]; guards: number }
  | { k: 'escape'; label: string }
  | { k: 'defend'; label: string; secs: number }
  | { k: 'boss'; label: string; boss: BossId }
  | { k: 'do'; run: (g: Game, s: Story) => void };

interface Goal {
  o: Destructible;
  pos: THREE.Vector3;
  mesh: THREE.Group;
  guards: NPC[];
  waves: number;
}

const WHAT_NAME: Record<What, string> = { drain: 'ドレインライト', cage: 'おり', engine: 'グレイエンジン' };
const SAVE_KEY = 'ushiwaka-story-v1';

const tower = (g: Game) => g.world.landmarks.tower ?? new THREE.Vector3(200, 0, 0);
const factory = (g: Game) => g.world.landmarks.factory ?? new THREE.Vector3(-200, 0, 200);
/** 地区の中心に近い歩道の上 */
const navSpot = (g: Game, d: keyof typeof DISTRICT_CENTER, ox = 0, oz = 0) => {
  const [x, z] = DISTRICT_CENTER[d];
  const n = g.world.nav.nearest(x + ox, z + oz);
  return new THREE.Vector3(n.x, n.y, n.z);
};

const CHAPTERS: { title: string; steps: Step[] }[] = [
  {
    title: '第1章　灰色の帰り道',
    steps: [
      { k: 'talk', who: 'なんく', lines: ['ただいま……。', '（なんくの体から、うっすらと灰色のモヤが立ちのぼっている）', '会社にいるとね、心から色が抜けていくみたいなの。タワーの光を浴びると、なんにも感じなくなって……。'], devil: ['ただいま。……ふふ、今日も会社の連中、灰色の顔してたわ。', 'あのタワーの光、なんだか気に入らないのよね。うしわか、ちょっと見てきて。'] },
      { k: 'talk', who: '', lines: ['うしわかは決めた。あの光の正体を確かめに行こう。'] },
      { k: 'goto', label: 'なんくの会社〈グレイハートタワー〉へ行く', at: (g) => tower(g), r: 16 },
      { k: 'talk', who: '', lines: ['タワーの前に、灰色に光る装置〈ドレインライト〉がある。人の心の色を吸い取っているらしい。', '黒いスーツの男たちが見張っている！'] },
      { k: 'destroy', label: 'ドレインライトを壊す（噛みつき・武器・体当たり）', what: 'drain', spots: (g) => [tower(g).clone().add(new THREE.Vector3(0, 0, 4))], guards: 3 },
      { k: 'talk', who: '', lines: ['パキーン！ ドレインライトが砕け、灰色の光が消えた。', 'グレイハート社……。なんくがつらそうなのは、この会社のせいだったんだ。'] },
      { k: 'do', run: (g) => g.story.reward('想いのかけら（なんくの心が少し軽くなった）', 8) },
    ],
  },
  {
    title: '第2章　白い犬を捕まえろ',
    steps: [
      { k: 'talk', who: 'ニュース', lines: ['臨時ニュースです。ひだまり町で、凶暴な白い犬が暴れているとの情報が入りました。', 'グレイハート社の協力のもと、保健所と警察が捕獲に乗り出しています。'] },
      { k: 'do', run: (g) => (g.heat.value = Math.max(g.heat.value, 3.3)) },
      { k: 'escape', label: '追っ手をふりきる（遠くへ逃げる・Z で死んだふり）' },
      { k: 'talk', who: '', lines: ['なんくの家の前に、黒い車が止まった。', 'グレイハート社の黒服たちが、なんくの家に向かっている！'] },
      { k: 'goto', label: 'なんくの家へ急いで戻る', at: (g) => g.world.spawn.clone(), r: 22 },
      { k: 'defend', label: 'なんくの家を守る（黒服を倒す）', secs: 60 },
      { k: 'talk', who: 'なんく', lines: ['うしわか……さっき外で、すごい音がしてたけど……。', 'あれ？ なんだか毛がふくらんで、ベストみたいにふかふかしてる。'], devil: ['外がうるさかったわね。……まさか、私を守ってくれたの？', 'ふふ。毛がふくらんで、まるで鎧ね。'] },
      { k: 'do', run: (g) => {
        g.player.maxArmor = 150;
        g.player.armor = 150;
        g.story.reward('もふもふベストが強くなった（防具 150）', 6);
      } },
    ],
  },
  {
    title: '第3章　くまきち、目覚める',
    steps: [
      { k: 'talk', who: '', lines: ['黒服の襲撃のショックで、なんくは寝こんでしまった。', 'なんくの涙が、棚の上のくまのぬいぐるみに、ぽたりと落ちる――。'] },
      { k: 'talk', who: 'くまきち', lines: ['……ふわぁ。おい、そこの白いの。オレはくまきち。なんくの涙で目が覚めちまった。', '街には、まだドレインライトが4つある。それに、グレイハートに捕まった仲間のぬいぐるみたちもいる。', 'オレがおまえの背中で道案内してやる。行くぞ！'] },
      { k: 'do', run: (g) => g.story.attachKuma() },
      { k: 'destroy', label: '街のドレインライトを壊す', what: 'drain', spots: (g) => [navSpot(g, 'park', 10, 10), navSpot(g, 'downtown', -10, -5), navSpot(g, 'civic', 15, -10), navSpot(g, 'amusement', -15, 15)], guards: 2 },
      { k: 'destroy', label: '捕まったぬいぐるみを助ける（おりを壊す）', what: 'cage', spots: (g) => [navSpot(g, 'countryField', 5, 5), navSpot(g, 'countryHill', -5, 10), navSpot(g, 'city', -20, 20)], guards: 1 },
      { k: 'talk', who: 'くまきち', lines: ['助けた仲間が、拳銃とマシンガンの使い方を教えてくれたぜ。', '……ぬいぐるみが銃って、どういう世界だよ。'] },
      { k: 'do', run: (g) => {
        g.weapons.give('pistol', true);
        g.weapons.give('smg', true);
        g.story.reward('拳銃（4）とマシンガン（5）を手に入れた', 8);
      } },
    ],
  },
  {
    title: '第4章　ネジマキ博士の工場',
    steps: [
      { k: 'talk', who: 'くまきち', lines: ['河川敷の工場、あれはただの工場じゃない。Dr.ネジマキの兵器工場だ。', '灰色の想いで動く〈グレイエンジン〉を3つ壊せば、工場は止まる。頑丈だから、爆弾やミサイルを使え。'] },
      { k: 'goto', label: '河川敷の工場へ行く', at: (g) => factory(g), r: 22 },
      { k: 'destroy', label: 'グレイエンジンを壊す（爆弾・ミサイルが効く）', what: 'engine', spots: (g) => [factory(g).clone().add(new THREE.Vector3(-14, 0, 2)), factory(g).clone().add(new THREE.Vector3(0, 0, -2)), factory(g).clone().add(new THREE.Vector3(14, 0, 2))], guards: 2 },
      { k: 'talk', who: 'Dr.ネジマキ', lines: ['ギギギ……よくもワシのエンジンを！', '出でよ、ガラクタ戦車！ その白い犬をスクラップにしてしまえ！'] },
      { k: 'boss', label: 'ボス：ガラクタ戦車を倒す', boss: 'junkTank' },
      { k: 'talk', who: 'くまきち', lines: ['やったな！ 工場の奥にある戦車は、もうおまえのもんだ。乗っていけ（F）！', 'それと、ネジマキの追尾ミサイルもいただいたぜ。'] },
      { k: 'do', run: (g) => {
        g.weapons.give('missile', true);
        g.story.reward('追尾ミサイル（7）を手に入れた', 8);
      } },
    ],
  },
  {
    title: '第5章　グレイハートタワー',
    steps: [
      { k: 'talk', who: 'くまきち', lines: ['いよいよ本丸だ。グレイハートタワーに乗りこむぞ。', '人事部長の鉄面と、警備部長のブラックドーベルが待ちかまえてる。'] },
      { k: 'goto', label: 'グレイハートタワーへ行く', at: (g) => tower(g), r: 20 },
      { k: 'talk', who: '鉄面 剛', lines: ['ここは関係者以外、立入禁止だ。', '感情など、仕事のじゃまでしかない。おまえも灰色に染めてやる！'] },
      { k: 'boss', label: 'ボス：人事部長 鉄面 剛を倒す', boss: 'tetsumen' },
      { k: 'talk', who: 'ブラックドーベル', lines: ['犬一匹に、ここまでやられるとはな。', '部隊、展開！ 白い犬を制圧しろ！'] },
      { k: 'boss', label: 'ボス：警備部長 ブラックドーベルを倒す', boss: 'doberman' },
      { k: 'talk', who: '灰谷 冬至', lines: ['……来たか、白い犬。', '子どものころ、大事にしていたぬいぐるみを親に捨てられた。泣いても、だれも拾ってはくれなかった。', '心があるから、人は傷つく。だから私は、この街から心をなくす。', '見せてやろう。捨てられた想いが、どれほど大きくなるかを――！'] },
      { k: 'do', run: (g) => {
        g.player.maxHp += 50;
        g.player.hp = g.player.maxHp;
      } },
    ],
  },
  {
    title: '終章　しろいいぬと灰色の怪獣',
    steps: [
      { k: 'talk', who: '', lines: ['タワーのかげから、巨大な灰色のぬいぐるみが立ち上がった――怪獣〈グレイ〉だ！', 'グレイは地ひびきを立てて、なんくの家のほうへ歩きはじめた！'] },
      { k: 'talk', who: 'くまきち', lines: ['でかすぎるだろ……！ ミサイル、戦車、核爆弾、使えるものは全部使え！', 'あいつの足元は危ないぞ。踏みつぶされるな！'] },
      { k: 'boss', label: 'ボス：灰色の怪獣〈グレイ〉を止める', boss: 'kaiju' },
      { k: 'do', run: (g) => g.story.ending() },
    ],
  },
];

/** くまのぬいぐるみ（くまきち・助けた仲間） */
function makePlush(color: string, s = 1) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 1 });
  const pale = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.45), roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1a1412', roughness: 0.4 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(new THREE.SphereGeometry(1, 14, 10).scale(0.11, 0.12, 0.1), m, 0, 0.11, 0);
  add(new THREE.SphereGeometry(0.095, 14, 10), m, 0, 0.29, 0.01);
  add(new THREE.SphereGeometry(1, 10, 8).scale(0.045, 0.035, 0.03), pale, 0, 0.27, 0.09);
  add(new THREE.SphereGeometry(0.012, 8, 6), dark, 0, 0.285, 0.12);
  for (const sx of [-1, 1]) {
    add(new THREE.SphereGeometry(0.034, 10, 8), m, sx * 0.075, 0.37, 0);
    add(new THREE.SphereGeometry(0.011, 8, 6), dark, sx * 0.035, 0.31, 0.085);
    add(new THREE.SphereGeometry(1, 10, 8).scale(0.035, 0.05, 0.035), m, sx * 0.1, 0.12, 0.03);
  }
  g.scale.setScalar(s);
  return g;
}

/**
 * メインストーリー（docs/STORY.md）。章ごとに「話す・行く・壊す・逃げる・守る・ボス」の目的を順に進める。
 * 目的地は Guide（矢印・地図）で案内し、進みぐあいは HUD のストーリー欄に出す。
 */
export class Story {
  ch = 0;
  step = -1;
  active = false;
  done = false;
  kaiju: Kaiju | null = null;
  private wait = 45;
  private goals: Goal[] = [];
  private timer = 0;
  private waveT = 0;
  private bossNpcs: NPC[] = [];
  private bossTank: Vehicle | null = null;
  private bossDown = false;
  private wasDead = false;
  private kuma: THREE.Group | null = null;
  private kumaT = 20;
  private spin: THREE.Object3D[] = [];
  private freed: { mesh: THREE.Group; t: number; vy: number }[] = [];

  constructor(private game: Game) {}

  init() {
    this.game.destruction.onDestroyed = (o) => this.onDestroyed(o);
  }

  get cur(): Step | null {
    return this.active ? (CHAPTERS[this.ch]?.steps[this.step] ?? null) : null;
  }

  // ---------- セーブ ----------
  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ch: this.ch }));
    } catch {
      /* noop */
    }
  }

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
      if (d && typeof d.ch === 'number') this.ch = Math.min(d.ch, CHAPTERS.length);
    } catch {
      /* noop */
    }
    this.done = this.ch >= CHAPTERS.length;
    this.wait = 12;
    if (this.ch >= 3) this.attachKuma();
  }

  reset() {
    this.ch = 0;
    this.done = false;
    this.wait = 45;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* noop */
    }
  }

  // ---------- 進行 ----------
  update(dt: number) {
    const g = this.game;
    this.updateFx(dt);
    if (!this.active) {
      if (this.done) return;
      this.wait -= dt;
      if (this.wait <= 0 && g.heat.level === 0 && !g.dialogue.active && !g.capture.active && !g.player.dead) this.beginChapter();
      return;
    }
    const s = this.cur;
    if (!s) return;
    // 倒れたら、戦いの目的はやり直し（壊した物はそのまま）
    if (g.player.dead) this.wasDead = true;
    else if (this.wasDead) {
      this.wasDead = false;
      if (s.k === 'defend') this.timer = s.secs;
      if (s.k === 'destroy') for (const gl of this.goals) gl.waves = 0;
      if (s.k === 'boss') {
        this.clearBoss();
        this.spawnBoss(s.boss);
      }
    }
    const p = g.player.pos;
    switch (s.k) {
      case 'goto':
        if (s.at(g).distanceTo(p) < s.r) this.next();
        break;
      case 'destroy': {
        for (const gl of this.goals) {
          if (!gl.o.alive || gl.waves >= 2 || gl.pos.distanceTo(p) > 75) continue;
          if (gl.guards.some((n) => n.alive && g.npcs.list.includes(n))) continue;
          gl.waves++;
          for (let i = 0; i < s.guards; i++) {
            const a = rand.range(0, Math.PI * 2);
            gl.guards.push(this.agent(gl.pos.x + Math.cos(a) * rand.range(4, 7), gl.pos.z + Math.sin(a) * rand.range(4, 7)));
          }
        }
        if (this.goals.every((gl) => !gl.o.alive)) this.next();
        break;
      }
      case 'escape':
        if (g.heat.level === 0) this.next();
        break;
      case 'defend': {
        this.timer -= dt;
        this.waveT -= dt;
        const home = g.world.spawn;
        if (this.waveT <= 0 && this.timer > 10) {
          this.waveT = 16;
          for (let i = 0; i < 4; i++) {
            const pick = g.world.nav.randomEdgeNear(home.x, home.z, 30, 50, rand);
            if (pick) {
              const [a, b, t] = pick;
              this.agent(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
            }
          }
          g.hud.toast('黒服が来た！', 'bad', 2);
        }
        if (this.timer <= 0) {
          // 残った黒服は逃げていく
          for (const n of g.npcs.list) {
            if (n.kind !== 'agent' || !n.forceArmed || !n.alive) continue;
            n.forceArmed = false;
            n.state = 'walk';
            n.scare(g.player.pos, 0.2);
          }
          this.next();
        }
        break;
      }
      case 'boss':
        this.updateBoss(s.boss, dt);
        break;
      default:
        break;
    }
    // くまきちのひとこと
    if (this.kuma && !g.dialogue.active) {
      this.kumaT -= dt;
      if (this.kumaT <= 0) {
        this.kumaT = rand.range(28, 45);
        const lines =
          s.k === 'boss'
            ? ['動き回れ！ 止まると蜂の巣だぞ', 'ミサイル（7）ならロックオンできる！', 'シールド（X）を忘れるなよ']
            : s.k === 'destroy'
              ? ['噛みついても壊せるけど、銃や爆弾が早いぞ', '目的地は黄色い印だ。地図（M）も見ろ']
              : s.k === 'defend'
                ? ['家に近づく黒服を片っぱしから倒せ！']
                : ['なんく、だいじょうぶかな……', 'おまえの背中、ふかふかで寝ちまいそうだ'];
        g.hud.popText(g.player.headWorld().add(new THREE.Vector3(0, 0.5, 0)), 'くまきち「' + rand.pick(lines) + '」', '#e2b98c', 18);
      }
    }
  }

  private beginChapter() {
    this.active = true;
    this.step = -1;
    this.game.hud.toast(`メインストーリー　${CHAPTERS[this.ch].title}`, 'evil', 5);
    this.game.audio.play('evil', undefined, 0.4);
    this.next();
  }

  private next() {
    this.clearStep();
    this.step++;
    const steps = CHAPTERS[this.ch].steps;
    if (this.step >= steps.length) {
      this.active = false;
      this.ch++;
      this.save();
      this.done = this.ch >= CHAPTERS.length;
      this.wait = 25;
      if (!this.done) this.game.hud.toast('次の章は、少しあとで始まる（追っ手がいないときに）', 'info', 4);
      return;
    }
    const s = steps[this.step];
    const g = this.game;
    switch (s.k) {
      case 'talk': {
        const devil = g.karma.mode === 'devil';
        g.dialogue.show(s.who, devil && s.devil ? s.devil : s.lines, devil, () => this.next());
        break;
      }
      case 'do':
        s.run(g, this);
        if (this.cur === s) this.next();
        break;
      case 'destroy':
        for (const pos of s.spots(g)) this.makeGoal(s.what, pos);
        break;
      case 'defend':
        this.timer = s.secs;
        this.waveT = 0;
        break;
      case 'boss':
        this.spawnBoss(s.boss);
        break;
      default:
        break;
    }
  }

  private clearStep() {
    this.goals = [];
    this.clearBoss();
  }

  /** 章のごほうび（幸福度か悪魔度が上がる） */
  reward(text: string, pts: number) {
    const k = this.game.karma;
    if (k.mode === 'devil') k.devil = Math.min(100, k.devil + pts);
    else k.happiness = Math.min(100, k.happiness + pts);
    this.game.hud.toast(`${text}　${k.mode === 'devil' ? '悪魔度' : '幸福度'} +${pts}`, 'good', 5);
    this.game.audio.play('happy', this.game.player.pos, 0.8);
    this.game.karma.save();
  }

  attachKuma() {
    if (this.kuma) return;
    this.kuma = makePlush('#a87a50', 0.9);
    this.kuma.rotation.y = 0;
    this.game.player.model.addRider(this.kuma);
  }

  /** 終章のあと：ルートでエンディングが変わる */
  ending() {
    const g = this.game;
    const devil = g.karma.mode === 'devil';
    if (devil) {
      g.dialogue.show('なんく', ['ふふ……よくやったわ、うしわか。', '灰色の想いは、ぜんぶ私たちのもの。'], true, () =>
        g.dialogue.show('', ['なんくは、グレイハート社の最終兵器〈ハート核爆弾〉を手に入れた。', 'ふたりは、この街の新しい支配者になった――。'], true, () => g.hud.showEnding('devil')),
      );
    } else {
      g.dialogue.show('なんく', ['うしわか、がんばれーっ！！', '（なんくの声が、うしわかの体に最後の力をくれた）'], false, () =>
        g.dialogue.show('', ['グレイの体から灰色が抜けていき、小さな古いぬいぐるみに戻った。', '灰谷は、そのぬいぐるみを泣きながら抱きしめた。', '街に、心の色が戻ってくる。なんくは会社を辞め、新しい一歩を踏み出した。'], false, () => g.hud.showEnding('happy')),
      );
    }
  }

  // ---------- 壊す目標 ----------
  private makeGoal(what: What, pos: THREE.Vector3) {
    const g = this.game;
    const d = g.destruction;
    const y = g.world.groundHeight(pos.x, pos.z);
    const mesh = this.model(what);
    mesh.position.set(pos.x, y, pos.z);
    g.scene.add(mesh);
    const h = what === 'drain' ? 3.2 : what === 'engine' ? 2.6 : 1.3;
    const hw = what === 'engine' ? 1.4 : what === 'cage' ? 0.65 : 0.45;
    d.begin('prop', pos.x, y, pos.z, hw * 2, hw * 2, h, what === 'engine' ? '#4a4f57' : '#5a5a66');
    d.addExtra(mesh);
    d.addCollider(g.physics.staticBox(pos.x, y + h / 2, pos.z, hw, h / 2, hw));
    const o = d.end();
    if (!o) return;
    o.hp = what === 'engine' ? 650 : what === 'cage' ? 90 : 240;
    o.tag = what;
    this.goals.push({ o, pos: new THREE.Vector3(pos.x, y, pos.z), mesh, guards: [], waves: 0 });
  }

  private model(what: What) {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: '#34343c', roughness: 0.5, metalness: 0.6 });
    const glow = new THREE.MeshBasicMaterial({ color: '#c9bfff' });
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    if (what === 'drain') {
      mk(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 14), dark, 0, 0.15, 0);
      mk(new THREE.CylinderGeometry(0.12, 0.14, 2.8, 10), dark, 0, 1.6, 0);
      mk(new THREE.BoxGeometry(0.9, 0.45, 0.9), dark, 0, 3.0, 0);
      mk(new THREE.SphereGeometry(0.3, 14, 10), glow, 0, 2.72, 0);
      const beam = mk(new THREE.ConeGeometry(2.2, 2.6, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#9a8fc0', transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), 0, 1.35, 0);
      beam.castShadow = false;
      const ring = mk(new THREE.TorusGeometry(0.62, 0.04, 6, 24), glow, 0, 3.0, 0);
      ring.rotation.x = Math.PI / 2;
      this.spin.push(ring);
    } else if (what === 'cage') {
      const bar = new THREE.MeshStandardMaterial({ color: '#5c5f66', metalness: 0.7, roughness: 0.35 });
      mk(new THREE.BoxGeometry(1.3, 0.08, 1.3), bar, 0, 0.04, 0);
      mk(new THREE.BoxGeometry(1.3, 0.08, 1.3), bar, 0, 1.26, 0);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        if (i > 0 && i < 3 && j > 0 && j < 3) continue;
        mk(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 6), bar, -0.6 + i * 0.4, 0.65, -0.6 + j * 0.4);
      }
      const pl = makePlush(rand.pick(['#f4a3b8', '#f2d388', '#9fc8f0', '#c3b1e1']), 1.6);
      g.add(pl);
    } else {
      mk(new THREE.BoxGeometry(2.8, 2.2, 2.8), dark, 0, 1.1, 0);
      mk(new THREE.SphereGeometry(0.7, 16, 12), glow, 0, 2.4, 0);
      for (const sx of [-1, 1]) mk(new THREE.CylinderGeometry(0.2, 0.2, 2.6, 10), dark, sx * 1.5, 1.3, 0);
      const ring = mk(new THREE.TorusGeometry(0.95, 0.07, 6, 24), glow, 0, 2.4, 0);
      this.spin.push(ring);
    }
    return g;
  }

  private onDestroyed(o: Destructible) {
    const g = this.game;
    if (!o.tag) return;
    const pos = new THREE.Vector3(o.x, o.y + 1.5, o.z);
    if (o.tag === 'drain') {
      g.audio.play('glass', pos, 1);
      g.hud.popText(pos.clone().setY(pos.y + 2), 'パキーン!', '#c9bfff', 32);
      for (let i = 0; i < 10; i++) g.fx.smoke(pos.clone().add(new THREE.Vector3(rand.range(-1, 1), rand.range(0, 2), rand.range(-1, 1))), false);
    } else if (o.tag === 'cage') {
      const pl = makePlush(rand.pick(['#f4a3b8', '#f2d388', '#9fc8f0', '#c3b1e1']), 1.6);
      pl.position.set(o.x, o.y, o.z);
      g.scene.add(pl);
      this.freed.push({ mesh: pl, t: 0, vy: 6 });
      g.hud.popText(pos.clone().setY(pos.y + 1), 'ありがとう!', '#ffd6e7', 26);
      g.hud.toast('捕まっていたぬいぐるみの仲間を助けた！', 'good', 3);
      g.audio.play('happy', pos, 0.8);
    } else if (o.tag === 'engine') {
      g.explode(pos, false, 1.3);
    }
    const left = this.goals.filter((gl) => gl.o.alive).length;
    if (this.goals.some((gl) => gl.o === o) && left > 0) g.hud.toast(`${WHAT_NAME[o.tag as What]} あと ${left}`, 'info', 2.5);
  }

  /** 噛みつき・バットが怪獣に当たったか */
  biteAt(pos: THREE.Vector3, dmg: number) {
    const k = this.kaiju;
    if (!k || !k.alive || Math.hypot(pos.x - k.pos.x, pos.z - k.pos.z) > 5.5) return false;
    k.damage(dmg);
    this.game.fx.sparks(pos);
    return true;
  }

  /** 弾が怪獣に当たったか */
  onShot(handle: number, dmg: number) {
    const k = this.kaiju;
    if (!k || !k.alive || k.collider.handle !== handle) return false;
    k.damage(dmg * 0.5);
    return true;
  }

  onExplosion(pos: THREE.Vector3, R: number, scale: number, byPlayer: boolean) {
    const k = this.kaiju;
    if (!k || !k.alive || !byPlayer) return;
    if (Math.hypot(pos.x - k.pos.x, pos.z - k.pos.z) - 4.5 < R + 2) k.damage(240 * scale);
  }

  onNuke(pos: THREE.Vector3) {
    const k = this.kaiju;
    if (k && k.alive && Math.hypot(pos.x - k.pos.x, pos.z - k.pos.z) < 170) k.damage(6000);
  }

  // ---------- ボス ----------
  private agent(x: number, z: number, look?: Partial<HumanLook>) {
    const g = this.game;
    const n = g.npcs.create('agent', x, g.world.groundHeight(x, z), z, look);
    n.forceArmed = true;
    n.state = 'armed';
    return n;
  }

  private spawnBoss(id: BossId) {
    const g = this.game;
    this.bossDown = false;
    if (id === 'junkTank') {
      const f = factory(g);
      const v = new Vehicle(g, 'tank', f.x - 20, f.y, f.z - 1, Math.PI / 2);
      v.hp = 800;
      v.model.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (m.material as THREE.MeshStandardMaterial).color) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.color.lerp(new THREE.Color('#8a5a3a'), 0.6);
          m.material = mat;
        }
      });
      g.traffic.list.push(v);
      g.police.addBoss(v);
      this.bossTank = v;
    } else if (id === 'kaiju') {
      const t = tower(g);
      this.kaiju = new Kaiju(g, t.x, t.z - 6, g.world.spawn.clone());
    } else {
      const t = tower(g);
      const look: Partial<HumanLook> =
        id === 'tetsumen'
          ? { top: '#3a3f47', bottom: '#3a3f47', tie: '#b23a48', hair: '#555555', gun: 'rifle' }
          : { top: '#0d0d10', bottom: '#0d0d10', hairStyle: 'cap', hat: '#0d0d10', backpack: '#1b1b1f', gun: 'rifle' };
      const b = this.agent(t.x, t.z - 2, look);
      b.model.root.scale.setScalar(1.3);
      b.height *= 1.3;
      b.radius *= 1.3;
      b.maxHp = b.hp = id === 'tetsumen' ? 1300 : 1900;
      b.bossName = id === 'tetsumen' ? '人事部長 鉄面 剛' : '警備部長 ブラックドーベル';
      this.bossNpcs = [b];
      for (let i = 0; i < 4; i++) this.agent(t.x + rand.range(-12, 12), t.z + rand.range(-4, 8), id === 'doberman' ? { top: '#22252b', bottom: '#1b1d22', hairStyle: 'cap', hat: '#15171b', gun: 'rifle' } : undefined);
    }
  }

  private clearBoss() {
    if (this.kaiju) {
      this.kaiju.dispose();
      this.kaiju = null;
    }
    this.bossTank = null;
    this.bossNpcs = [];
  }

  private updateBoss(id: BossId, dt: number) {
    const g = this.game;
    if (id === 'kaiju') {
      if (!this.kaiju) return;
      this.kaiju.update(dt);
      if (this.kaiju.gone) {
        const k = this.kaiju;
        const pl = makePlush('#8e8b93', 1.4);
        pl.position.copy(k.pos);
        g.scene.add(pl);
        this.next();
      }
      return;
    }
    if (id === 'junkTank') {
      const v = this.bossTank;
      if (!v) return;
      if (v.charred) this.next();
      else if (v.dead && factory(g).distanceTo(g.player.pos) < 90) this.spawnBoss(id);
      return;
    }
    const b = this.bossNpcs[0];
    if (!b) return;
    if (!b.alive) this.next();
    else if (!g.npcs.list.includes(b) && tower(g).distanceTo(g.player.pos) < 90) this.spawnBoss(id);
  }

  // ---------- 見た目 ----------
  private updateFx(dt: number) {
    for (const s of this.spin) s.rotation.z += dt * 1.5;
    for (let i = this.freed.length - 1; i >= 0; i--) {
      const f = this.freed[i];
      f.t += dt;
      f.vy -= 14 * dt;
      f.mesh.position.y += f.vy * dt;
      if (f.vy < 0 && f.mesh.position.y < this.game.world.groundHeight(f.mesh.position.x, f.mesh.position.z)) f.vy = 5;
      f.mesh.rotation.y += dt * 4;
      if (f.t > 4) {
        this.game.scene.remove(f.mesh);
        this.freed.splice(i, 1);
      }
    }
  }

  // ---------- 案内・HUD ----------
  guideTargets(): Target[] {
    const s = this.cur;
    const g = this.game;
    if (!s) return [];
    switch (s.k) {
      case 'goto': {
        const a = s.at(g);
        return [{ x: a.x, y: a.y, z: a.z, label: s.label.replace(/へ.*$/, '') }];
      }
      case 'destroy':
        return this.goals.filter((gl) => gl.o.alive).map((gl) => ({ x: gl.pos.x, y: gl.pos.y + 2, z: gl.pos.z, label: WHAT_NAME[s.what] }));
      case 'defend': {
        const h = g.world.spawn;
        return [{ x: h.x, y: h.y, z: h.z, label: 'なんくの家' }];
      }
      case 'boss': {
        const at = this.kaiju?.pos ?? this.bossTank?.pos ?? this.bossNpcs[0]?.pos;
        return at ? [{ x: at.x, y: at.y + 2, z: at.z, label: 'ボス' }] : [];
      }
      default:
        return [];
    }
  }

  get hud(): { title: string; text: string; boss: { name: string; hp: number; max: number } | null } | null {
    const s = this.cur;
    if (!s || s.k === 'talk' || s.k === 'do') return null;
    let text = s.label;
    if (s.k === 'destroy') text += `　${this.goals.filter((gl) => !gl.o.alive).length} / ${this.goals.length}`;
    if (s.k === 'defend') text += `　のこり ${Math.max(0, Math.ceil(this.timer))} 秒`;
    let boss: { name: string; hp: number; max: number } | null = null;
    if (s.k === 'boss') {
      if (this.kaiju) boss = { name: '灰色の怪獣〈グレイ〉', hp: this.kaiju.hp, max: this.kaiju.maxHp };
      else if (this.bossTank) boss = { name: 'ガラクタ戦車', hp: Math.max(0, this.bossTank.hp), max: 800 };
      else if (this.bossNpcs[0]) boss = { name: this.bossNpcs[0].bossName, hp: Math.max(0, this.bossNpcs[0].hp), max: this.bossNpcs[0].maxHp };
    }
    return { title: CHAPTERS[this.ch].title, text, boss };
  }
}
