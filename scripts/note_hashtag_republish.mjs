// note_hashtag_republish.mjs
// 使い方: node note_hashtag_republish.mjs <articles.json> [--dry-run]
//
// 必ずローカルPC(ログインセットアップを行った環境)のヘッドフル(非headless)モードで実行すること。
// headlessモードやeditor.note.comへの直接ハードナビゲーションでは、
// note.com→editor.note.comのクロスオリジンCookieアクセス(Storage Access API)が
// ブロックされ、更新APIがCORSエラーで失敗することを確認済み。
// --disable-web-security 等のフラグでこれを回避している。
import { chromium } from 'playwright';
import fs from 'fs';

const [, , jsonPathArg, ...flags] = process.argv;
const dryRun = flags.includes('--dry-run');
const storageStatePath = process.env.NOTE_STORAGE_STATE || './note_storage_state.json';

if (!jsonPathArg) {
  console.error('Usage: node note_hashtag_republish.mjs <articles.json> [--dry-run]');
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
  channel: 'msedge',
  args: ['--disable-web-security', '--disable-site-isolation-trials', '--disable-features=ThirdPartyStoragePartitioning,PrivacySandboxSettings4'],
});
const context = await browser.newContext({ storageState: storageStatePath, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "no" は記事タイトルの先頭〜途中に現れる識別子（例: "No.8" や "【時事問題編】No.8"）。
// "No.8" が "No.80" 等の一部に誤ってマッチしないよう、識別子直後が数字ではないことを確認する。
async function findArticleByNo(no) {
  await page.goto('https://note.com/notes', { waitUntil: 'networkidle' });
  await page.locator('li h3').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);

  let prevCount = -1;
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
    // 下書き等でリンクが無い場合は行を直接クリックして遷移し、URLを取得する
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

    // 記事ページ（note.com側）を経由してから編集用の公開設定ページへ
    // ※直接editor.note.comへ遷移するとクロスオリジンCookieアクセスが失敗するため、必ずnote.com側を経由する
    const noteIdMatch = found.href.match(/\/n\/([a-zA-Z0-9]+)/);
    if (!noteIdMatch) throw new Error(`記事URLからnote IDを取得できません: ${found.href}`);
    const noteId = noteIdMatch[1];

    await page.goto(found.href, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    // 公開中の記事は「その他」メニューに直接の公開設定リンクが無いため、先に下書きに戻す必要がある
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
        const closeModal = page.getByRole('button', { name: '閉じる' }).first();
        if (await closeModal.count()) {
          await closeModal.click();
          await page.waitForTimeout(500);
        }
        console.log(`[${no}] 下書きに戻しました`);
      }
    } else {
      // メニューを閉じる
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

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
