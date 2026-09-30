# Content Studio — AIコンテンツ制作ワークスペース（MVP）

台本 → カット → Prompt → 素材 を、ひとつのワークスペースで管理するための SaaS MVP です。

AI動画・画像を「生成するツール」ではありません。Kling / Nano Banana / Veo / Midjourney / ElevenLabs などの外部ツールを使うクリエイターのために、ツールとツールの**あいだの面倒な制作工程**（カット割り・設定の使い回し・Promptのコピペ・版管理）を減らすことが目的です。

## できること

| 工程 | 機能 |
| --- | --- |
| 案件 | プロジェクト作成（形式・媒体・アスペクト比・納期・ステータス・映像トーン）、進捗率、納期超過の表示 |
| 台本 | 貼り付け・自動保存・**AIで解析**（シーン / カット / 登場人物 / ロケーション / 時間帯 / 小道具 / 感情 / セリフ / 必要素材） |
| 設定資料 | キャラクター・ロケーションの登録、参考画像、別名（高橋さん・高橋部長…）、**Prompt用の固定英語描写** |
| カット表 | No / 内容 / 登場人物 / 場所 / アクション / 画像Prompt / 動画Prompt / 素材 / ステータス。編集・追加・削除・並び替え（ドラッグ / 上下）・一括ステータス変更・検索・絞り込み |
| Prompt | 画像・動画Promptの一括生成 / 個別再生成 / 手動編集（版として保存）/ 履歴 / ワンクリックコピー / 全件コピー / CSV書き出し |
| 素材 | カットごとに画像・動画・音声をアップロード（v1 → v2 → v3 と自動採番、**最新版バッジ**）、外部URL（Google Drive等）の版登録 |
| ステータス | 未着手 → Prompt作成済み → 画像生成済み → 動画生成済み → 修正中 → 完了。Prompt生成・素材アップロードで**自動的に前進**（修正中・完了は上書きしない） |

### 設計上のこだわり

- **キャラクターがブレない**：Promptの「登場人物・場所・スタイル」部分はLLMに書かせず、登録済みの固定描写をコードで毎回そのまま差し込みます（`src/lib/prompts/compose.ts`）。LLMが書くのはカット固有の構図・動きだけです。
- **古いPromptがわかる**：カット内容・キャラクター・ロケーション・映像トーンを変更すると、それ以前に作ったPromptに「要再生成」が付き、一括生成の対象になります。
- **クリック数を減らす**：解析1回でキャラクター・ロケーション・カット表まで作成。Prompt生成時に未作成の固定描写も自動生成。「次にやること」を常に表示します。
- **APIキー無しでも全工程を試せる**：`AI_PROVIDER=mock`（ルールベース）で動作します。

## 技術構成

- Next.js 16（App Router / Server Actions / Turbopack）+ React 19 + TypeScript
- Tailwind CSS v4（ライト / ダーク両対応のデザイントークン）
- PostgreSQL + Prisma 7（`@prisma/adapter-pg`）
- 認証：メール + パスワード（bcrypt）、DBセッション（httpOnly Cookie、トークンはSHA-256でハッシュ保存）
- ストレージ：ドライバ抽象化（`local` / `s3` = AWS S3・Cloudflare R2・MinIO）
- AI：プロバイダ抽象化（`anthropic` = Claude / `mock`）、Zodで構造化出力を検証

## セットアップ

前提：Node.js 20.9+、PostgreSQL 14+

```bash
cd content-studio
cp .env.example .env          # DATABASE_URL などを設定
npm install                   # prisma generate も実行されます
npm run db:migrate            # マイグレーション適用
npm run dev                   # http://localhost:3000
```

`/signup` でアカウントを作成し、「新しいプロジェクト」→「サンプルを入力」で全工程を試せます。

### 環境変数

`.env.example` を参照してください。主なもの：

| 変数 | 説明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 接続文字列 |
| `AI_PROVIDER` | `anthropic` / `mock`。未設定なら `ANTHROPIC_API_KEY` の有無で自動選択 |
| `ANTHROPIC_API_KEY` | サーバー側でのみ使用（`NEXT_PUBLIC_` を付けないこと） |
| `AI_MODEL` / `AI_EFFORT` | 既定 `claude-opus-5-5` / `medium` |
| `STORAGE_DRIVER` | `local`（`STORAGE_LOCAL_DIR`）または `s3`（`S3_*`） |
| `UPLOAD_MAX_MB` | アップロード上限（既定 200MB） |
| `ALLOW_SIGNUP` | `false` で新規登録を停止 |

### スクリプト

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run lint` / `npm run typecheck` / `npm run build` | 品質チェック（`npm run check` で全部） |
| `npm run db:migrate` | 開発用マイグレーション |
| `npm run db:deploy` | 本番用マイグレーション適用 |

## ディレクトリ構成

```
content-studio/
  prisma/schema.prisma            データモデル
  src/
    proxy.ts                      未ログイン時のリダイレクト（楽観チェック）
    app/
      (auth)/login, signup        認証画面
      (app)/projects/...          一覧 / 新規 / 台本 / キャラクター / ロケーション / カット表 / 設定
      actions/*.ts                Server Actions（型付きの更新API）
      api/uploads                 ファイルアップロード（multipart）
      api/files/[...key]          ファイル配信（所有者のみ・Range対応）
    components/                   UI（shots/ がカット表・詳細パネル）
    lib/
      ai/                         AIプロバイダ抽象化・スキーマ・サービス関数
      prompts/compose.ts          決定的なPrompt組み立て + ツール別フォーマッタのレジストリ
      prompts/stale.ts            Promptの鮮度判定
      services/                   素材版管理・ステータス自動遷移・設定資料
      storage/                    ストレージドライバ（local / s3）
      auth/                       セッション・パスワード
```

## データモデル

```
User ─< Session
User ─< Project ─< Character >─< Shot >─ Location >─ Project
                 └< Shot ─< Prompt（kind: IMAGE|VIDEO, target, version, source: AI|MANUAL）
                          └< Asset（kind）─< AssetVersion（version, storageKey | externalUrl）
```

- `Project.analysis`：最後の台本解析結果（JSON）
- `Project.promptContextUpdatedAt` / `Shot.contentUpdatedAt`：Prompt鮮度判定用のタイムスタンプ
- `Prompt.target`：Promptフォーマット（現在は `generic`。将来 `kling` / `veo` / `midjourney` など）

## API（Server Actions / Route Handlers）

すべてサーバー側で所有者チェックを行い、`{ ok: true, data } | { ok: false, error }` を返します。

| 領域 | 関数 |
| --- | --- |
| 認証 | `signup` `login` `logout` |
| プロジェクト | `createProject` `updateProject` `updateProjectStatus` `saveScript` `deleteProject` |
| 解析 | `analyzeScript(projectId, "replace" \| "append")` |
| 設定資料 | `create/update/deleteCharacter` `create/update/deleteLocation` `generateCharacterSheet` `generateLocationSheet` `removeReferenceImage` |
| カット | `createShot` `updateShot` `updateShotsStatus` `deleteShot` `moveShot` `reorderShots` |
| Prompt | `generatePrompts(projectId, "missing" \| "all" \| "selected", ids)` `savePrompt` |
| 素材 | `POST /api/uploads` `GET /api/files/...` `addExternalAssetVersion` `deleteAssetVersion` |

AI層（`src/lib/ai/index.ts`）：`generateScriptAnalysis` `generateCharacters` `generateLocations` `generateShots` `generateEntityDescription` `generateShotPrompts` `generateImagePrompt` `generateVideoPrompt`。

### AIプロバイダを追加するには

`src/lib/ai/types.ts` の `AIProvider`（`analyzeScript` / `describeEntity` / `generateShotPromptParts`）を実装し、`getAIProvider()` に分岐を追加します。

### ツール別Promptフォーマットを追加するには

`src/lib/prompts/compose.ts` の `PROMPT_TARGETS` にフォーマッタ（`image` / `video`）を追加します。データは `Prompt.target` ごとに保存される設計です。

## デプロイ時の注意

- Vercel等のサーバーレス環境ではローカルディスクが揮発するため `STORAGE_DRIVER=s3` を使ってください。
- 現在アップロードはアプリ経由（multipart）です。Vercel のリクエストサイズ上限（4.5MB）を超える動画を扱う場合は、署名付きURLによる直接アップロードへの切り替えが必要です（次の改善候補）。自前サーバー（Node）ならそのまま動作します。
- AI解析は Server Action 内で実行されます（`maxDuration = 300` 秒）。

## MVPで意図的にやっていないこと

AI生成APIとの直接連携、決済、チーム・権限、SNS自動投稿、高度な分析。

## 次の改善候補

1. 採用版（クライアントOK版）フラグ — 「最新版」と「採用版」は実案件ではしばしば異なる
2. ツール別Promptフォーマット（Midjourney `--ar`、Kling/Veo のモーション記法）
3. 署名付きURLでの大容量直接アップロード
4. クライアント確認用の共有リンク（閲覧・コメントのみ）
5. ナレーション / BGM / 字幕の工程（ElevenLabs用テキスト書き出し）
