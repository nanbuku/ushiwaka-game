import * as THREE from 'three';
import { Effects } from '../fx/Effects';
import { ItemSystem } from '../gameplay/Items';
import { Karma } from '../gameplay/Karma';
import { Nanku } from '../gameplay/Nanku';
import { NPCManager } from '../npc/NPCManager';
import { CameraRig } from '../player/CameraRig';
import { Ushiwaka } from '../player/Ushiwaka';
import { Dialogue } from '../ui/Dialogue';
import { HUD } from '../ui/HUD';
import { SkySystem } from '../world/Sky';
import { World } from '../world/World';
import { AudioSys } from './Audio';
import { EventBus } from './Events';
import { Input } from './Input';
import { Physics } from './Physics';

const PROLOGUE = [
  'なんく、25歳。仕事も人間関係も、うまくいかない毎日。',
  '話し相手は、子どものころからずっと一緒の犬のぬいぐるみ「うしわか」だけ。',
  'ごはんの時も、寝る時も、勉強する時も。お風呂以外は、いつも一緒だった。',
  '「うしわかが、本当の友達だったらいいのに」',
  'その夜、なんくの行きすぎた愛情は、ついに奇跡を起こした。',
  'うしわかに、命が吹き込まれたのだ――。',
];
const FIRST_TALK = [
  'う、うしわか…？ 動いてる…！？',
  '…夢じゃ、ないよね？',
  'ねえ、うしわか。私の…友達になってくれる？',
];

/** ゲーム全体のまとめ役（初期化・メインループ） */
export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  physics = new Physics();
  input: Input;
  audio = new AudioSys();
  events = new EventBus();
  karma = new Karma(this);
  sky!: SkySystem;
  world!: World;
  fx!: Effects;
  items!: ItemSystem;
  player!: Ushiwaka;
  camRig!: CameraRig;
  npcs!: NPCManager;
  nanku!: Nanku;
  hud: HUD;
  dialogue!: Dialogue;
  paused = true;
  started = false;
  frame = 0;
  testMode = new URLSearchParams(location.search).has('test');
  private lastT = performance.now();
  private saveT = 0;
  private downT = -1;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 2000);
    this.input = new Input(this.renderer.domElement);
    this.hud = new HUD(this);
    window.addEventListener('resize', () => this.onResize());
  }

  async init() {
    this.hud.setLoading('街をつくっています…');
    await new Promise((r) => setTimeout(r, 30));
    await this.physics.init();
    this.sky = new SkySystem(this.scene);
    this.fx = new Effects(this);
    this.items = new ItemSystem(this);
    this.world = new World(this);
    this.items.recording = true;
    this.world.build();
    this.items.recording = false;
    this.player = new Ushiwaka(this);
    this.camRig = new CameraRig(this);
    this.nanku = new Nanku(this);
    this.npcs = new NPCManager(this);
    this.dialogue = new Dialogue(this, document.body);
    this.hud.buildMap();
    this.player.teleport(this.world.spawn, this.world.spawnYaw);
    this.camRig.snapBehind(this.world.spawnYaw);

    this.input.onLockChange = (locked) => {
      if (!this.started || this.karma.ended && this.paused) return;
      if (!locked && !this.input.forceLocked) {
        this.paused = true;
        this.hud.showPause(true, () => this.input.lock());
      } else if (locked) {
        this.paused = false;
        this.hud.showPause(false);
      }
    };

    // 最初の数フレームで影やシェーダーを準備
    this.sky.update(0, this.player.pos, this.camera.position);
    this.camRig.update(0.016);
    this.renderer.compile(this.scene, this.camera);

    if (this.testMode) {
      this.input.forceLocked = true;
      this.start(true, true);
    } else {
      this.hud.showTitle(Karma.hasSave(), (fresh) => this.start(fresh));
    }
    this.lastT = performance.now();
    this.renderer.setAnimationLoop(() => this.loop());
  }

  private start(fresh: boolean, skipStory = false) {
    this.audio.unlock();
    if (fresh) Karma.clearSave();
    else this.karma.load();
    this.started = true;
    this.paused = false;
    this.hud.hideOverlay();
    this.hud.setGameUIVisible(true);
    if (!this.testMode) this.input.lock();
    if (fresh && !skipStory) {
      this.dialogue.show('', PROLOGUE, false, () => {
        this.dialogue.show('なんく', FIRST_TALK, false, () => {
          this.hud.toast('なんくを笑顔にしよう！ 街で見つけた物をくわえて（E）届けると幸福度が上がる', 'good', 8);
          this.hud.toast('…でも、うしわかは何をしてもいい。噛みついても、盗んでも。', 'evil', 8);
        });
      });
    }
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  get inputLocked() {
    return this.dialogue.active || this.paused || this.player.dead;
  }

  /** うしわかが倒れた */
  onPlayerDown() {
    this.downT = 0;
    this.hud.toast('うしわかは、ただのぬいぐるみに戻ってしまった…', 'bad', 4);
  }

  respawnAtHome(revived: boolean) {
    this.player.revive();
    const w = this.world;
    this.player.teleport(w.spawn, w.spawnYaw);
    this.camRig.snapBehind(w.spawnYaw);
    if (revived) {
      if (this.karma.mode === 'normal') this.karma.happiness = Math.max(0, this.karma.happiness - 5);
      this.nanku.reviveTalk();
    }
  }

  private loop() {
    const now = performance.now();
    const dt = Math.min((now - this.lastT) / 1000, 1 / 20);
    this.lastT = now;
    this.frame++;
    if (!this.paused && this.started) {
      this.dialogue.update(dt);
      this.player.update(dt);
      this.npcs.update(dt);
      this.nanku.update(dt);
      this.items.update(dt);
      this.world.update(dt);
      this.physics.step(dt);
      this.fx.update(dt);
      this.sky.update(dt, this.player.pos, this.camera.position);
      this.saveT += dt;
      if (this.saveT > 30) {
        this.saveT = 0;
        this.karma.save();
      }
      if (this.downT >= 0) {
        this.downT += dt;
        if (this.downT > 2.2) this.hud.fade(true);
        if (this.downT > 3.2) {
          this.downT = -1;
          this.respawnAtHome(true);
          this.hud.fade(false);
        }
      }
    } else if (!this.started) {
      // タイトル画面ではゆっくりカメラを回す
      this.camRig.yaw += dt * 0.08;
      this.sky.update(dt * 0.2, this.player.pos, this.camera.position);
      this.world.update(dt);
    }
    this.camRig.update(dt);
    this.audio.setListener(this.camera.position, this.camRig.yaw);
    this.hud.update(dt);
    this.input.endFrame();
    this.renderer.render(this.scene, this.camera);
  }
}
