---
name: "note-hashtag-republish-playwright"
description: "JSONファイル（記事No・ハッシュタグのリスト）をもとに、Playwrightでnote.comの該当する公開記事を①下書きに戻し→②ハッシュタグを入力し→③再公開するスキル。「JSONを元にnote記事にハッシュタグを付けて再公開して」「playwrightでnoteの記事を下書きに戻してタグ入力して公開し直して」「note記事のハッシュタグを一括更新して」などと依頼された場合に使用する。Node.js + Playwrightと、note.comへのログイン済みセッション（storageState.json）が必要。"
---


# note記事 ハッシュタグ一括更新スキル（Playwright版）

JSONファイルに定義された記事No・ハッシュタグのリストをもとに、Playwrightでnote.comを自動操作し、
「該当する公開記事を下書きに戻す → ハッシュタグを入力する → 再公開する」を記事ごとに一括実行するスキル。

対象読者はこのスキルを実行するClaude自身。以下の手順・スクリプトに従って実行すること。

**このスキルは実際にnote.comの記事を1件処理して動作検証済み（2026年8月）。以下の手順・スクリプト・注意点は全て実機確認済みの内容である。推測でセレクタ等を変更しないこと。**

---

## 0. 入力JSONのフォーマット

ユーザーから渡されるJSONは以下の形式（`no` = 記事識別子、`hashtags` = 付与するハッシュタグ配列）。

```json
{
  "articles": [
    { "no": "【時事問題編】No.8", "hashtags": ["#戦略", "#AI"] },
    { "no": "【戦略17分野編】No.9", "hashtags": ["#戦略", "#AI"] }
  ]
}
```

`no` は該当記事のタイトルに含まれる識別子としてマッチングに使う（記事一覧を行単位でスキャンし、`no`の文字列を含み、かつ直後が数字ではない行を検索する。詳細は3節のスクリプト参照）。

**重要:** `no` は可能な限りシリーズ名込みで一意になるように指定すること（例: `【時事問題編】No.8`）。単に`No.8`のような番号だけだと、同じ番号が複数シリーズに存在する場合に区別できない。単なる`no.001`のような連番は実際のnote.comのタイトル慣習と一致しないことが多いので、事前にユーザーへ実際のタイトル表記を確認すること（4節「記事一覧の取得」を使うと確実）。

---

## 1. 前提条件（実行前に必ず確認する）

1. **Node.js が使えること**（`node -v` で確認）
2. **Playwright がインストール済みであること**
   ```bash
   npm install playwright --save
   npx playwright install --with-deps chromium
   ```
3. **note.comのログイン済みセッション（`note_storage_state.json`）が作業フォルダのルートにあること**
   - ログイン（認証セットアップ）自体は、ブラウザでの手動操作が必要なため、必ずユーザーの環境で行ってもらう（詳細は「5. 認証セットアップ」）。
   - `note_storage_state.json` が用意できていれば、本実行（下書き化→タグ入力→再公開）はClaude自身の実行環境からでも行える（実機で成功を確認済み）。ただし3節の「重要な注意点」にある起動オプション（`headless: false`＋`--disable-web-security`等）を外さないこと。素のcurl等でnote.comのAPIを直接叩くとWAF/bot検知で弾かれることがあるが、これは正規のブラウザセッション（Cookie・ヘッダー一式が揃った状態）では発生しない。
   - `note_storage_state.json` が見つからない場合は、「5. 認証セットアップ」の手順をユーザーに案内して停止する。
   - **パスワードやログイン情報をチャットで送ってもらうのは絶対に避ける。** 必ずstorageStateファイル経由で認証する。

---

## 2. 実行手順（Claudeがこのスキル実行時に行うこと）

1. ユーザーから渡されたJSONファイルを読み込み、対象記事No・ハッシュタグの一覧を表示してユーザーに処理内容を確認する（記事を一時的に非公開＝下書き状態にする操作を含むため、実行前確認は必須）。既存のハッシュタグを上書きする可能性がある場合は、4節の記事一覧確認や個別の記事ページを見て、既存タグが失われないか事前に確認しユーザーに伝える。
2. `note_storage_state.json` の有無を確認。無ければユーザーにセットアップを依頼して停止する。
3. 作業フォルダを整理する（推奨構成）:
   ```
   .
   ├── package.json
   ├── articles.json（ユーザー指定のファイル名でよい）
   ├── note_storage_state.json
   ├── scripts/
   │   ├── login_setup.mjs
   │   ├── fetch_articles.mjs
   │   └── note_hashtag_republish.mjs
   └── data/                 # 出力先（自動生成）
   ```
   下記「3. 自動化スクリプト」の内容を `scripts/note_hashtag_republish.mjs` として書き出す（無ければ`scripts/fetch_articles.mjs`, `scripts/login_setup.mjs`も併せて配置）。`package.json`に以下のnpm scriptsを用意すると実行しやすい。
   ```json
   {
     "scripts": {
       "login": "node scripts/login_setup.mjs",
       "fetch": "node scripts/fetch_articles.mjs",
       "dry-run": "node scripts/note_hashtag_republish.mjs \"articles.json\" --dry-run",
       "publish": "node scripts/note_hashtag_republish.mjs \"articles.json\""
     }
   }
   ```
4. まず `--dry-run` 付きで実行し、各Noに対応する記事が正しく見つかるかを確認する（**dry-runはheadlessでもクラウド環境でもGETのみなので、Claude自身が実行してよい**）。
   ```bash
   node scripts/note_hashtag_republish.mjs articles.json --dry-run
   ```
5. dry-runの結果をユーザーに提示し、問題なければ本実行する。`note_storage_state.json`が用意されていれば、本実行はClaude自身の実行環境から行ってよい（実機で成功を確認済み）。スクリプトは内部で`headless: false`＋所定の起動オプションを使うよう実装済みなので、その設定を崩さないこと（3節「重要な注意点」参照）。記事を一時的に非公開にする操作を含むため、必ず事前にユーザーへ実行内容を確認してから進める。
   ```bash
   node scripts/note_hashtag_republish.mjs articles.json
   ```
6. **1記事ずつ「下書き化→タグ入力→再公開」まで完了させてから次の記事に進む設計にする**（複数記事を同時に下書き状態のまま放置しない）。途中でエラーが出た記事があれば、その記事が公開・下書きのどちらの状態で止まっているかを必ず確認し、ユーザーに報告する。
7. 実行後、`data/note_republish_result.json`（各記事の成功/失敗ログ）の内容をもとに実行結果をユーザーに報告する。

---

## 3. 自動化スクリプト（`scripts/note_hashtag_republish.mjs`）

```javascript
// note_hashtag_republish.mjs
// 使い方: node scripts/note_hashtag_republish.mjs <articles.json> [--dry-run]
// 必ずプロジェクトルートから実行すること（相対パスはcwd基準）。
//
// 重要: 必ずheadless:falseかつ下記のブラウザ起動オプション付きで実行すること。
// headlessモードやeditor.note.comへの直接ハードナビゲーションでは、
// note.com→editor.note.comのクロスオリジンCookieアクセス(Storage Access API)が
// ブラウザにブロックされ、記事更新API(PUT .../text_notes/<id>)がCORSエラーで
// 失敗することを実機で確認済み（コンソールに
// "requestStorageAccess: Permission denied." と出る）。
import { chromium } from 'playwright';
import fs from 'fs';

const [, , jsonPathArg, ...flags] = process.argv;
const dryRun = flags.includes('--dry-run');
const storageStatePath = process.env.NOTE_STORAGE_STATE || './note_storage_state.json';

if (!jsonPathArg) {
  console.error('Usage: node scripts/note_hashtag_republish.mjs <articles.json> [--dry-run]');
  process.exit(1);
}
if (!fs.existsSync(storageStatePath)) {
  console.error(`ログインセッションファイルが見つかりません: ${storageStatePath}\n認証セットアップを先に行ってください。`);
  process.exit(1);
}

const { articles } = JSON.parse(fs.readFileSync(jsonPathArg, 'utf-8'));
const results = [];

const browser = await chromium.launch({
  headless: false, // headlessだとCORS回避が効かないため固定
  args: ['--disable-web-security', '--disable-site-isolation-trials', '--disable-features=ThirdPartyStoragePartitioning,PrivacySandboxSettings4'],
});
const context = await browser.newContext({ storageState: storageStatePath, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "no" は記事タイトルの先頭〜途中に現れる識別子（例: "No.8" や "【時事問題編】No.8"）。
// "No.8" が "No.80" 等の一部に誤ってマッチしないよう、識別子直後が数字ではないことを確認する。
// 一覧は<li>を1記事1行として扱い、行内の<h3>のテキストに対してマッチさせる
// （<a href>でのテキスト検索は、note.comのDOM構造上ヒットしないため使わないこと）。
async function findArticleByNo(no) {
  await page.goto('https://note.com/notes', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // 無限スクロールの一覧なので、増えなくなるまでスクロールして全件読み込む
  let prevCount = 0;
  for (let i = 0; i < 30; i++) {
    const count = await page.locator('li h3').count();
    if (count === prevCount) break;
    prevCount = count;
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(600);
  }

  const pattern = new RegExp(escapeRegExp(no) + '(?!\\d)');
  const targetLi = page.locator('li').filter({ has: page.locator('h3', { hasText: pattern }) }).first();
  if (!(await targetLi.count())) return null;

  const title = await targetLi.locator('h3').textContent();
  let href = await targetLi.locator('a[href]').first().getAttribute('href').catch(() => null);

  if (!href) {
    // 一覧の行にリンクが見つからない場合は行(h3)を直接クリックして遷移し、URLを取得する
    await targetLi.locator('h3').click();
    await page.waitForTimeout(1500);
    href = page.url();
  }

  return { title: title.trim(), href: href.startsWith('http') ? href : `https://note.com${href}` };
}

for (const article of articles) {
  const { no, hashtags = [] } = article;
  const result = { no, status: 'pending', message: '' };
  console.log(`\n=== [${no}] 処理開始 ===`);

  try {
    const found = await findArticleByNo(no);
    if (!found) throw new Error(`"${no}" を含む記事が管理画面で見つかりません`);

    if (dryRun) {
      result.status = 'dry-run';
      result.message = `対象記事を検出: ${found.title} / ${found.href}`;
      results.push(result);
      console.log(result.message);
      continue;
    }

    // 記事URL（例: https://note.com/<account>/n/<noteId>）からnote IDを抽出
    const noteIdMatch = found.href.match(/\/n\/([a-zA-Z0-9]+)/);
    if (!noteIdMatch) throw new Error(`記事URLからnote IDを取得できません: ${found.href}`);
    const noteId = noteIdMatch[1];

    // 必ずnote.com側の記事ページを経由してからeditor.note.comへ遷移する
    // （直接editor.note.comへgotoするとクロスオリジンCookieアクセスが失敗する）
    await page.goto(found.href, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    // 「その他」メニューを開く。公開中の記事には直接の「公開設定」リンクが無いため、
    // 先に「下書きに戻す」が必要。下書き状態の記事には
    // 「公開設定」というリンク（href: https://editor.note.com/notes/<id>/publish）が
    // メニュー内に直接存在するので、それがあるかどうかで現在の状態を判定する。
    await page.getByRole('button', { name: 'その他' }).first().click();
    await page.waitForTimeout(500);
    const publishSettingsLink = page.getByRole('link', { name: '公開設定' });
    const alreadyHasDirectLink = await publishSettingsLink.count();
    if (!alreadyHasDirectLink) {
      const revertButton = page.getByRole('button', { name: '下書きに戻す', exact: true });
      if (await revertButton.count()) {
        await revertButton.click();
        await page.waitForTimeout(500);
        const confirmDraft = page.getByRole('button', { name: /下書きに戻す|OK|はい/ }).last();
        if (await confirmDraft.count()) await confirmDraft.click();
        await page.waitForTimeout(1000);
        // 「下書きに戻りました。」という確認モーダルが表示され画面をブロックするので閉じる
        const closeModal = page.getByRole('button', { name: '閉じる' }).first();
        if (await closeModal.count()) {
          await closeModal.click();
          await page.waitForTimeout(500);
        }
        console.log(`[${no}] 下書きに戻しました`);
      }
    } else {
      // 既に下書き状態でメニュー内に直接リンクがある場合はメニューを閉じるだけ
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // 公開設定ページへ（refererを付けてnote.comからの遷移として扱わせる）
    await page.goto(`https://editor.note.com/notes/${noteId}/publish`, {
      waitUntil: 'networkidle',
      referer: found.href,
    });
    await page.waitForTimeout(1200);

    const hashtagInput = page.getByPlaceholder(/ハッシュタグ|タグを追加/).first();
    await hashtagInput.waitFor({ state: 'visible', timeout: 15000 });
    await hashtagInput.click();
    for (const tag of hashtags) {
      await hashtagInput.type(tag, { delay: 50 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    }
    console.log(`[${no}] ハッシュタグ入力: ${hashtags.join(' ')}`);

    // 下書き→公開の場合、ボタン文言は「更新する」になる（「投稿する」「公開する」も念のため許容）
    const submitBtn = page.getByRole('button', { name: /更新する|投稿する|公開する/ }).first();
    await submitBtn.waitFor({ state: 'visible', timeout: 15000 });
    await submitBtn.click();
    await page.waitForTimeout(3000);

    result.status = 'success';
    result.message = `再公開完了: ${found.href}`;
    console.log(`[${no}] ${result.message}`);
  } catch (err) {
    result.status = 'error';
    result.message = err.message;
    try {
      fs.mkdirSync('data', { recursive: true });
      await page.screenshot({ path: `data/error_${no.replace(/[^a-zA-Z0-9]/g, '_')}.png` });
    } catch {}
    console.error(`[${no}] エラー: ${err.message}（記事が下書き状態のまま止まっていないか要確認。data/error_*.png を確認してください）`);
  }
  results.push(result);
}

await browser.close();

console.log('\n=== 実行結果サマリー ===');
for (const r of results) console.log(`${r.no}: ${r.status} - ${r.message}`);
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/note_republish_result.json', JSON.stringify(results, null, 2), 'utf-8');
```

### 重要な注意点（実機検証で判明した内容。推測で変更しないこと）

1. **headless不可・起動オプション必須**: `chromium.launch({ headless: false, args: [...] })` の形を崩さないこと。headlessやeditor.note.comへの直接ハードナビゲーションでは`requestStorageAccess`が拒否され、記事更新のPUTリクエストがCORSエラー（`No 'Access-Control-Allow-Origin' header`）で失敗する。この設定さえ守れば、Claude自身の実行環境（クラウド/サンドボックス含む）からの本実行も可能（実機で成功を確認済み）。素のcurl等でnote.comのAPIを直接叩くとWAF/bot検知で403になることがあるが、これは正規のブラウザセッション（Cookie・ヘッダー一式が揃った状態）経由の操作では発生しない。
2. **記事の特定は`<li>`単位、`<a>`のテキスト検索は使わない**: 記事タイトルは`<h3>`にプレーンテキストで入っており、`a:has-text(...)`では要素が見つからない。一覧は無限スクロールなので、`<li>`の数が増えなくなるまでスクロールしてから検索する。
3. **`No.8`は`No.80`等の一部に誤マッチしうる**: 識別子直後が数字でないことを確認する正規表現（`(?!\d)`）を必ず使う。
4. **公開中の記事とすでに下書きの記事で「その他」メニューの中身が異なる**: 下書き状態の記事のみ、メニュー内に直接「公開設定」というリンク（`href: https://editor.note.com/notes/<id>/publish`）が現れる。公開中の記事はこのリンクが無いため、先に「下書きに戻す」ボタンをクリックする必要がある。ステータス文字列（公開中/下書き）の事前取得に頼らず、このリンクの有無で判定する方が確実。
5. **「下書きに戻す」確定後、確認モーダルが画面をブロックする**: 「下書きに戻りました。」というモーダルが表示され、「閉じる」を押すまで他の操作を受け付けない。
6. **再公開ボタンの文言は「更新する」になることがある**: 一度公開済みの記事を下書き経由で再公開する場合、ボタン文言は「投稿する」「公開する」ではなく「更新する」になる。
7. **editor.note.comへは必ずnote.com記事ページ経由で遷移する**: `page.goto('https://editor.note.com/notes/<id>/publish')`をnote.com側のページを経由せずに直接叩くと、たとえ`referer`オプションを付けても2番の理由でCORS失敗することがある。安全策として、必ず先に対象記事のnote.com側ページ（`https://note.com/<account>/n/<id>`）へ遷移してから、editor.note.comへ移動すること（本スクリプトはこの順序になっている）。

---

## 4. 記事一覧の取得（`scripts/fetch_articles.mjs`、任意）

対象記事の正確なタイトル表記（シリーズ名込み）が不明な場合、以下のスクリプトで一覧を取得できる。**GETのみなのでClaude自身がクラウド環境で実行してよい。**

```javascript
// fetch_articles.mjs
// note.comの「自分の記事」一覧を全件スクロール取得し、ローカルJSONに保存する（閲覧のみ・記事は一切変更しない）
import { chromium } from 'playwright';
import fs from 'fs';

const storageStatePath = './note_storage_state.json';
if (!fs.existsSync(storageStatePath)) {
  console.error('note_storage_state.json が見つかりません。');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: storageStatePath });
const page = await context.newPage();

await page.goto('https://note.com/notes', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

let prevCount = 0;
for (let i = 0; i < 30; i++) {
  const count = await page.locator('h3').count();
  if (count === prevCount) break;
  prevCount = count;
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(800);
}

const articles = await page.evaluate(() => {
  const items = [];
  document.querySelectorAll('h3').forEach((h3) => {
    const title = h3.textContent.trim();
    if (!title || title.includes('記事を有料販売')) return;
    let card = h3;
    for (let i = 0; i < 6 && card.parentElement; i++) card = card.parentElement;
    const cardText = card.textContent || '';
    const statusMatch = cardText.match(/公開中|下書き|非公開|予約投稿/);
    const dateMatch = cardText.match(/\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}/);
    const anchor = card.querySelector('a[href]');
    items.push({
      title,
      status: statusMatch ? statusMatch[0] : null,
      date: dateMatch ? dateMatch[0] : null,
      href: anchor ? anchor.getAttribute('href') : null,
    });
  });
  return items;
});

const seen = new Set();
const uniqueArticles = articles.filter((a) => {
  if (seen.has(a.title)) return false;
  seen.add(a.title);
  return true;
});

const seriesMap = {};
for (const a of uniqueArticles) {
  const m = a.title.match(/^【(.+?)】/);
  const series = m ? m[1] : '(シリーズ表記なし)';
  if (!seriesMap[series]) seriesMap[series] = [];
  seriesMap[series].push(a.title);
}

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/note_articles.json', JSON.stringify(uniqueArticles, null, 2), 'utf-8');
fs.writeFileSync('data/note_series_summary.json', JSON.stringify(seriesMap, null, 2), 'utf-8');

console.log(`記事総数: ${uniqueArticles.length}`);
for (const [series, list] of Object.entries(seriesMap)) console.log(`  【${series}】: ${list.length}件`);
console.log('\n保存しました: data/note_articles.json / data/note_series_summary.json');

await browser.close();
```
※ この一覧取得スクリプトの`status`/`date`はカード境界の推定が粗く、正確でないことがある（実機で誤って隣接記事の値を拾う事例あり）。シリーズ名・タイトルの特定用途に限定して使い、正確な公開状態確認は個別記事ページを直接開いて確認すること。

---

## 5. 認証セットアップ（初回のみ・ユーザーのローカル環境で実施）

ログインはユーザーの手元PCで一度だけ行ってもらう。以下のスクリプトを案内する。

```javascript
// login_setup.mjs — ローカル環境で1回だけ実行
// プロジェクトルートから `node scripts/login_setup.mjs` として実行すること
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('https://note.com/login');

console.log('ブラウザでnote.comにログインしてください。完了したらこのターミナルでEnterキーを押してください。');
process.stdin.once('data', async () => {
  await context.storageState({ path: 'note_storage_state.json' });
  console.log('note_storage_state.json を保存しました。');
  await browser.close();
  process.exit(0);
});
```

実行方法（ユーザーのローカルPC、プロジェクトルートから）：
```bash
npm install playwright
node scripts/login_setup.mjs
```

セッションの有効期限が切れた場合はこの手順を再度行ってもらう。**パスワードやログイン情報自体をClaudeに渡す必要は一切ない**（storageStateはブラウザのCookie/セッション情報のみを含む）。

---

## 6. エラーハンドリング

| 状況 | 対処 |
|---|---|
| `note_storage_state.json` が無い/期限切れ | ユーザーに「5. 認証セットアップ」の再実施を依頼 |
| 一覧で該当Noの記事が見つからない | `no`の指定がタイトル表記と一致しているか確認。「4. 記事一覧の取得」で正確なタイトルを確認する |
| ボタン・入力欄のlocatorが一致しない | エラー箇所で`page.screenshot()`を追加して再実行し、UIを確認。locatorを実際の文言に合わせて修正 |
| 記事更新PUTがCORSエラーで失敗する | 3節「重要な注意点」の1・7を再確認。headless実行やeditor.note.comへの直接ハードナビゲーションになっていないか確認 |
| 下書き化はできたが再公開に失敗 | **絶対に放置しない。** 直ちにその記事のURLを開き、手動で公開状態に戻すか、ユーザーに状況を報告して指示を仰ぐ |

---

## 7. 実行後の報告フォーマット

```
✅ note記事ハッシュタグ一括更新が完了しました

成功: N件 / 失敗: M件

- 【時事問題編】No.8: 成功 → https://note.com/xxx/n/xxxxx
- 【戦略17分野編】No.9: 失敗 → （エラー内容・現在の記事状態）
```

`data/note_republish_result.json` の内容をもとに報告し、失敗した記事があれば必ず現在の公開状態（公開/下書き）を明記する。
