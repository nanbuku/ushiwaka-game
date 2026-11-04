import type * as THREE from 'three';
import type { Game } from '../core/Game';
import { rand } from '../core/Rng';
import type { HumanKind } from '../npc/Human';
import type { District } from '../world/Layout';
import type { ItemDef, ItemId, WorldItem } from './Items';
import type { CrimeKind } from './Karma';

interface RequestDef {
  id: string;
  mode: 'normal' | 'devil';
  /** HUD に出す短い説明 */
  label: string;
  ask: string[];
  done: string[];
  count: number;
  reward: number;
  // 届け物
  item?: ItemId;
  category?: ItemDef['category'];
  fromDistrict?: District;
  // 悪事
  crime?: CrimeKind;
  victim?: HumanKind;
  district?: District;
}

const DEFS: RequestDef[] = [
  { id: 'apple', mode: 'normal', label: 'りんごを届ける', item: 'apple', count: 1, reward: 10, ask: ['ねえ、うしわか。なんだか、りんごが食べたい気分…。', '八百屋さんかスーパーにあるかな？'], done: ['りんご！ 覚えててくれたんだ。ありがとう！'] },
  { id: 'park_flower', mode: 'normal', label: 'みどり公園の花を届ける', item: 'flower', fromDistrict: 'park', count: 1, reward: 12, ask: ['みどり公園の花壇のお花、すっごくきれいなんだって。', '一輪だけ、見てみたいな。'], done: ['これが公園のお花？ いい匂い…。ありがとう。'] },
  { id: 'sweets', mode: 'normal', label: '甘いものを届ける', category: 'sweets', count: 1, reward: 12, ask: ['甘いものが食べたいなあ。わくわくランドのクレープとか…。', 'なーんて、さすがに無理だよね。'], done: ['ほんとに持ってきてくれたの！？ うしわか、天才！'] },
  { id: 'fish', mode: 'normal', label: 'おさかなを届ける', item: 'fish', count: 1, reward: 10, ask: ['今日の晩ごはん、お魚にしよっかな。', '商店街の魚屋さん、まだやってるかな？'], done: ['お魚！ 今夜は焼き魚だね。'] },
  { id: 'ball', mode: 'normal', label: 'ボールを届ける', item: 'ball', count: 1, reward: 10, ask: ['子どものころ、うしわかとボール遊びしたの覚えてる？', '…って、うしわかはその時ぬいぐるみだったか。ふふ。'], done: ['ボール！ 今度、一緒に公園で遊ぼうね。'] },
  { id: 'bread', mode: 'normal', label: 'パンを届ける', item: 'bread', count: 1, reward: 10, ask: ['明日の朝ごはんのパン、買い忘れちゃった…。'], done: ['パン！ 明日の朝ごはん、ばっちりだね。'] },
  { id: 'daikon', mode: 'normal', label: '田舎のだいこんを届ける', item: 'daikon', count: 1, reward: 12, ask: ['田んぼのほうの無人販売所、野菜が安くておいしいんだって。'], done: ['だいこん！ …お金、ちゃんと置いてきた？'] },
  { id: 'flowers3', mode: 'normal', label: 'お花を3本届ける', item: 'flower', count: 3, reward: 16, ask: ['お部屋にお花をいっぱい飾ったら、元気出るかなあ。', '3本くらい、あったらいいな。'], done: ['お部屋がお花畑みたい…！ ありがとう、うしわか。'] },

  { id: 'bite_office', mode: 'devil', label: 'オフィス街の会社員を3人噛む', crime: 'bite', victim: 'office', count: 3, reward: 15, ask: ['会社のやつらってさ、みんな同じ顔してるよね。', 'オフィス街のスーツの人たち、3人噛んできて？'], done: ['あはは！ 3人も？ うしわか、最高！'] },
  { id: 'faint_amuse', mode: 'devil', label: 'わくわくランドで5人気絶させる', crime: 'faint', district: 'amusement', count: 5, reward: 15, ask: ['わくわくランドって、幸せそうな人ばっかりでムカつく。', '5人くらい、気絶させてきてよ。'], done: ['幸せそうな顔が、真っ白になったでしょ？ ふふ。'] },
  { id: 'wallets', mode: 'devil', label: 'さいふを2つ届ける', item: 'wallet', count: 2, reward: 15, ask: ['お金があれば、会社なんて行かなくていいのにね。', 'さいふ、2つ持ってきて？'], done: ['2つも！ これで当分、会社休めるかも。'] },
  { id: 'kill_any', mode: 'devil', label: '誰でもいいから2人やっつける', crime: 'kill', count: 2, reward: 18, ask: ['ねえ、うしわか。', '…誰でもいいよ。2人、ね？'], done: ['…えらいね。誰にも言わないから、安心して。'] },
  { id: 'catcher', mode: 'devil', label: '保健所の職員に噛みつく', crime: 'bite', victim: 'catcher', count: 1, reward: 15, ask: ['保健所のやつら、うしわかを捕まえようとしてるんでしょ？', '一人くらい、噛んでやって。'], done: ['ざまあみろ、だね！'] },
  { id: 'shrine', mode: 'devil', label: '神社のお供え物を盗む', crime: 'shrine', count: 1, reward: 12, ask: ['神様なんて、いないよね。', '神社のお供え物、盗ってきてよ。'], done: ['バチなんて当たらないよ。だって神様いないもん。'] },
  { id: 'clerks', mode: 'devil', label: '店員さんを2人噛む', crime: 'bite', victim: 'clerk', count: 2, reward: 15, ask: ['スーパーまるなかの店員、昔レジで舌打ちしてきたんだよね。', '店員さん、2人くらい噛んできて？'], done: ['ふふ、スッキリした！'] },
];

/** なんくからのおつかい（依頼） */
export class Requests {
  current: RequestDef | null = null;
  progress = 0;
  private done = new Set<string>();

  constructor(private game: Game) {}

  get complete() {
    return !!this.current && this.progress >= this.current.count;
  }

  get label() {
    if (!this.current) return '';
    const c = this.current;
    return `${c.label}（${Math.min(this.progress, c.count)} / ${c.count}）${this.complete ? '　→ なんくに報告しよう！' : ''}`;
  }

  /** 新しいおつかいを頼む。頼んだらセリフを返す */
  assign(): string[] | null {
    const mode = this.game.karma.mode;
    let pool = DEFS.filter((d) => d.mode === mode && !this.done.has(d.id));
    if (!pool.length) {
      for (const d of DEFS) if (d.mode === mode) this.done.delete(d.id);
      pool = DEFS.filter((d) => d.mode === mode);
    }
    const def = rand.pick(pool);
    this.current = def;
    this.progress = 0;
    this.game.hud.toast(`おつかい：${def.label}`, mode === 'devil' ? 'evil' : 'good', 5);
    return def.ask;
  }

  /** モードが変わったら依頼を取り消す */
  cancelIfModeChanged() {
    if (this.current && this.current.mode !== this.game.karma.mode) {
      this.current = null;
      this.progress = 0;
    }
  }

  onCrime(kind: CrimeKind, detail: string, pos: THREE.Vector3, count: number) {
    const c = this.current;
    if (!c || !c.crime || this.complete) return;
    if (c.crime !== kind) return;
    if (c.victim && c.victim !== detail) return;
    if (c.district && this.game.world.district(pos.x, pos.z) !== c.district) return;
    this.progress += count;
    if (this.complete) this.game.hud.toast('おつかい達成！ なんくに報告しよう', c.mode === 'devil' ? 'evil' : 'good', 5);
  }

  /** この物がおつかいの届け物に当てはまるか */
  matches(it: WorldItem) {
    const c = this.current;
    if (!c || c.crime) return false;
    if (c.item && it.def.id !== c.item) return false;
    if (c.category && it.def.category !== c.category) return false;
    if (c.fromDistrict && this.game.world.district(it.origin.x, it.origin.z) !== c.fromDistrict) return false;
    return true;
  }

  /** 届け物がおつかいに合っていれば進める */
  onDeliver(it: WorldItem): boolean {
    if (this.complete || !this.matches(it)) return false;
    this.progress++;
    return true;
  }

  /** 達成済みなら報酬を渡して、完了セリフを返す */
  claim(): { lines: string[]; reward: number } | null {
    const c = this.current;
    if (!c || !this.complete) return null;
    this.done.add(c.id);
    this.current = null;
    this.progress = 0;
    return { lines: c.done, reward: c.reward };
  }

  reminder(): string[] | null {
    const c = this.current;
    if (!c) return null;
    return this.game.karma.mode === 'devil' ? [`ねえ、お願いしたこと覚えてる？`, `「${c.label}」…待ってるからね。`] : [`おつかい、覚えてる？`, `「${c.label}」…無理しなくていいからね。`];
  }

  save() {
    return { id: this.current?.id ?? null, progress: this.progress, done: [...this.done] };
  }

  load(d: { id: string | null; progress: number; done: string[] } | undefined) {
    if (!d) return;
    this.current = DEFS.find((x) => x.id === d.id) ?? null;
    this.progress = d.progress ?? 0;
    this.done = new Set(d.done ?? []);
  }
}
