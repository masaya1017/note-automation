# note記事 ハッシュタグ一括更新

JSONファイルに記載した記事(識別子＋ハッシュタグ)を、note.comで「下書きに戻す→タグ入力→再公開」する自動化ツール。

## セットアップ（初回のみ）

```bash
npm install
npm run login
```

ブラウザが開くのでnote.comにログインし、ターミナルに戻ってEnterキーを押す。
`note_storage_state.json`（ログインセッション。**Git管理・共有厳禁**）が保存される。

対話的にEnterキーを押せない実行環境（自動化ツール経由など）の場合は、ログイン完了を自動検知する
`scripts/login_setup_auto.mjs` を使う（`node scripts/login_setup_auto.mjs`。最大10分待機し、
`/notes` へ正常遷移できた時点でセッションを自動保存する）。

**Microsoft Edgeがインストールされていること。** 本体スクリプトは`channel: 'msedge'`を指定してChromiumではなく
Edgeを起動する。

## 使い方

1. 対象記事とハッシュタグを `シンギュラリティ時代のCxO戦略論文シリーズ[時時問題編].json` に記入する

   ```json
   {
     "articles": [
       { "no": "【時事問題編】No.8", "hashtags": ["#戦略", "#AI"] }
     ]
   }
   ```

   `no` は記事タイトルに含まれる一意な文字列（シリーズ名込みを推奨。例: `【戦略17分野編】No.9` のように書けば同シリーズの他の号と誤認識しない）

2. まずdry-runで対象記事が正しく見つかるか確認（記事は無変更）

   ```bash
   npm run dry-run
   ```

3. 問題なければ本実行

   ```bash
   npm run publish
   ```

任意のJSONファイルを指定したい場合:

```bash
node scripts/note_hashtag_republish.mjs path/to/articles.json --dry-run
node scripts/note_hashtag_republish.mjs path/to/articles.json
```

現在の記事一覧・シリーズ構成を確認したいとき:

```bash
npm run fetch
```
→ `data/note_articles.json`, `data/note_series_summary.json` に保存される。

## 重要な注意事項

- **必ずローカルPCで、ヘッドレスにせず実行すること。** `editor.note.com` への直接アクセスや headless 実行では、note.comのログインCookieへのクロスオリジンアクセス（Storage Access API）がブラウザ側でブロックされ、更新APIがCORSエラーで失敗する。`scripts/note_hashtag_republish.mjs` はこれを回避する起動オプション付きで実装済み。
- クラウド/サンドボックス環境からは note.com のWAFに書き込み系リクエストがブロックされるため実行不可。
- 途中でエラーが出た場合、対象記事が「下書き」状態のまま止まっている可能性がある。`data/error_*.png` を確認し、note.com側で記事の状態を直接確認すること。
- `no` の指定はできるだけシリーズ名込みで一意になるようにする（例: `No.8` だけだと `No.80`〜`No.89` 等の一部に誤って一致しないよう末尾は数字境界チェック済みだが、同じ番号が複数シリーズに存在する場合は区別できない）。

## ファイル構成

```
.
├── シンギュラリティ時代のCxO戦略論文シリーズ[時時問題編].json  # 処理対象の指定
├── note_storage_state.json        # ログインセッション（Git管理禁止）
├── scripts/
│   ├── login_setup.mjs            # 初回ログイン・セッション保存（対話的にEnterキー入力）
│   ├── login_setup_auto.mjs       # ログイン完了を自動検知してセッション保存（非対話環境向け）
│   ├── fetch_articles.mjs         # 記事一覧・シリーズ構成の取得
│   └── note_hashtag_republish.mjs # 本体：下書き化→タグ入力→再公開
└── data/                          # 実行結果・取得データの出力先（自動生成）
```
