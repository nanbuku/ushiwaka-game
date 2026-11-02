import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G, groups, RAPIER } from '../core/Physics';
import { angleDiff, damp, rand } from '../core/Rng';
import { HumanModel, type HumanLook } from '../npc/Human';
import { inRect } from '../world/Layout';
import * as L from './NankuLines';

const NORMAL_LOOK: HumanLook = {
  height: 1.6,
  skin: '#f3dcc6',
  hair: '#2b1d1a',
  top: '#f6c9d6',
  bottom: '#8fa7c9',
  shoes: '#f4f0ea',
  skirt: true,
  hairStyle: 'long',
  hunch: 0.04,
  child: false,
};

const DEVIL_LOOK: HumanLook = {
  ...NORMAL_LOOK,
  hair: '#120a10',
  top: '#1b1420',
  bottom: '#6b0f22',
  shoes: '#111111',
  hunch: 0,
};

/** 飼い主のなんく（25歳）。うしわかの帰りを家の前で待っている */
export class Nanku {
  model: HumanModel;
  pos = new THREE.Vector3();
  yaw = 0;
  private baseYaw = 0;
  private waved = false;
  private horns: THREE.Group | null = null;
  private aura: THREE.Mesh | null = null;
  private t = 0;
  private devilShown = false;

  constructor(private game: Game) {
    const w = game.world;
    this.pos.copy(w.nankuSpot);
    this.yaw = this.baseYaw = w.nankuYaw;
    this.model = new HumanModel(NORMAL_LOOK);
    game.scene.add(this.model.root);
    const body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(this.pos.x, this.pos.y + 0.8, this.pos.z));
    game.physics.world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.24).setCollisionGroups(groups(G.NPC, G.PLAYER | G.ITEM)), body);
  }

  get devil() {
    return this.game.karma.mode === 'devil';
  }

  canTalk(p: THREE.Vector3) {
    return !this.game.dialogue.active && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 1.8 && Math.abs(p.y - this.pos.y) < 1;
  }

  update(dt: number) {
    this.t += dt;
    const g = this.game;
    if (this.devil !== this.devilShown) this.applyLook();
    const dog = g.player.pos;
    const d = Math.hypot(dog.x - this.pos.x, dog.z - this.pos.z);
    let mode: 'idle' | 'wave' = 'idle';
    if (d < 9) {
      const target = Math.atan2(dog.x - this.pos.x, dog.z - this.pos.z);
      this.yaw += angleDiff(this.yaw, target) * damp(5, dt);
      if (!this.waved && d < 6) {
        this.waved = true;
        g.hud.popText(this.headPos(), this.devil ? 'うしわか〜♥' : 'うしわか！', this.devil ? '#ff4d6d' : '#ff8fb1', 24);
      }
      if (d > 2.2 && this.t % 6 < 2) mode = 'wave';
    } else {
      this.waved = false;
      this.yaw += angleDiff(this.yaw, this.baseYaw) * damp(2, dt);
    }
    const r = this.model.root;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    this.model.animate(dt, mode, 0);
    if (this.aura) {
      this.aura.rotation.y += dt * 0.8;
      (this.aura.material as THREE.MeshBasicMaterial).opacity = 0.1 + Math.sin(this.t * 3) * 0.04;
    }
  }

  private applyLook() {
    const g = this.game;
    this.devilShown = this.devil;
    g.scene.remove(this.model.root);
    this.model = new HumanModel(this.devil ? DEVIL_LOOK : NORMAL_LOOK);
    g.scene.add(this.model.root);
    if (this.devil) {
      this.horns = new THREE.Group();
      const hornMat = new THREE.MeshStandardMaterial({ color: '#c1121f', emissive: '#5a0010', emissiveIntensity: 0.6, roughness: 0.4 });
      for (const sx of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 8), hornMat);
        h.position.set(sx * 0.07, 0.22, 0.02);
        h.rotation.z = -sx * 0.35;
        this.horns.add(h);
      }
      this.model.head.add(this.horns);
      this.aura = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.75, 2.0, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: '#5a0026', transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
      );
      this.aura.position.y = 1.0;
      this.model.root.add(this.aura);
    } else {
      this.horns = null;
      this.aura = null;
    }
  }

  headPos() {
    return this.pos.clone().add(new THREE.Vector3(0, 1.85, 0));
  }

  onBark(p: THREE.Vector3, big: boolean) {
    if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > 9 || this.game.dialogue.active) return;
    const text = rand.pick(this.devil ? L.BARK_DEVIL : L.BARK_NORMAL);
    this.game.hud.popText(this.headPos(), text, this.devil ? '#ff4d6d' : '#ff8fb1', big ? 22 : 18);
  }

  /** 話しかける（くわえている物があれば渡す） */
  talk() {
    const g = this.game;
    const k = g.karma;
    const say = (lines: string[]) => g.dialogue.show('なんく', lines, this.devil);

    if (k.fallPending) {
      g.audio.play('evil');
      g.dialogue.show('なんく', L.FALL_EVENT, true, () => {
        k.fall();
        g.hud.toast('なんくが悪に目覚めた…！　これからは「悪魔度」を満タンにしよう', 'evil', 7);
        k.save();
      });
      return;
    }

    const carried = g.player.carrying;
    if (carried) {
      const it = g.player.consumeCarried()!;
      const def = it.def;
      const stolen = it.stolen;
      const fromHome = def.id === 'flower' && inRect(g.world.homeArea, it.origin.x, it.origin.z, 1);
      g.requests.onDeliver(it);
      const delta = k.gift(def, stolen);
      const fill = (arr: string[]) => arr.map((s) => s.replace('{item}', def.name));
      let lines: string[];
      if (k.mode === 'normal') {
        lines = fromHome ? [...L.GIFT_FROM_HOME] : fill(rand.pick(L.GIFT_NORMAL[def.category]));
        if (stolen) lines = [...lines, ...rand.pick(L.GIFT_STOLEN_NORMAL)];
        g.audio.play('happy', this.pos, 0.8);
        g.hud.toast(`なんくの幸福度 +${delta}`, 'good');
        g.fx.hearts(this.headPos());
      } else {
        lines = fill(rand.pick(L.GIFT_DEVIL[def.category]));
        if (stolen) lines = [...lines, ...L.GIFT_STOLEN_DEVIL];
        g.audio.play('evil', this.pos, 0.6);
        g.hud.toast(`なんくの悪魔度 +${delta}`, 'evil');
      }
      const claim = this.claimRequest();
      say(claim ? [...lines, ...claim] : lines);
      k.save();
      this.checkEnding();
      return;
    }

    const claim = this.claimRequest();
    if (claim) {
      say(claim);
      k.save();
      this.checkEnding();
      return;
    }
    if (!g.requests.current && rand.chance(0.65)) {
      const ask = g.requests.assign();
      if (ask) {
        say(ask);
        return;
      }
    } else if (g.requests.current && rand.chance(0.4)) {
      say(g.requests.reminder()!);
      return;
    }

    if (k.mode === 'devil') {
      say(rand.chance(0.3) ? rand.pick(L.HINT_DEVIL) : rand.pick(L.GREET_DEVIL));
    } else if (k.tier > 0) {
      say(rand.pick(L.GREET_DARK[k.tier - 1]));
    } else {
      const pool = k.happiness < 30 ? L.GREET_NORMAL.low : k.happiness < 70 ? L.GREET_NORMAL.mid : L.GREET_NORMAL.high;
      say(rand.chance(0.3) ? rand.pick(L.HINT_NORMAL) : rand.pick(pool));
    }
    this.checkEnding();
  }

  /** 達成済みのおつかいがあれば報酬を渡し、セリフを返す */
  private claimRequest(): string[] | null {
    const g = this.game;
    const k = g.karma;
    const r = g.requests.claim();
    if (!r) return null;
    if (k.mode === 'devil') {
      k.devil = Math.min(100, k.devil + r.reward);
      g.hud.toast(`おつかい完了！ なんくの悪魔度 +${r.reward}`, 'evil', 4);
    } else {
      k.happiness = Math.min(100, k.happiness + r.reward);
      g.hud.toast(`おつかい完了！ なんくの幸福度 +${r.reward}`, 'good', 4);
      g.fx.hearts(this.headPos());
    }
    g.audio.play('happy', this.pos, 0.9);
    return r.lines;
  }

  checkEnding() {
    const g = this.game;
    const k = g.karma;
    if (k.ended) return;
    if (k.happyEndReady) {
      k.ended = 'happy';
      g.dialogue.queue('なんく', L.ENDING_HAPPY, false, () => g.hud.showEnding('happy'));
    } else if (k.checkDevilEnd()) {
      k.ended = 'devil';
      g.dialogue.queue('なんく', L.ENDING_DEVIL, true, () => g.hud.showEnding('devil'));
    }
  }

  /** うしわかがボロボロになって戻ってきたとき */
  reviveTalk() {
    const g = this.game;
    g.dialogue.show('なんく', this.devil ? L.REVIVE_DEVIL : L.REVIVE_NORMAL, this.devil);
  }
}
