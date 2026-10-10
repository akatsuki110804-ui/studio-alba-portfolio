# What If Science — AI動画制作パイプライン（MVP）

英語圏向け科学シミュレーションチャンネル「What If Science」の制作工程（企画 → 調査 → 台本 → 絵コンテ → 素材 → ナレーション → 編集 → Shorts → サムネイル → 品質検査）を、工程ごとに独立したPython処理として実行するツールです。

- 途中で止まっても `state.json` とキャッシュで**完了済み工程を再実行せずに再開**します。
- 素材が揃っていない状態では**最終書き出しを拒否**します。確認用には `--animatic` で「PENDING」と明示した下書きを出力します。
- すべての生成・費用を `reports/cost_ledger.csv` に記録し、予算を超えそうなら停止します。
- 自動投稿は行いません。出力はローカルのファイルのみで、**公開前に人が必ず確認**します。

## 構成

```
what-if-youtube/
├── config/settings.yaml      予算・解像度・音声・字幕などの設定
├── config/prompts.yaml       LLM工程のプロンプト
├── src/
│   ├── main.py               CLI（plan / produce / validate / assets / status）
│   ├── planning.py           STEP1-4 企画・調査・台本・絵コンテ・Shorts設計（仕様書の research.py / script_writer.py / storyboard.py を統合）
│   ├── llm.py, schemas.py    LLM実行（manual / anthropic）とJSONスキーマ検証
│   ├── asset_manager.py      STEP5 生成リクエスト・取り込み・リトライ上限・図解レンダリング
│   ├── diagrams.py           図解（Pillowで描画。数字を正確に表示）
│   ├── voice.py              STEP6 ナレーション（Kokoro TTS、文単位キャッシュ）
│   ├── editor.py             STEP7 FFmpeg編集・字幕・BGM・ラウドネス
│   ├── shorts.py             STEP8 縦型Shorts
│   ├── thumbnail.py          STEP9 サムネイル（背景＋文字を別工程で合成）
│   ├── quality_check.py      STEP10 自動QC・プレビュー
│   └── cost_tracker.py       費用台帳・予算ガード
├── projects/<slug>/          動画ごとの成果物（plan, research, scripts, storyboard, assets, audio, subtitles, output, reports …）
└── tests/                    単体テスト（pytest）
```

## セットアップ

```bash
cd what-if-youtube
pip install -r requirements.txt
# FFmpeg 6 以上（libass 付き）が必要です
mkdir -p models/kokoro
curl -L -o models/kokoro/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o models/kokoro/voices-v1.0.bin  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
python -m pytest tests -q
```

## 使い方

### 1. 企画〜絵コンテ（plan）

```bash
python -m src.main plan --topic "What If Earth Stopped Spinning?" --slug earth_stops
```

- `llm.provider: manual`（初期設定）の場合、各工程のプロンプトが `projects/<slug>/prompts/<stage>.prompt.md` に書き出され、終了コード3で停止します。Claude Code にそのプロンプトへの回答JSONを指定パスへ保存させ、同じコマンドを再実行すると次の工程へ進みます。調査工程では Claude Code の Web 検索で出典を確認してください。
- `llm.provider: anthropic` にすると Claude API（`claude-opus-5-5`、拒否時のサーバー側フォールバック有効）を直接呼びます。`ANTHROPIC_API_KEY` または `ant auth login` が必要で、**API料金が発生します**。
- 出力：`plan/plan.json`、`research/research.json` と `research/sources.md`（主張ごとに fact / inference / dramatization と確認状況）、`scripts/script.md`、`storyboard/storyboard.md`、`shorts/shorts.json`。
- 台本が未確認（unverified）の事実主張を参照している場合はエラーで止まります。
- サムネイル案は `thumbnails/thumbnails.json` に記述します（文字・強調語・背景プロンプト）。

### 2. 素材〜編集（produce）

```bash
python -m src.main produce --project earth_stops              # 素材が未完成なら停止（終了コード3）
python -m src.main produce --project earth_stops --animatic   # 未完成カットをPENDINGカードにした下書き
```

1. 図解・タイトルカードをローカル描画し、AI生成が必要な素材を `assets/requests.json`（最終プロンプト、モデル、推定クレジット）に書き出します。予算チェックで上限の80%を超える場合は `--confirm-spend` が必要です。
2. 画像・動画を生成します。Higgsfield は Claude Code の MCP 経由で使います（例：Claude Code に「requests.json の pending を生成して import して」と依頼）。Web版で手動生成したファイルも取り込めます。
   ```bash
   python -m src.main assets import --project earth_stops --id C02 --file ~/Downloads/c02.png --credits 0.25 --job-id <id>
   python -m src.main assets fail   --project earth_stops --id C02 --error "text artifacts"   # 失敗記録（上限で打ち切り）
   python -m src.main assets status --project earth_stops
   ```
   絵コンテのプロンプトを変えると、その素材は自動的に `stale`（作り直し対象）になります。
3. ナレーション（Kokoro、文単位キャッシュ）→ 長尺編集 → Shorts 3本 → サムネイル3案を順に作成します。

### 3. 品質検査（validate）

```bash
python -m src.main validate --project earth_stops
```

尺・解像度・音声の有無・ラウドネス（-14 LUFS ±1.5、TP ≤ -1 dB）・黒画面・無音・字幕の順序と行数・出典・素材エラー・費用を検査し、`reports/qc_report.md` と `previews/`（コンタクトシート、音声サンプル）を出力します。

### 再開・やり直し

- 同じコマンドを再実行すると、既存のLLM出力、キャッシュ済みの音声文、レンダリング済みセグメントは再利用されます。
- 特定工程の作り直し：`plan --project <slug> --force script storyboard`。
- 進行状況：`python -m src.main status --project <slug>`。

## 費用の考え方（初期設定）

| 工程 | 手段 | 単価（2026-10-10 に Higgsfield の get_cost で確認） |
|---|---|---|
| 台本など | Claude Code（manual）/ Claude API | manual は追加費用なし |
| 画像 | Higgsfield `gpt_image_2_5` 16:9 | 0.25 credit / 枚 |
| 動画 | Higgsfield `kling3_0` std 5秒・無音 | 7.5 credit / 本 |
| ナレーション | Kokoro（ローカル） | 0円 |
| 図解・編集・字幕・BGM | Pillow / FFmpeg / 自作パッド | 0円 |

円換算は `budget.credit_to_jpy`（初期値 7.4円。Plus プラン $59 / 1,200 credit を第三者記事から推定）で、**推定値**として記録します。月間上限10,000円、動画あたり2,500円、工程別上限は `config/settings.yaml` で変更できます。

## 権利・安全

- APIキーはコードに書かず、`.env`（Git管理外）で管理します。
- ナレーション：Kokoro-82M（Apache-2.0）。BGM：コードで生成した自作アンビエント（第三者の権利なし）。差し替える場合は商用利用可能と確認できたファイルのみを `audio.music` に指定してください。
- Higgsfield の生成物は利用規約上、商用利用が可能とされています（ヘルプセンターの記載）。公開前に最新の規約を確認してください。
- 他チャンネルの台本・映像・サムネイルを参照・模倣しないでください。
