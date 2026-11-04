import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G, groups, RAPIER } from '../core/Physics';
import { angleDiff, damp, rand } from '../core/Rng';
import type { StarsHandle } from '../fx/Effects';
import type { ItemId } from '../gameplay/Items';
import type { NavNode } from '../world/Navigation';
import type { HumanKind, HumanMode } from './Human';
import type { HumanLike } from './KenneyHuman';

export type NPCState = 'walk' | 'idle' | 'startle' | 'flee' | 'attack' | 'faint' | 'getup' | 'dead' | 'return' | 'chase';

const FAINT_BASE: Record<HumanKind, number> = { man: 0.3, woman: 0.38, child: 0.5, elderly: 0.72, office: 0.32, clerk: 0.32, catcher: 0.18 };
const HP: Record<HumanKind, number> = { man: 100, woman: 85, child: 55, elderly: 65, office: 95, clerk: 90, catcher: 120 };
const SCREAM: Record<HumanKind, 'scream_m' | 'scream_f' | 'scream_child' | 'scream_old'> = {
  man: 'scream_m',
  woman: 'scream_f',
  child: 'scream_child',
  elderly: 'scream_old',
  office: 'scream_m',
  clerk: 'scream_f',
  catcher: 'scream_m',
};
const OUCH: Record<HumanKind, string[]> = {
  man: ['いってぇ!', 'うわっ!', 'なんだこの犬!'],
  woman: ['きゃあっ!', 'いたっ!', 'やめてー!'],
  child: ['うわーん!', 'いたいよー!', 'ママー!'],
  elderly: ['ひぃっ!', 'あいたた…', 'なにするんじゃ!'],
  office: ['痛っ!?', 'スーツが!', 'ちょっと!'],
  clerk: ['きゃっ!', 'お客様!?', 'いたっ!'],
  catcher: ['いてっ!', 'こいつ!', 'おとなしくしろ!', '暴れるな!'],
};
const DROPS: ItemId[] = ['wallet', 'phone', 'burger', 'onigiri', 'wallet'];

let nextId = 1;

export class NPC {
  id = nextId++;
  model: HumanLike;
  pos = new THREE.Vector3();
  yaw = 0;
  state: NPCState = 'walk';
  stateT = 0;
  hp: number;
  maxHp: number;
  walkSpeed: number;
  runSpeed: number;
  brave: boolean;
  radius: number;
  height: number;
  from: NavNode | null = null;
  to: NavNode | null = null;
  lateral = 0;
  fleeFrom = new THREE.Vector3();
  calm = 0;
  attackCd = 0;
  deadT = 0;
  stars: StarsHandle | null = null;
  private flingVel: THREE.Vector3 | null = null;
  /** 燃えている残り秒数 */
  burning = 0;
  private burnByPlayer = false;
  /** 撒菱でけがをして足が遅い残り秒数 */
  slowT = 0;
  private bleedT = 0;
  private bleedByPlayer = false;
  private screamT = 0;
  private charred = false;
  private spin = 0;
  /** お店の人など、持ち場がある NPC */
  home: { x: number; y: number; z: number; yaw: number } | null = null;
  private body: RAPIER.RigidBody | null;
  private mode: HumanMode = 'walk';
  private speedNow = 0;
  private idleTimer = rand.range(10, 30);
  private kickT = 9;

  constructor(
    private game: Game,
    public kind: HumanKind,
    model: HumanLike,
    x: number,
    y: number,
    z: number,
  ) {
    this.model = model;
    this.maxHp = this.hp = HP[kind];
    this.height = model.look.height;
    this.radius = model.look.child ? 0.17 : 0.23;
    this.walkSpeed = kind === 'elderly' ? rand.range(0.7, 1.0) : kind === 'child' ? rand.range(1.2, 1.7) : rand.range(1.15, 1.5);
    this.runSpeed = kind === 'elderly' ? 2.6 : kind === 'child' ? 4.2 : kind === 'catcher' ? 5.8 : 5.2;
    this.brave = (kind === 'man' || kind === 'office') && rand.chance(0.32);
    this.pos.set(x, y, z);
    const w = game.physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + this.height / 2, z));
    w.createCollider(
      RAPIER.ColliderDesc.capsule(Math.max(0.05, this.height / 2 - this.radius), this.radius).setCollisionGroups(groups(G.NPC, G.PLAYER | G.ITEM | G.VEHICLE | G.DEBRIS)),
      this.body,
    );
    game.scene.add(model.root);
    this.lateral = rand.range(-1, 1);
    this.sync(0);
  }

  get alive() {
    return this.state !== 'dead';
  }
  get conscious() {
    return this.state !== 'dead' && this.state !== 'faint' && this.state !== 'getup';
  }

  setPath(a: NavNode, b: NavNode) {
    this.from = a;
    this.to = b;
  }

  update(dt: number) {
    const g = this.game;
    this.stateT -= dt;
    this.attackCd -= dt;
    this.kickT += dt;
    const dog = g.player.pos;
    const dDog = Math.hypot(dog.x - this.pos.x, dog.z - this.pos.z);
    let speed = 0;
    if (this.alive) this.statusEffects(dt);
    if (!this.alive && this.state !== 'dead') return;

    if (this.kind === 'catcher' && (this.state === 'walk' || this.state === 'idle') && g.heat.level >= 1) this.state = 'chase';
    switch (this.state) {
      case 'chase': {
        if (g.heat.level < 1) {
          this.state = 'walk';
          break;
        }
        speed = this.runSpeed + g.heat.level * 0.22;
        this.mode = 'run';
        if (dDog < 1.0) {
          speed = 0;
          this.mode = 'panic';
          this.faceTo(dog, dt);
        } else if (dDog < 20 || !this.to) {
          const dx = dog.x - this.pos.x;
          const dz = dog.z - this.pos.z;
          this.moveDir(dx / dDog, dz / dDog, Math.min(dDog - 0.8, speed * dt), dt);
          this.from = null;
          this.to = null;
        } else {
          this.fleeFrom.copy(dog);
          this.walkGraph(dt, speed, false, true);
        }
        if (rand.chance(dt * 0.25)) g.hud.popText(this.headPos(), rand.pick(['待てー!', 'そっちへ行ったぞ!', '捕獲しろ!', 'あの白い犬だ!']), '#9be29b', 20);
        break;
      }
      case 'walk':
        speed = this.walkSpeed;
        this.walkGraph(dt, speed, false);
        this.mode = 'walk';
        this.idleTimer -= dt;
        if (this.idleTimer < 0) {
          this.idleTimer = rand.range(15, 40);
          this.state = 'idle';
          this.stateT = rand.range(2, 6);
        }
        break;
      case 'idle':
        this.mode = 'idle';
        if (this.home) this.yaw += angleDiff(this.yaw, this.home.yaw) * damp(4, dt);
        else if (dDog < 3) this.faceTo(dog, dt);
        if (this.stateT < 0 && !this.home) this.state = 'walk';
        break;
      case 'startle':
        this.mode = 'cower';
        this.faceTo(this.fleeFrom, dt);
        if (this.stateT < 0) {
          this.state = 'flee';
          this.calm = 0;
        }
        break;
      case 'flee': {
        speed = this.runSpeed;
        this.mode = this.kind === 'child' || this.kind === 'elderly' || rand.chance(0.002) ? 'panic' : this.mode === 'panic' ? 'panic' : 'run';
        if (dDog < 12) this.fleeFrom.copy(dog);
        this.walkGraph(dt, speed, true);
        this.calm = dDog > 22 ? this.calm + dt : 0;
        if (this.calm > 5) {
          this.state = this.home ? 'return' : 'walk';
          this.mode = 'walk';
        }
        break;
      }
      case 'return': {
        if (!this.home) {
          this.state = 'walk';
          break;
        }
        speed = this.walkSpeed;
        this.mode = 'walk';
        const dx = this.home.x - this.pos.x;
        const dz = this.home.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.3) {
          this.state = 'idle';
          speed = 0;
        } else {
          this.moveDir(dx / d, dz / d, Math.min(d, speed * dt), dt);
        }
        break;
      }
      case 'attack': {
        this.mode = 'run';
        if (this.stateT < 0 || dDog > 12) {
          this.state = 'flee';
          this.calm = 0;
          break;
        }
        const dx = dog.x - this.pos.x;
        const dz = dog.z - this.pos.z;
        if (dDog > 0.95) {
          speed = this.runSpeed * 0.75;
          this.moveDir(dx / dDog, dz / dDog, speed * dt, dt);
        } else {
          this.mode = 'idle';
          this.faceTo(dog, dt);
          if (this.attackCd < 0) {
            this.attackCd = 1.1;
            this.kickT = 0;
          }
        }
        if (this.kickT > 0.14 && this.kickT < 0.14 + dt * 1.5 && dDog < 1.3) {
          g.player.hurt(9, this.pos);
          g.audio.play('kick', this.pos, 0.9);
          g.hud.popText(this.headPos(), 'えいっ!', '#ffd166', 22);
        }
        break;
      }
      case 'faint':
        this.mode = 'lie';
        if (this.stateT < 0) {
          this.state = 'getup';
          this.stateT = 0.9;
          this.removeStars();
        }
        break;
      case 'getup':
        this.mode = 'idle';
        if (this.stateT < 0) {
          this.state = 'flee';
          this.calm = 0;
          this.fleeFrom.copy(dog);
        }
        break;
      case 'dead':
        this.mode = 'lie';
        this.deadT += dt;
        if (this.flingVel) {
          const v = this.flingVel;
          v.y -= 22 * dt;
          this.pos.addScaledVector(v, dt);
          this.spin += dt * 12;
          this.model.body.rotation.z = this.spin;
          const gy = g.world.groundHeight(this.pos.x, this.pos.z);
          if (this.pos.y <= gy && v.y < 0) {
            this.pos.y = gy;
            this.flingVel = null;
            this.model.body.rotation.z = 0;
            g.fx.bloodPool(this.pos.clone(), this.model.look.child ? 0.7 : 1.0);
            g.fx.bloodSpray(this.pos.clone().setY(gy + 0.3), new THREE.Vector3(v.x, 0, v.z).normalize(), 16, gy);
            g.audio.play('kick', this.pos, 0.8);
          }
        }
        break;
    }
    this.speedNow = speed;
    this.model.kick = this.kickT < 0.35 ? Math.sin((this.kickT / 0.35) * Math.PI) : 0;
    this.sync(dt);
  }

  private faceTo(p: THREE.Vector3, dt: number) {
    const target = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.yaw += angleDiff(this.yaw, target) * damp(8, dt);
  }

  private moveDir(dx: number, dz: number, step: number, dt: number) {
    const k = this.slowT > 0 ? 0.35 : this.burning > 0 ? 1.15 : 1;
    this.pos.x += dx * step * k;
    this.pos.z += dz * step * k;
    this.yaw += angleDiff(this.yaw, Math.atan2(dx, dz)) * damp(10, dt);
  }

  private walkGraph(dt: number, speed: number, flee: boolean, toward = false) {
    const nav = this.game.world.nav;
    if (!this.to || !this.from) {
      const n = nav.nearest(this.pos.x, this.pos.z);
      this.from = n;
      this.to = n;
    }
    const ex = this.to.x - this.from.x;
    const ez = this.to.z - this.from.z;
    const el = Math.hypot(ex, ez) || 1;
    const off = this.lateral * Math.max(0, Math.min(this.to.width, this.from.width) / 2 - 0.45);
    const tx = this.to.x + (-ez / el) * off;
    const tz = this.to.z + (ex / el) * off;
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) {
      const next = this.chooseNext(flee, toward);
      this.from = this.to;
      this.to = next;
      return;
    }
    this.moveDir(dx / d, dz / d, Math.min(d, speed * dt), dt);
  }

  private chooseNext(flee: boolean, toward = false): NavNode {
    const nav = this.game.world.nav;
    const cur = this.to!;
    const options = cur.links.filter((id) => id !== this.from!.id).map((id) => nav.nodes[id]);
    if (!options.length) return this.from!;
    if (toward) {
      let best = options[0];
      let bd = Infinity;
      for (const o of options) {
        const d = Math.hypot(o.x - this.fleeFrom.x, o.z - this.fleeFrom.z) + rand.range(0, 4);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      return best;
    }
    if (flee) {
      let best = options[0];
      let bd = -1;
      for (const o of options) {
        const d = Math.hypot(o.x - this.fleeFrom.x, o.z - this.fleeFrom.z) + rand.range(0, 6);
        if (d > bd) {
          bd = d;
          best = o;
        }
      }
      return best;
    }
    return rand.pick(options);
  }

  private sync(dt: number) {
    const g = this.game;
    if (this.state !== 'dead') this.pos.y = g.world.groundHeight(this.pos.x, this.pos.z);
    this.body?.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.height / 2, z: this.pos.z });
    const r = this.model.root;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    this.model.animate(dt, this.mode, this.speedNow);
    if (this.stars) this.model.headWorld(this.stars.anchor);
  }

  headPos() {
    return this.pos.clone().add(new THREE.Vector3(0, this.height + 0.2, 0));
  }

  /** 噛まれた。戻り値: 'kill' | 'bite' */
  bitten(dmg: number, from: THREE.Vector3): 'kill' | 'bite' | 'corpse' {
    const g = this.game;
    const hitPos = this.pos.clone().add(new THREE.Vector3(0, Math.min(0.5, this.height * 0.3), 0));
    const dir = this.pos.clone().sub(from).setY(0).normalize();
    if (this.state === 'dead') {
      g.fx.bloodSpray(hitPos, dir, 10, this.pos.y);
      return 'corpse';
    }
    this.hp -= dmg;
    g.fx.bloodSpray(hitPos, dir, 22, this.pos.y);
    g.audio.play(SCREAM[this.kind], this.pos, 0.9, rand.range(0.92, 1.1));
    if (this.hp <= 0) {
      this.die(from);
      return 'kill';
    }
    g.hud.popText(this.headPos(), rand.pick(OUCH[this.kind]), '#ffffff', 22);
    this.model.hop = 0.12;
    if (this.state === 'faint') return 'bite';
    if (this.kind === 'catcher' && this.hp > this.maxHp * 0.3) {
      this.state = 'chase';
      return 'bite';
    }
    if (this.brave && this.hp > this.maxHp * 0.35) {
      this.state = 'attack';
      this.stateT = 7;
    } else {
      this.scare(from, 0.35);
    }
    return 'bite';
  }

  /** 驚いて逃げる */
  scare(from: THREE.Vector3, delay = 0.5) {
    if (!this.conscious || this.state === 'attack' || this.state === 'chase') return;
    this.fleeFrom.copy(from);
    if (this.state !== 'flee') {
      this.state = 'startle';
      this.stateT = delay;
      this.model.hop = 0.18;
    }
  }

  /** 吠えられた。気絶したら true */
  barked(dist: number, radius: number, big: boolean, from: THREE.Vector3): boolean {
    if (!this.conscious) return false;
    const p = FAINT_BASE[this.kind] * (big ? 2.3 : 1) * (1 - (dist / radius) * 0.55);
    if (rand.next() < p) {
      this.faint();
      return true;
    }
    this.scare(from, 0.45);
    if (rand.chance(0.5)) this.game.hud.popText(this.headPos(), rand.pick(['ひっ!', 'びっくりした!', 'うるさっ!', '!?']), '#ffffff', 20);
    return false;
  }

  faint() {
    const g = this.game;
    this.state = 'faint';
    this.stateT = rand.range(6, 11);
    this.model.fallDir = rand.chance(0.6) ? -1 : 1;
    this.removeStars();
    this.stars = g.fx.addStars();
    g.audio.play('faint', this.pos, 0.7);
    g.hud.popText(this.headPos(), 'バタッ', '#ffe066', 26);
    if (rand.chance(0.3)) this.dropItem();
  }

  die(from: THREE.Vector3) {
    const g = this.game;
    this.state = 'dead';
    this.removeStars();
    this.model.fallDir = Math.atan2(from.x - this.pos.x, from.z - this.pos.z) === this.yaw ? -1 : rand.chance(0.5) ? -1 : 1;
    g.audio.play('death', this.pos, 0.8);
    g.hud.popText(this.headPos(), rand.pick(['ぐふっ…', 'う…', '…']), '#ff4d4d', 24);
    const backX = Math.sin(this.yaw) * -this.model.fallDir;
    const backZ = Math.cos(this.yaw) * -this.model.fallDir;
    g.fx.bloodPool(new THREE.Vector3(this.pos.x + backX * this.height * 0.45, this.pos.y, this.pos.z + backZ * this.height * 0.45), this.model.look.child ? 0.7 : 1.0);
    if (this.body) {
      g.physics.world.removeRigidBody(this.body);
      this.body = null;
    }
    if (rand.chance(0.6)) this.dropItem();
  }

  // ---------- 状態異常（炎・撒菱） ----------
  private statusEffects(dt: number) {
    const g = this.game;
    if (this.slowT > 0) this.slowT -= dt;
    if (this.bleedT > 0) {
      this.bleedT -= dt;
      this.hp -= dt * 2.5;
      if (Math.random() < dt * 5) g.fx.bloodDrip(this.pos);
      if (this.hp <= 0) {
        this.die(this.pos);
        if (this.bleedByPlayer) g.karma.crime('kill', this.pos, this.kind, 1, 'spikes');
        return;
      }
    }
    if (this.burning > 0) {
      this.burning -= dt;
      this.hp -= dt * 17;
      if (Math.random() < dt * 30) g.fx.flame(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * this.height, (Math.random() - 0.5) * 0.4)), 1);
      this.screamT -= dt;
      if (this.screamT < 0 && this.conscious) {
        this.screamT = rand.range(1.2, 2.2);
        g.audio.play(SCREAM[this.kind], this.pos, 0.8, 1.15);
        g.hud.popText(this.headPos(), rand.pick(['あちちちっ!', '熱いーっ!', '火がっ!', 'ぎゃあああ!']), '#ffb703', 22);
      }
      if (this.conscious && this.state !== 'flee') {
        this.state = 'flee';
        this.calm = 0;
      }
      if (this.conscious) this.fleeFrom.set(this.pos.x + (Math.random() - 0.5) * 20, 0, this.pos.z + (Math.random() - 0.5) * 20);
      // 近くの人に燃え移る
      for (const o of g.npcs.list) {
        if (o === this || !o.alive || o.burning > 0) continue;
        if (Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) < 1.0) o.ignite(this.burnByPlayer);
      }
      if (this.hp <= 0) {
        this.burning = 0;
        this.char();
        this.die(this.pos);
        if (this.burnByPlayer) g.karma.crime('kill', this.pos, this.kind, 1, 'fire');
        return;
      }
    }
  }

  /** 火がつく */
  ignite(byPlayer: boolean) {
    if (!this.alive || this.burning > 0) return;
    this.burning = rand.range(5, 8);
    this.burnByPlayer = byPlayer;
    this.screamT = 0;
    if (this.state === 'faint') this.state = 'getup';
  }

  /** 撒菱を踏んだ。0=何もなし 1=けが 2=死亡 */
  stepOnSpikes(byPlayer: boolean): 0 | 1 | 2 {
    const g = this.game;
    if (!this.alive || this.slowT > 6) return 0;
    this.hp -= 22;
    this.slowT = 10;
    this.bleedT = 6;
    this.bleedByPlayer = byPlayer;
    g.audio.play(SCREAM[this.kind], this.pos, 0.7, 1.2);
    g.hud.popText(this.headPos(), rand.pick(['いったぁ!!', '足がっ!', 'なにか刺さった!', 'ぎゃっ!']), '#ffffff', 22);
    g.fx.bloodSpray(this.pos.clone().setY(this.pos.y + 0.1), new THREE.Vector3(0, 0, 0), 8, this.pos.y);
    if (this.hp <= 0) {
      this.die(this.pos);
      return 2;
    }
    if (this.kind !== 'catcher' && rand.chance(0.35)) this.faint();
    else if (this.conscious && this.state !== 'chase') this.scare(this.pos.clone().add(new THREE.Vector3(1, 0, 0)), 0.2);
    return 1;
  }

  /** 黒こげにする */
  char() {
    if (this.charred) return;
    this.charred = true;
    this.model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.color = new THREE.Color('#2a2420');
      mat.map = null;
      m.material = mat;
    });
  }

  /** 車や爆風で吹っ飛ばされて死ぬ */
  fling(vel: THREE.Vector3) {
    const g = this.game;
    if (this.state === 'dead') {
      this.flingVel = vel.clone();
      return;
    }
    this.state = 'dead';
    this.removeStars();
    this.model.fallDir = rand.chance(0.5) ? -1 : 1;
    this.flingVel = vel.clone();
    g.audio.play(SCREAM[this.kind], this.pos, 0.9);
    if (this.body) {
      g.physics.world.removeRigidBody(this.body);
      this.body = null;
    }
    if (rand.chance(0.5)) this.dropItem();
  }

  private dropItem() {
    const g = this.game;
    const id = rand.pick(DROPS);
    const a = rand.range(0, Math.PI * 2);
    const it = g.items.spawn(id, this.pos.x + Math.cos(a) * 0.6, this.pos.y + 0.5, this.pos.z + Math.sin(a) * 0.6, 'person', a);
    g.items.drop(it, it.obj.position.clone(), new THREE.Vector3(Math.cos(a) * 1.5, 2.5, Math.sin(a) * 1.5));
  }

  private removeStars() {
    if (this.stars) {
      this.game.fx.removeStars(this.stars);
      this.stars = null;
    }
  }

  dispose() {
    this.removeStars();
    this.game.scene.remove(this.model.root);
    if (this.body) {
      this.game.physics.world.removeRigidBody(this.body);
      this.body = null;
    }
  }
}
