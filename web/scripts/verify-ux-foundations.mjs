import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Isolated browser fixtures: all non-preview requests are fulfilled locally.
// Never sends a user token, reads their browser profile, or writes to the real API.
const origin = process.env.UX_PREVIEW_ORIGIN || 'http://127.0.0.1:3100';
const executablePath = process.env.UX_BROWSER_PATH || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const output = process.env.UX_SCREENSHOTS || '/private/tmp/passo-ux-foundations';
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath, headless: true });
const dateKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d);
const today = dateKey(new Date());
const shift = (key, days) => { const d = new Date(`${key}T12:00:00+01:00`); d.setUTCDate(d.getUTCDate() + days); return dateKey(d); };
const monday = shift(today, -((new Date(`${today}T12:00:00`).getDay() + 6) % 7));
const nextMonday = shift(monday, 7);
const sessions = [
  { id: 'ux-run', date: today, title: 'Corsa facile', sport: 'running', plan_id: 'run' },
  { id: 'ux-strength', date: today, title: 'Forza e mobilità', sport: 'strength_training', plan_id: 'strength' },
  { id: 'ux-next', date: nextMonday, title: 'Lungo della prossima settimana', sport: 'running', plan_id: 'run' },
].map(s => ({ ...s, origin: 'manual', steps: [{ type: 'interval', duration_type: 'time', duration_value: 40 }] }));
const plan = { yamlText: '', sessions, filename: 'fixture.yaml', importedAt: new Date().toISOString(), planId: 'run', planName: 'Preparazione corsa', goal: null };
const plans = [
  { id: 'run', name: 'Preparazione corsa', sports: ['running'], is_active: true, sessions_count: 2, goal: null, imported_at: plan.importedAt },
  { id: 'strength', name: 'Forza complementare', sports: ['strength_training'], is_active: true, sessions_count: 1, goal: null, imported_at: plan.importedAt },
];
const activities = [
  { activity_id: '1', day: today, title: 'Corsa al parco', sport: 'running', family: 'run', label: 'Corsa', minutes: 42, distance_km: 7, source: 'garmin' },
  { activity_id: '2', day: shift(today, -1), title: 'Bici sul lago', sport: 'cycling', family: 'ride', label: 'Bici', minutes: 65, distance_km: 24, source: 'strava' },
];
let mode = 'normal';
const writes = [], errors = [], unknown = new Set();
const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.setBypassServiceWorker(true);
await page.emulateTimezone('Europe/Rome');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => localStorage.setItem('passo_dev_token', 'ux-fixture'));
page.on('pageerror', e => errors.push(e.message));
await page.setRequestInterception(true);
page.on('request', async req => {
  const url = new URL(req.url());
  if (!['http:', 'https:'].includes(url.protocol)) return req.continue();
  if (url.origin === origin && !url.pathname.startsWith('/api/')) return req.continue();
  const path = url.pathname.replace(/^\/api/, '');
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': '*' } });
  let data, status = 200;
  if (req.method() !== 'GET') writes.push({ path, method: req.method(), body: req.postData() });
  if (path === '/plan') data = { plan: mode === 'empty' ? null : plan };
  else if (path === '/plan/list') data = { plans: mode === 'empty' ? [] : plans, active_plan_ids: ['run', 'strength'] };
  else if (path === '/activities' && mode !== 'error') data = { activities: mode === 'empty' ? [] : activities };
  else if (path === '/garmin/status' || path === '/strava/status') data = { connected: false };
  else if (path === '/garmin/workouts') data = { workouts: [] };
  else if (path === '/garmin/activities') data = { activities: [] };
  else if (path === '/plan/adaptation') data = { adaptation: null };
  else if (path === '/goal') data = { goal: null };
  else if (path === '/checkins') data = { checkins: [] };
  else if (path === '/history/sync' || path.includes('/track') || path.includes('/events')) data = { ok: true };
  else if (path === '/plan/move-check') data = { warnings: [] };
  else if (path.startsWith('/plan/sessions/') && req.method() === 'PATCH') {
    const session = sessions.find(s => path.endsWith(s.id));
    Object.assign(session, JSON.parse(req.postData()));
    data = session;
  } else { unknown.add(path); status = 404; data = { category: 'server_error', message: 'Fixture non disponibile', details: [] }; }
  return req.respond({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: JSON.stringify(data) });
});
const go = async path => { await page.goto(origin + path, { waitUntil: 'networkidle0', timeout: 60000 }); await page.waitForSelector('.frame, .page-back', { timeout: 15000 }); };
const screenshot = async (name) => {
  // Allow the existing entry animations to settle before visual inspection.
  await new Promise(resolve => setTimeout(resolve, 800));
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: false });
};
const text = () => page.evaluate(() => document.body.innerText);
const click = async selector => { await page.click(selector); };
const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
try {
  await go('/activities');
  await page.waitForSelector('.activity-row');
  assert.equal(await page.$$eval('.bottombar .nav-link', els => els.length), 5);
  assert.equal(await page.$$eval('.activity-row', els => els.length), 2);
  await page.type('input[type=search]', 'Bici', { delay: 100 });
  await page.waitForFunction(() => document.querySelector('input[type=search]').value === 'Bici' && document.querySelectorAll('.activity-row').length === 1);
  assert(new URL(page.url()).searchParams.get('q') === 'Bici');
  await page.select('[data-track="activities.period"]', '90');
  await page.waitForFunction(() => location.search.includes('days=90'));
  await page.reload({ waitUntil: 'networkidle0' });
  assert((await text()).includes('Bici sul lago'));
  assert(!(await text()).includes('Corsa al parco'));
  for (const width of [360, 390, 430, 1440]) {
    await page.setViewport({ width, height: 900 });
    await noOverflow();
    await screenshot(`activities-${width}`);
  }
  await page.setViewport({ width: 390, height: 844 });
  await go('/today');
  await page.waitForFunction(() => document.body.innerText.includes('Corsa facile') && document.body.innerText.includes('Forza e mobilità'));
  await noOverflow();
  await screenshot('today-mobile');
  await go(`/week?date=${nextMonday}`);
  await page.waitForSelector('a[href*="/session/ux-next"]');
  await click('a[href*="/session/ux-next"]');
  await page.waitForSelector('.page-back');
  assert(new URL(page.url()).searchParams.get('from') === `/week?date=${nextMonday}`);
  await click('.page-back');
  await page.waitForSelector('.subnav');
  assert.equal(new URL(page.url()).searchParams.get('date'), nextMonday);
  const movedDate = shift(nextMonday, 1);
  await click('.week-move summary');
  await page.$eval('.week-move input[type=date]', (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, movedDate);
  await click('[data-track="week.move-confirm"]');
  await page.waitForFunction((day) => document.querySelector('a[href*="/session/ux-next"]')?.closest('[data-date]')?.dataset.date === day || !document.querySelector('.week-move[open]'), {}, movedDate);
  assert(writes.some(w => w.path === '/plan/sessions/ux-next' && JSON.parse(w.body).date === movedDate), 'move PATCH');
  assert(writes.some(w => w.path === '/plan/move-check'), 'move compatibility check');
  await screenshot('calendar-mobile');
  await go('/week/programs');
  await page.waitForSelector('.program-card');
  assert.equal(await page.$$eval('.program-card', els => els.length), 2);
  await noOverflow();
  await screenshot('programs-mobile');
  await page.setViewport({ width: 1440, height: 1000 });
  await screenshot('programs-desktop');
  assert(await page.evaluate(() => document.querySelector('main').getBoundingClientRect().left >= document.querySelector('.sidebar').getBoundingClientRect().right), 'sidebar overlaps content');
  await page.select('[data-track="programs.generation-target"]', 'strength');
  await click('[data-track="plan-generate-card.setconfirming-2"]');
  await click('[data-track="plan-generate-card.button"]');
  await page.waitForSelector('[data-track="plan-generate-card.generation-dismiss"]');
  assert(writes.some(w => w.path === '/plan/generate' && JSON.parse(w.body).plan_id === 'strength'), 'generation targets the selected program');
  assert(await page.$eval('[data-track="programs.generation-target"]', el => el.disabled && el.value === 'strength'), 'generation keeps its target visible');
  await click('[data-track="plan-generate-card.generation-dismiss"]');
  await go('/import?from=%2Fweek%2Fprograms');
  assert(await page.$('input[placeholder^="Nome del nuovo piano"]'), 'import defaults to a separate program');
  await click('.page-back');
  await page.waitForSelector('.program-card');
  assert.equal(new URL(page.url()).pathname, '/week/programs');
  await go('/week/goals');
  assert((await text()).includes('Obiettivi'));
  await go('/session/ux-run?from=https%3A%2F%2Fevil.example');
  assert.equal(await page.$eval('.page-back', el => new URL(el.href).origin), origin);
  // Empty fixtures must never migrate the previous cached fixture plan to the server.
  mode = 'empty';
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await go('/today');
  assert.equal(new URL(page.url()).pathname, '/today');
  assert((await text()).includes('programma'));
  await go('/week');
  assert.equal(new URL(page.url()).pathname, '/week');
  assert((await text()).includes('Costruisci la tua settimana'));
  await go('/activities');
  assert((await text()).includes('Il tuo storico inizia qui'));
  mode = 'error';
  await page.evaluate(() => localStorage.clear());
  await go('/activities');
  await page.waitForSelector('[data-track="activities.retry"]', { timeout: 15000 });
  assert(await page.$('[role=alert]'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', checks: ['responsive navigation 360/390/430/1440', 'activity search and persisted period', 'multi-session Today', 'calendar contextual return', 'explicit move and compatibility request', 'programs and goals', 'generation program targeting', 'separate-program import default', 'safe return destination', 'empty and error states', 'no browser runtime errors'], screenshots: output, fixtureWrites: writes.map(w => `${w.method} ${w.path}`), unsupportedFixtures: [...unknown] }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  console.error({ url: page.url(), pageErrors: errors, text: (await text()).slice(0, 2500), unsupportedFixtures: [...unknown] });
  throw error;
} finally { await browser.close(); }
