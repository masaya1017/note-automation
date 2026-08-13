// login_setup_auto.mjs — login_setup.mjs のEnterキー入力待ちを、
// ログイン完了の自動検知（/login から離脱 → /notes が正常表示）に置き換えた版。
// 非対話実行環境（自動化ツール経由）でセッションを保存するための補助スクリプト。
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false, channel: 'msedge' });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('https://note.com/login');

console.log('ブラウザでnote.comにログインしてください。ログイン完了を自動検知します（最大10分待機）。');

const deadline = Date.now() + 10 * 60 * 1000;
let loggedIn = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(2000);
  if (!page.url().includes('login')) {
    // /notes に遷移し、ログイン画面へリダイレクトされないか確認
    await page.goto('https://note.com/notes', { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1000);
    if (!page.url().includes('login')) {
      loggedIn = true;
      break;
    }
  }
}

if (!loggedIn) {
  console.error('タイムアウト: ログインが検知できませんでした。');
  await browser.close();
  process.exit(1);
}

await context.storageState({ path: 'note_storage_state.json' });
console.log('ログインを検知しました。note_storage_state.json を保存しました。');
await browser.close();
process.exit(0);
