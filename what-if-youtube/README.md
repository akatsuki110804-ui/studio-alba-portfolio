# What If Lab — AI動画制作パイプライン（MVP）

科学シミュレーションチャンネル「What If Lab」の制作工程（企画 → 調査 → 台本 → 絵コンテ → 素材 → ナレーション → 編集 → Shorts → サムネイル → 品質検査）を、工程ごとに独立したPython処理として実行するツールです。

- 途中で止まっても `state.json` とキャッシュで**完了済み工程を再実行せずに再開**します。
- 素材が揃っていない状態では**最終書き出しを拒否**します。確認用には `--animatic` で「PENDING」と明示した下書きを出力します。
- すべての生成・費用を `reports/cost_ledger.csv` に記録し、予算を超えそうなら停止します。
- 自動投稿は行いません。出力はローカルのファイルのみで、**公開前に人が必ず確認**します。
- **静止画は使いません。** 全カットが「AI動画（Higgsfield / Kling）」か「コードで描くモーショングラフィック」のどちらかです。
- 言語は `channel.language`（初期値 `ja`）。日本語ナレーションは VOICEVOX、英語は Kokoro を使います。

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
│   ├── motion.py             モーショングラフィック（20種類。棒グラフ・軌道・潮の断面・回る地球など）
│   ├── diagrams.py           静止図解（旧方式。互換用）
│   ├── voice.py              STEP6 ナレーション（VOICEVOX / Kokoro、文単位キャッシュ、読み確認リスト）
│   ├── editor.py             STEP7 FFmpeg編集・字幕・BGM・ラウドネス
│   ├── shorts.py             STEP8 縦型Shorts
│   ├── thumbnail.py          STEP9 サムネイル（背景＋文字を別工程で合成）
│   ├── quality_check.py      STEP10 自動QC・プレビュー
│   └── cost_tracker.py       費用台帳・予算ガード
├── assets_library/geo/     Natural Earth の陸地データ（パブリックドメイン。地球の描画に使用）
├── projects/<slug>/          動画ごとの成果物（plan, research, scripts, storyboard, assets, audio, subtitles, output, reports …）
└── tests/                    単体テスト（pytest）
```

## セットアップ

```bash
cd what-if-youtube
pip install -r requirements.txt          # FFmpeg 6 以上（libass 付き）も必要
G=https://github.com

# 日本語フォント（Noto Sans JP, OFL）
mkdir -p models/fonts && curl -L -o /tmp/nsjp.zip $G/notofonts/noto-cjk/releases/download/Sans2.004/16_NotoSansJP.zip \
  && python -m zipfile -e /tmp/nsjp.zip models/fonts

# 日本語ナレーション（VOICEVOX CORE 0.16）
mkdir -p models/voicevox/vvms && cd models/voicevox
curl -LO $G/VOICEVOX/voicevox_core/releases/download/0.16.2/voicevox_core-0.16.2-cp310-abi3-manylinux_2_34_x86_64.whl
pip install voicevox_core-0.16.2-cp310-abi3-manylinux_2_34_x86_64.whl
curl -L $G/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-linux-x64-1.17.3.tgz | tar xz
curl -L $G/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz | tar xz
curl -L -o vvms/1.vvm $G/VOICEVOX/voicevox_vvm/releases/download/0.16.3/1.vvm   # 冥鳴ひまり
curl -L -o vvms/4.vvm $G/VOICEVOX/voicevox_vvm/releases/download/0.16.3/4.vvm   # 玄野武宏
cd ../..

# 英語ナレーション（任意。channel.language: en のとき）
mkdir -p models/kokoro
curl -L -o models/kokoro/kokoro-v1.0.onnx $G/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o models/kokoro/voices-v1.0.bin  $G/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

python -m pytest tests -q
```

**VOICEVOX のクレジット表記（必須）:** 動画の概要欄に「VOICEVOX:冥鳴ひまり」（設定の `voice.voicevox.credit`）を記載してください。エンドカードにも自動で入ります。声を変える場合は `vvm` と `style_id` を変更し、[各キャラクターの利用規約](https://github.com/VOICEVOX/voicevox_vvm)を確認してください（例：青山龍星は企業が関わる利用に事前確認が必要）。

**読みの確認:** ナレーション生成時に `audio/readings.md`（全文のカタカナ読み）を書き出します。誤読は `voice.readings` に「表記: よみ」を追加すると、字幕はそのままで音声だけ直ります。

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

### モーショングラフィックの種類

絵コンテで `asset_type: motion` のカットは `diagram: {type, params}` で指定します。種類：`title`, `legend`, `timeline`, `barycenter`, `bar_compare`, `orbit`, `log_scale`, `night_sky`, `particles`, `tide_section`, `sea`, `spring_neap`, `number_cards`, `globe`, `tilt`, `range_compare`, `precession`, `solar_system`, `seasons`, `climate_bands`（詳細は `src/motion.py`）。画面下部は字幕用に空けてあります。AI動画が5秒より長いカットを埋める場合は、動き補間で最大1.6倍までスローにします（`assets.video_max_slowdown`）。

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
| 動画 | Higgsfield `kling3_0` std 5秒・無音 | 7.5 credit / 本（最安。turbo も同額） |
| サムネ背景 | Higgsfield `gpt_image_2_5` 16:9 | 0.25 credit / 枚 |
| ナレーション | VOICEVOX / Kokoro（ローカル） | 0円 |
| モーショングラフィック・編集・字幕・BGM | Pillow / NumPy / FFmpeg / 自作パッド | 0円 |

円換算は `budget.credit_to_jpy`（初期値 7.4円。Plus プラン $59 / 1,200 credit を第三者記事から推定）で、**推定値**として記録します。月間上限10,000円、動画あたり2,500円、工程別上限は `config/settings.yaml` で変更できます。

## 権利・安全

- APIキーはコードに書かず、`.env`（Git管理外）で管理します。
- ナレーション：VOICEVOX（キャラクターごとの規約に従いクレジット表記）、Kokoro-82M（Apache-2.0）。フォント：Noto Sans JP（OFL）。地図：Natural Earth（パブリックドメイン）。BGM：コードで生成した自作アンビエント（第三者の権利なし）。差し替える場合は商用利用可能と確認できたファイルのみを `audio.music` に指定してください。
- Higgsfield の生成物は利用規約上、商用利用が可能とされています（ヘルプセンターの記載）。公開前に最新の規約を確認してください。
- 他チャンネルの台本・映像・サムネイルを参照・模倣しないでください。
