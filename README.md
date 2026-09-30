# Studio ALBA ポートフォリオサイト

AI動画制作(Studio ALBA)のポートフォリオサイトです。

> **Content Studio（AIコンテンツ制作ワークスペース MVP）** は `content-studio/` にある独立した Next.js アプリです。
> ポートフォリオとは依存関係もデプロイも別です。詳しくは [`content-studio/README.md`](content-studio/README.md) を参照してください。

## 技術スタック
- Next.js 14 (App Router)
- Tailwind CSS
- Vercel(ホスティング)

## フォルダ構成
```
app/
  page.js        トップページ
  works/page.js  実績一覧ページ
  about/page.js  制作の流れ・自己紹介
  contact/page.js お問い合わせ
  layout.js      共通のナビ・フッター
  globals.css    全体のスタイル・フォント読み込み
public/images/   画像・動画サムネイルの置き場所
tailwind.config.js  配色・フォントなどデザインの設定
```

## ローカルで動かす手順
1. Node.js(18以上)をインストール
2. このフォルダで以下を実行

```bash
npm install
npm run dev
```

3. ブラウザで http://localhost:3000 を開く

## GitHubへのアップロード
```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/ユーザー名/リポジトリ名.git
git push -u origin main
```

## Vercelへのデプロイ
1. https://vercel.com にログイン(GitHubアカウントでOK)
2. 「Add New Project」→ 今作ったGitHubリポジトリを選択
3. 設定はそのままで「Deploy」を押すだけで公開完了

## 今後カスタマイズしたい箇所
- `public/images/` に実績のサムネイル画像や動画を追加
- `app/works/page.js` の works配列に実績を追加
- `tailwind.config.js` の色(gold, teal, inkなど)を変えると全体の配色を調整できる
