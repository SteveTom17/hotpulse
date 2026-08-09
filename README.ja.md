# HotPulse — ホットトレンドコンテンツ運用作戦台

[简体中文](./README.md) | [English](./README.en.md) | **日本語**

HotPulse は、ローカルブランド向けのホットトレンドコンテンツ運用作戦台です。「トレンドの発見 → 追う価値の判断 → コンテンツ草案の作成 → 人間によるレビュー → コンプライアンス準拠の書き出し」をひとつのワークフローに統合し、コンバージョン率よりも、出典・ブランド事実・AI 表示・承認記録を優先します。

これは**自動投稿ツールではありません**:すべてのコンテンツ草案は AI が生成し、明確にラベル表示され、公開前に必ず人間の承認を通過する必要があります。行動憲章は [AGENTS.md](./AGENTS.md)、完全な要件と受け入れ基準は [requirements.md](./requirements.md) を参照してください。

現在のステータス:`0.1.0` 実行可能な MVP。サーバー側の永続化とマルチテナント認可が実装済みです。

## 機能一覧

| モジュール | 機能 |
|---|---|
| トレンドレーダー | 認可済み HTTP API コネクタ（AES-256-GCM で暗号化された認証情報、指数バックオフ、レート制限による一時停止）と顧客 CSV インポート（「顧客提供」と表示）、24 時間の意味的重複排除、全オリジナルリンクを保持したクロスソース統合 |
| トレンド分析 | ヒートスコア・成長率・クロスソース出現回数。透明なランキング軸と更新時刻の表示 |
| ブランドプロフィール | 生成時に必ず参照されるブランド事実。事実がない場合はプレースホルダーを出力しない |
| コンテンツスタジオ | DeepSeek/OpenAI 互換ゲートウェイでコンテンツパッケージを生成（API キー未設定時は明確にラベル表示されたデモエンジンにフォールバック）。編集・バージョン履歴・復元に対応 |
| リスク分類 | ニュース・医療・金融・法律・未成年・災害・政治などの話題は自動的にリスクを引き上げ、高リスク話題はマーケティング生成を全面的にブロック |
| 人間による承認 | 3 段階承認（出典 / 事実 / AI 表示）。承認後はコンテンツがロックされ、コンプライアンス準拠の書き出しが可能 |
| 監査トレイル | 生成・編集・承認・書き出し・コネクタ失敗がすべて追跡可能。アカウントデータ削除後も監査記録は法令に基づき保持 |
| 課金パイロット | 無料トライアル 30 クレジット。管理者が手動で有効化する Pro プラン（¥399/月/ワークスペース、150 クレジット/月）。利用量と請求書の記録 |
| 利用規約 | 利用規約・プライバシーポリシーへの同意の記録、サポート/データリクエストチケット、アカウントデータ削除 |

> UI に表示されるトレンド・ブランド・データソースはすべて**モックデータ**で、デモ専用です。実際のホットトレンドやビジネス事実として公開しないでください。

## プロジェクトマップ

```
app/                    フロントエンドページと API ルート（Next.js 風 app ディレクトリ）
├── HotPulseApp.tsx     シングルページアプリ本体（ワークスペース UI）
└── api/                22 のサーバールート（/api/trends、/api/packages、/api/connectors ...）
lib/                    コアライブラリ:認証、リスク分類、課金、監査、コネクタ同期、モデルゲートウェイ、暗号化
db/schema.ts            データベーススキーマ（15 テーブル、Drizzle ORM）
drizzle/                SQL マイグレーション（0000/0001/0002 — 手動編集禁止）
worker/index.ts         Worker エントリ + Cron 同期（30 分ごと）
tests/                  10 の統合テスト（node --test、プロセス内 D1 を使用）
scripts/vinext.mjs      開発/ビルドスクリプト（Vinext フレームワーク）
wrangler.jsonc          本番デプロイ設定（Worker + D1 + Cron + vars）
vite.config.ts          ローカル開発設定（Vite 8 + Cloudflare プラグイン）
```

## ローカル開発(5 分)

前提条件:Node.js `>=22.13.0`(Windows は PowerShell、macOS/Linux は bash)。

```bash
npm install
npm run dev
```

http://localhost:3000 を開きます。デフォルトはデモユーザー + デモエンジンで、**API キーやアカウントは不要です**:

- 初回アクセス時に利用規約とプライバシーポリシーへの同意が必要(最小限の組み込みテキスト)
- ブランドワークスペースを作成 → コネクタを追加(HTTP API / CSV インポート)→ 草案を生成 → 承認 → 書き出し
- 実際の AI 生成を試すには `.dev.vars.example` を `.dev.vars` にコピーし、`DEEPSEEK_API_KEY` を設定して `npm run dev` を再起動

その他のコマンド:

```bash
npm test                  # 10 の統合テスト(マルチテナント/暗号化/監査/課金/法務フロー)
npm run build             # 本番ビルド(dist/ に出力)
npm run lint              # ESLint
npm run db:generate       # スキーマ変更後にマイグレーションを生成
npm run db:migrate:local  # ローカル D1 にマイグレーションを適用
```

## Cloudflare へのデプロイ(本番)

### 1. 前提条件

- [Cloudflare アカウント](https://dash.cloudflare.com)(無料の Worker プランで開始可能)
- Wrangler にログイン:`npx wrangler login`
- Node.js `>=22.13.0`

### 2. D1 データベースを作成

```bash
npx wrangler d1 create hotpulse-d1
```

出力された `database_id` を `wrangler.jsonc` の `d1_databases[0].database_id` に置き換えます。

### 3. シークレットを設定(リポジトリにコミットしないこと)

```bash
npx wrangler secret put CONNECTOR_SECRET_KEY   # 認証情報暗号化キー(32 バイト hex):openssl rand -hex 32
npx wrangler secret put DEEPSEEK_API_KEY       # モデル API キー(任意、未設定時はデモエンジン)
npx wrangler secret put ADMIN_API_KEY          # 管理者/手動課金エンドポイントキー(任意)
```

### 4. wrangler.jsonc のプレースホルダー vars を編集

| 変数 | 説明 |
|---|---|
| `CF_ACCESS_JWT_VERIFY` | `"true"` で Cloudflare Access 認証を有効化(本番推奨)。`"false"` のままはデモ専用(誰でもアクセス可能) |
| `CF_ACCESS_AUD` / `CF_ACCESS_CERTS_URL` | Access アプリの Audience Tag と証明書 URL |
| `ADMIN_USER_IDS` | 課金を手動で有効化できるグローバル管理者ユーザー ID |
| `SUPPORT_EMAIL` | サポート/チケットページに表示する連絡先メール |

### 5. ビルド・マイグレーション・デプロイ

```bash
npm run build
npm run db:migrate:remote   # リモート D1 に全マイグレーション(0000/0001/0002)を適用
npx wrangler deploy
```

デプロイ後:Worker ドメインを開く → 規約に同意 → ワークスペースを作成 → 利用開始。Cron(30 分ごとのコネクタ同期)は自動で有効です。

### 6. 本番チェックリスト

- [ ] 認可済みデータソースを 1 つ以上接続(公式プラットフォーム API または書面承認済みサプライヤー。スクレイピング/Cookie バイパスは禁止)
- [ ] `CONNECTOR_SECRET_KEY` を設定し安全にバックアップ(紛失すると保存済み認証情報を復号できない)
- [ ] Access 認証を有効化した場合は、非メンバーが拒否されることを確認(マルチテナント分離)
- [ ] `LEGAL_VERSION` が規約/プライバシーテキストと一致していること
- [ ] アカウントデータ削除とサポートチケットをテストし、監査記録が保持されることを確認

## 設定リファレンス

| キー | 場所 | 説明 |
|---|---|---|
| `CF_ACCESS_JWT_VERIFY` | vars | 認証スイッチ。ローカル開発はデフォルト `false`(vite.config.ts で上書き)、本番はデフォルト `true` |
| `AUTH_DEMO_USER` | `.dev.vars` | ローカルデモユーザー `userId\|email\|name`。未設定時は組み込みデフォルト |
| `GENERATION_ENGINE` | vars | `model` = 正式モデル / `demo` = デモエンジン |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | secret/vars | モデルゲートウェイ URL とモデル名(OpenAI 互換) |
| `LEGAL_VERSION` | vars | 利用規約バージョン |
| `ADMIN_API_KEY` | secret | 手動管理者/課金エンドポイントキー |

## 技術スタック

- TypeScript、React 19、Vinext(Vite 8、Next.js 風 app ディレクトリ)、Tailwind CSS 4
- Cloudflare Workers(API ルート + Cron 同期)+ D1 + Drizzle ORM(15 テーブル)
- DeepSeek/OpenAI 互換モデルゲートウェイ、AES-256-GCM による認証情報暗号化
- 10 の統合テスト(node --test + プロセス内 D1)。ビルド/テスト/lint すべてグリーン

このスタックは、レスポンシブ Web・サーバー API・データベース・ホスティングを単一のコードベースでカバーし、パイロット期間中のデプロイとメンテナンスコストを最小化します。

## ビジネス前提(創業者向け)

汎用の「AI コピーライティングツール」として売るのではなく、単一の業種パイロットから始めることを推奨します。初期価格 `¥399/月/ワークスペース`(業界トレンド分析・固定コンテンツクレジット・コンプライアンス準拠の書き出し)は検証可能な仮説であり、収入保証ではありません。継続利用・承認/書き出し量・節約時間によって更新が証明されるべきです。課金は現在管理者による手動有効化で、実際の決済ゲートウェイは v1 の対象外です。

## ライセンス

[MIT](./LICENSE)
