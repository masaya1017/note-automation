// login_setup.mjs — ローカル環境で1回だけ実行
// 必ずプロジェクトルートから `node scripts/login_setup.mjs`（または npm run login）で実行すること
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
