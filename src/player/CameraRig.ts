import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G } from '../core/Physics';
import { clamp, damp, lerp } from '../core/Rng';

/** 三人称カメラ（マウスで回転、ホイールで距離、壁にめり込まない） */
export class CameraRig {
  yaw = 0;
  pitch = 0.28;
  dist = 2.8;
  targetDist = 2.8;
  sensitivity = 0.0024;
  private focus = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private shake = 0;
  private idleMouse = 0;
  private carDist = 6.5;

  constructor(private game: Game) {}

  snapBehind(dogYaw: number) {
    this.yaw = dogYaw + Math.PI;
    this.focus.copy(this.game.player.pos).add(new THREE.Vector3(0, 0.5, 0));
  }

  addShake(v: number) {
    this.shake = Math.max(this.shake, v);
  }

  update(dt: number) {
    const g = this.game;
    const inp = g.input;
    if (inp.active && !g.dialogue.active) {
      this.yaw -= inp.mouseDX * this.sensitivity;
      this.pitch = clamp(this.pitch + inp.mouseDY * this.sensitivity * 0.9, -0.28, 1.3);
      if (inp.wheel) this.targetDist = clamp(this.targetDist * (1 + inp.wheel * 0.12), 1.3, 10);
      if (inp.down('ArrowLeft')) this.yaw += dt * 2;
      if (inp.down('ArrowRight')) this.yaw -= dt * 2;
    }
    const p = g.player;
    const v = p.driving;
    this.idleMouse = Math.abs(inp.mouseDX) + Math.abs(inp.mouseDY) > 0 ? 0 : this.idleMouse + dt;
    if (v) {
      if (inp.wheel) this.carDist = clamp(this.carDist * (1 + inp.wheel * 0.12), 3, 14);
      if (this.idleMouse > 1.0 && Math.abs(v.speed) > 2) {
        const behind = v.yaw + (v.speed < 0 ? 0 : Math.PI);
        let d = behind - this.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.yaw += d * damp(2.5, dt);
        this.pitch += (0.22 - this.pitch) * damp(2, dt);
      }
    }
    this.dist = lerp(this.dist, v ? this.carDist : this.targetDist, damp(6, dt));
    const tx = v ? v.pos.x : p.pos.x;
    const ty = v ? v.pos.y + v.spec.height * 0.8 : p.pos.y + 0.5 + p.visualYOffset;
    const tz = v ? v.pos.z : p.pos.z;
    const k = damp(22, dt);
    this.focus.x = lerp(this.focus.x, tx, k);
    this.focus.z = lerp(this.focus.z, tz, k);
    this.focus.y = lerp(this.focus.y, ty, damp(10, dt));

    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    let d = this.dist;
    const hit = g.physics.raycast(this.focus, this.dir, d + 0.25, G.STATIC | G.VEHICLE, p.driving?.collider);
    if (hit) d = Math.max(0.3, hit.dist - 0.22);
    const cam = g.camera;
    cam.position.copy(this.focus).addScaledVector(this.dir, d);
    if (cam.position.y < 0.12) cam.position.y = 0.12;
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.25;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.25;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    cam.lookAt(this.focus);
  }
}
