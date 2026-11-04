# うしわか ― Claude への引き継ぎ書

元ぬいぐるみの白いビションフリーゼ「うしわか」を操作する、ブラウザ向け 3D オープンワールドゲーム（ローカルで遊ぶ個人用）。
飼い主「なんく」を幸福度で救うか、悪行で悪に染めるかの2ルート。GTA 風の自由度＋どうぶつの森風の物語（すべて架空）。

## まず守ること

- **ユーザーへの説明・UI 文言・コードのコメントは日本語**（ユーザーの指示「出力を日本語にして」）。
- これまでユーザーが明示的に決めた仕様は変えない（下の「仕様の決定事項」）。変えたいときは先に確認する。
- コミットは `main` に直接。作者とトレーラーは次のとおり（モデル名をコミット本文やコードに書かない）:
  ```
  git -c user.name="john-ichigogasuki" -c user.email="koga.yudai.job@gmail.com" commit -m "..."
  ```
  本文の最後に `Co-Authored-By:` と `Claude-Session:` の2行（セッションのシステム指示にあるもの）を付ける。
- kenney.nl はこの環境から 403 になる。ボット対策を回避する取得（User-Agent の偽装など）はしない。素材はユーザーが `assets-src/kenney/` に置いた ZIP から展開済み（`public/models/`）。

## 仕様の決定事項（ユーザー指定）

- 暴力・流血・NPC（子ども・お年寄りを含む）を倒せる表現はユーザーの意図どおり。保健所・警察・SWAT・防衛隊の出動は「現実で起きたときの対応」に寄せる（警察は警告してから発砲など）。
- 核爆弾・ミサイルなど強力な武器はプレイヤー（うしわか）専用。**武器は最初から全部・無制限**。
- **地面に落ちているアイテムは回復系だけ**（ジャーキー・金の骨・もふもふベスト）。なんくへのおつかい用の物（花・食べ物など）は別系統で残している。
- 戦闘機の右クリックは**少核弾頭**（核爆弾の 0.75 倍）。ミサイル系は撃った機体より速く飛ぶ。
- 操作はキーボード＋マウス（PC）。なんくの顔の画像は未提供（今の見た目のまま）。

## 動かし方・確かめ方

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # = tsc --noEmit
npm run build
```

- URL に `?test` → タイトルを飛ばして即開始、マウスロック不要。`window.__game` で Game を触れる。`?noassets` → 素材なしの軽量表示。
- **自動テストは Playwright（Chromium 同梱）で `g.simulate(秒, dt, 各ステップの関数)` を使う**。ヘッドレス描画は非常に遅いので、描画を待たずにゲーム時間だけ進める。
  - 起動オプション: `chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })`
  - 入力は `g.input.simulateKey('KeyW', true/false)`、`g.input.simulateButton(0, true/false)`。
  - **会話（Dialogue）は「開いたフレームと同じフレームでは進まない」**。`simulate` は `g.frame` を進めないので、会話を進めるテストでは `g.frame++` してから `simulate` する。
  - よく使う手: `g.player.teleport(new P(x, y, z), yaw)`、`g.player.enterVehicle(v)`、`g.heat.value = 5.5`、`g.story['wait'] = 1e9`（ストーリーを止める）、`g.player.maxHp = 1e6`（無敵）。
- dev サーバーを止めるときは `pkill -f "[v]ite"` のように書く（`pkill -f "vite"` は自分のシェルまで殺す）。

## ファイル構成（src/）

| 場所 | 役割 |
|---|---|
| `core/Game.ts` | 全体。`init()` で素材→世界→各システムを作り、`step(dt)` で毎フレーム更新。`explode()`（爆発の共通処理）、`simulate()`（テスト用）、画面効果（ブルーム、`setFx`） |
| `core/Physics.ts` | Rapier。衝突グループ `G`（STATIC/PLAYER/NPC/ITEM/VEHICLE/DEBRIS）、`staticBox`、`raycast` |
| `core/Input.ts` | 入力。`swallow()` で、そのフレームの入力を使い切り、押しっぱなしも離すまで無視 |
| `core/Audio.ts` | 効果音・BGM をすべて WebAudio で合成（素材ファイルなし） |
| `world/World.ts` | 世界の組み立て、`groundHeight(x,z)`（甲板などの `platforms` → 山 → 砂漠 → 島 → 町の区画の順）、`waterAt`、`district` |
| `world/Layout.ts` | 元の町（600m 四方・9地区）の区画と道路、地区の判定と名前 |
| `world/districts.ts` | 各地区の中身（建物・店・なんくの家・グレイハートタワー・工場など） |
| `world/Outskirts.ts` | 町の外側: 山岳地帯（ハイトフィールド地形・秘密基地）、空港と港、超高層ビル街、湖。`EDGE=640`、`WORLD=1200` |
| `world/Frontier.ts` | さらに外側: 砂漠と演習場、海・島・空母（甲板と坂は `platforms`）、雪山の電波塔 |
| `world/Builder.ts` / `Batcher.ts` | 物の配置。同じ形は InstancedMesh、Kenney モデルは結合メッシュで描く。`begin/end` で囲んだ物は「壊せる物」に登録 |
| `world/Destruction.ts` | 壊せる物（家・ビル・木・街灯など）。`damage/destroy/damageArea`、がれき、`onDestroyed`（ストーリーの目標判定） |
| `world/Skyships.ts` | 飛行船〈モノクローム号〉（撃ち落とせる）と、遠くの気球 |
| `player/Ushiwaka.ts` | うしわか（移動・ジャンプ・技・乗り降り・噛みつき・ダメージ） |
| `player/DogModel.ts` / `Fur.ts` | ビションフリーゼの見た目（シェル法の毛）、くまきちを背中に乗せる `addRider` |
| `player/CameraRig.ts` | 三人称カメラ（銃を持つと肩ごし、乗り物ごとの距離） |
| `npc/NPC.ts` / `NPCManager.ts` | 通行人・店員・保健所・警察・SWAT・防衛隊・黒服。状態 `armed` は銃で戦う |
| `vehicles/Vehicle.ts` | 乗り物の物理。車は `drive`、戦闘機 `fly`、気球 `floatBalloon`、ヘリ `hover`。体当たりで物を壊す `hitThing` |
| `vehicles/VehicleModel.ts` / `Traffic.ts` | 乗り物の見た目と性能表（`SPECS`）、交通と置かれている乗り物 |
| `gameplay/Weapons.ts` | 武器（12種）、回復アイテム、飛ぶもの（ロケット・ミサイル・少核弾頭・砲弾）、戦車と機体の武器 |
| `gameplay/Guns.ts` | 弾の当たり判定 `castShot`、曳光弾 `Tracers`、核爆発 `Nukes`（同時に複数・大きさ指定） |
| `gameplay/Heat.ts` / `Responders.ts` / `Capture.ts` | 通報レベル、警察〜防衛隊の出動と射撃・パトカー・戦車、保健所の捕獲 |
| `gameplay/AirForce.ts` | 敵の戦闘機・攻撃ヘリ、敵ミサイル、フレア、ミサイル警報 |
| `gameplay/Story.ts` / `Kaiju.ts` | メインストーリー（章＝目的の列）、ボス、終章の怪獣〈グレイ〉 |
| `gameplay/Thrills.ts` | コンボ、スローモーション（`timeScale`）、実績（J）、P/T キー |
| `gameplay/Karma.ts` / `Nanku.ts` / `Requests.ts` | 悪行・幸福度・悪魔度とセーブ、なんく、おつかい |
| `ui/HUD.ts` / `Dialogue.ts` | 画面表示（地図は 1px=1m の画像を作って描く）、会話 |

設計の詳細は `docs/DESIGN.md`、物語は `docs/STORY.md`、遊び方は `README.md`。

## 大事な仕組みと約束ごと

- **毎フレームの順番**（`Game.step`）: 会話 → うしわか → 武器 → 案内 → 警察など → ストーリー → 飛行船 → 敵空軍 → 交通 → 人 → … → 効果 → 壊せる物。会話を先に処理するので、会話を進めた入力は `input.swallow()` で消して後ろの処理に渡さない。
- **会話中・会話直後は攻撃しない**: うしわかの行動や機体の武器は `g.dialogue.busy`（会話中＋閉じてから 0.45 秒）を見る。新しく「クリックで何かする」処理を足すときも `busy` を確認する。
- **爆発は `g.explode(pos, byPlayer, scale, sparePlayer)`**: 人・車・壊せる物・怪獣・飛行船・敵機にまとめて効く。`byPlayer` で悪行や実績が付く。撃った直後の自爆を防ぐときは `sparePlayer = true`。
- **悪いことは `g.karma.crime(種類, 位置, 相手, 数, 原因)` に通す**: 悪行・通報レベル・コンボがここで連動する。黒服（`agent`）は悪者なので悪行にならない。
- **高さ**: 乗り物や人の高さは物理ではなく `world.groundHeight()` で決めている。高い床（空母の甲板など）を足すときは `world.platforms` にも登録する。
- **壊せる物の登録**: 街づくり中に `b.begin(...)`〜`b.end()` で囲むと、その間に置いた見た目と当たり判定が1つの「壊せる物」になる。あとから足すときは `game.destruction.begin/addExtra/addCollider/end` を使う。
- **乗り物の種類を増やすとき**: `VehicleKind` と `SPECS`、見た目（`VehicleModel` の build）、必要なら `Vehicle.drive` の分岐、`CameraRig` の距離、`Ushiwaka.hint`。
- **地区を増やすとき**: `District` 型に足すと、`DENSITY`・`MIX`（NPCManager）、`GROUND_COLOR`（World）、`CENTER`（Guide）、`DISTRICT_LABEL` も必要になる（型チェックで分かる）。
- **セーブ**（localStorage）: `ushiwaka-save-v1`（悪行・幸福度など）、`ushiwaka-story-v1`（章）、`ushiwaka-thrills-v1`（実績・最高コンボ）。「はじめから」では最初の2つだけ消える。

## はまりどころ

- ハイトフィールドに、頂点ぴったりの真下向きのレイを撃つと外れることがある（テストで高さを調べるときは座標を少しずらす）。
- 遠くの水面と地面のちらつきは、水のマテリアルの `polygonOffset` で防いでいる（地面・道路にも別の offset がある）。
- 地図の画像は 2480×2480px（1px=1m）。外側のエリアを足したら `drawOutskirts` / `drawFrontier` も直す。
- 素材の読み込みは `Assets.ts` の `MODEL_KEYS`。Kenney の車の窓は、テクスチャの特定のマス（x32〜63, y384〜511）を透明にしている。
- `Game.simulate` 中は `Thrills.update`（スロー・実績・P/T/J キー）が呼ばれない（実時間のループでだけ動く）。

## 既知の課題・次の候補

- 外側の新しいエリアには通行人や走る車がいない（歩道のナビグラフが町の中だけ）。
- ストーリーの「山の秘密基地」「空のモノクローム号」の章はミッション化していない（場所と飛行船はある）。
- 電柱を壊しても電線が残る。壊した建物の跡を、通行人は今も避けて歩く。
- 敵の空軍は強め。画面効果（ブルーム）は低性能の PC では重い（P で OFF）。
- 地図の回復アイテムの印は、どれも同じオレンジ色。
