import * as THREE from 'three';
import { Effects } from '../fx/Effects';
import { Capture } from '../gameplay/Capture';
import { Heat } from '../gameplay/Heat';
import { NewsTV } from '../gameplay/News';
import { Requests } from '../gameplay/Requests';
import { ItemSystem } from '../gameplay/Items';
import { Karma } from '../gameplay/Karma';
import { Nanku } from '../gameplay/Nanku';
import { NPCManager } from '../npc/NPCManager';
import { CameraRig } from '../player/CameraRig';
import { Ushiwaka } from '../player/Ushiwaka';
import { Traffic } from '../vehicles/Traffic';
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
  heat = new Heat(this);
  capture = new Capture(this);
  requests = new Requests(this);
  news = new NewsTV(this);
  sky!: SkySystem;
  world!: World;
  fx!: Effects;
  items!: ItemSystem;
  player!: Ushiwaka;
  camRig!: CameraRig;
  npcs!: NPCManager;
  traffic!: Traffic;
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
    this.traffic = new Traffic(this);
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
    this.audio.startMusic();
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
    return this.dialogue.active || this.paused || this.player.dead || this.capture.active;
  }

  /** うしわかが倒れた */
  onPlayerDown() {
    this.downT = 0;
    this.hud.toast('うしわかは、ただのぬいぐるみに戻ってしまった…', 'bad', 4);
  }

  respawnAtHome(revived: boolean) {
    if (this.player.driving) this.player.exitVehicle();
    this.player.revive();
    this.heat.reset();
    this.npcs.dismissCatchers();
    const w = this.world;
    this.player.teleport(w.spawn, w.spawnYaw);
    this.camRig.snapBehind(w.spawnYaw);
    if (revived) {
      if (this.karma.mode === 'normal') this.karma.happiness = Math.max(0, this.karma.happiness - 5);
      this.nanku.reviveTalk();
    }
  }

  /** 爆発（爆弾） */
  explode(pos: THREE.Vector3, byPlayer: boolean) {
    const gy = this.world.groundHeight(pos.x, pos.z);
    this.fx.explosion(pos, gy);
    this.audio.play('boom', pos, 1);
    this.camRig.addShake(Math.max(0, 1.8 - this.camera.position.distanceTo(pos) / 22));
    let kills = 0;
    let faints = 0;
    for (const n of this.npcs.list) {
      const dx = n.pos.x - pos.x;
      const dz = n.pos.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 8.5) continue;
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      if (d < 5) {
        if (n.alive) kills++;
        n.fling(dir.multiplyScalar(14 - d * 2).add(new THREE.Vector3(0, 10 - d, 0)));
      } else if (n.conscious) {
        n.faint();
        faints++;
      }
    }
    this.npcs.panicAround(pos, 45);
    for (const v of this.traffic.list) {
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z);
      if (d > 7.5) continue;
      if (v === this.player.driving) this.player.exitVehicle();
      const dir = v.pos.clone().sub(pos).setY(0).normalize();
      v.blast(dir.multiplyScalar(10 - d).add(new THREE.Vector3(0, 12 - d, 0)));
    }
    const dp = this.player.pos.distanceTo(pos);
    if (dp < 5.5) {
      this.player.hurt(75 - dp * 12, pos);
      this.player.vel.add(this.player.pos.clone().sub(pos).setY(0).normalize().multiplyScalar(9).setY(7));
    }
    for (const it of this.items.list) {
      if (!it.body) continue;
      const d = it.obj.position.distanceTo(pos);
      if (d < 7) {
        const dir = it.obj.position.clone().sub(pos).normalize();
        it.body.applyImpulse({ x: dir.x * 0.4, y: 0.6, z: dir.z * 0.4 }, true);
      }
    }
    if (this.nanku.pos.distanceTo(pos) < 10) this.hud.popText(this.nanku.headPos(), this.karma.mode === 'devil' ? 'たーまやー！' : 'きゃあっ！', '#ff4d6d', 26);
    if (byPlayer) {
      this.karma.crime('bomb', pos);
      if (kills) this.karma.crime('kill', pos, '', kills, 'bomb');
      if (faints) this.karma.crime('faint', pos, `${faints}人`, faints);
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
      this.traffic.update(dt);
      this.heat.update(dt);
      this.capture.update(dt);
      this.nanku.update(dt);
      this.news.update(dt);
      this.items.update(dt);
      this.world.update(dt);
      this.physics.step(dt);
      this.fx.update(dt);
      this.sky.update(dt, this.player.pos, this.camera.position);
      if (this.input.pressed('KeyN')) {
        const on = this.audio.toggleMusic();
        this.hud.toast(on ? '音楽: ON' : '音楽: OFF', 'info', 1.5);
      }
      this.audio.musicMode = this.karma.mode;
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
