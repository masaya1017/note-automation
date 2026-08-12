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

    // タイトル要素の近傍からステータス・日付・リンクを推定
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

// タイトル重複除去（同じタイトルが複数階層で拾われる場合があるため）
const seen = new Set();
const uniqueArticles = articles.filter((a) => {
  const key = a.title;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// 【シリーズ名】を抽出して集計
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
console.log('シリーズ一覧:');
for (const [series, list] of Object.entries(seriesMap)) {
  console.log(`  【${series}】: ${list.length}件`);
}
console.log('\n保存しました: data/note_articles.json / data/note_series_summary.json');

await browser.close();
