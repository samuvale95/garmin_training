import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';

// Screenshot pass over the redesigned screens with local fixtures only: every request
// that is not the preview's own page/asset is answered here, nothing reaches a real API.
const origin = process.env.UX_PREVIEW_ORIGIN || 'http://127.0.0.1:3101';
const executablePath = process.env.UX_BROWSER_PATH || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const output = process.env.UX_SCREENSHOTS || '/private/tmp/passo-redesign';
const only = process.env.UX_ONLY ? process.env.UX_ONLY.split(',') : null;
const widths = (process.env.UX_WIDTHS || '390,1440').split(',').map(Number);
await mkdir(output, { recursive: true });

const dateKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d);
const today = dateKey(new Date());
const shift = (key, days) => { const d = new Date(`${key}T12:00:00+01:00`); d.setUTCDate(d.getUTCDate() + days); return dateKey(d); };
const monday = shift(today, -((new Date(`${today}T12:00:00`).getDay() + 6) % 7));
const run = (min, pace = 330) => [{ type: 'warmup', duration_type: 'time', duration_value: 10 }, { type: 'interval', duration_type: 'time', duration_value: min, target_pace: { slower_sec_per_km: pace + 10, faster_sec_per_km: pace - 10 } }, { type: 'cooldown', duration_type: 'time', duration_value: 5 }];
const reps = [{ type: 'warmup', duration_type: 'time', duration_value: 15 }, { reps: 6, steps: [{ type: 'interval', duration_type: 'distance', duration_value: 1, target_pace: { slower_sec_per_km: 260, faster_sec_per_km: 250 } }, { type: 'recovery', duration_type: 'time', duration_value: 2 }] }, { type: 'cooldown', duration_type: 'time', duration_value: 10 }];
const sessions = [
  { id: 's1', date: monday, title: 'Fondo lento', sport: 'running', steps: run(40) },
  { id: 's2', date: shift(monday, 1), title: 'Forza: gambe e core', sport: 'strength_training', steps: [{ type: 'interval', duration_type: 'time', duration_value: 45 }] },
  { id: 's3', date: shift(monday, 2), title: 'Ripetute 6 × 1 km', sport: 'running', priority: 'key', steps: reps, short_variant: { title: 'Ripetute 4 × 1 km', steps: reps } },
  { id: 's4', date: today, title: 'Corsa facile con allunghi', sport: 'running', steps: run(35) },
  { id: 's5', date: today, title: 'Mobilità e core', sport: 'calisthenics', steps: [{ type: 'interval', duration_type: 'time', duration_value: 20 }] },
  { id: 's6', date: shift(today, 1), title: 'Bici in pianura', sport: 'cycling', steps: [{ type: 'interval', duration_type: 'time', duration_value: 75 }] },
  { id: 's7', date: shift(monday, 6), title: 'Lungo progressivo', sport: 'running', steps: run(95, 345) },
  { id: 's8', date: shift(monday, 8), title: 'Fondo lento', sport: 'running', steps: run(45) },
].map(s => ({ origin: 'manual', plan_id: 'run', description: null, ...s }));
const plan = { yamlText: '', sessions, filename: 'autunno.yaml', importedAt: new Date().toISOString(), planId: 'run', planName: 'Mezza di primavera', goal: null };
const plans = [
  { id: 'run', name: 'Mezza di primavera', sports: ['running'], is_active: true, sessions_count: 7, goal: null, imported_at: plan.importedAt },
  { id: 'strength', name: 'Forza complementare', sports: ['strength_training', 'calisthenics'], is_active: true, sessions_count: 2, goal: null, imported_at: plan.importedAt },
];
const activities = [
  { activity_id: 1, day: shift(today, -1), title: 'Ripetute al parco', sport: 'running', family: 'run', label: 'Corsa', start_time: null, minutes: 52, distance_km: 10.4, kcal: 600, source: 'garmin' },
  { activity_id: 2, day: shift(today, -2), title: 'Bici sul lago', sport: 'cycling', family: 'ride', label: 'Bici', start_time: null, minutes: 95, distance_km: 41.2, kcal: 900, source: 'strava' },
  { activity_id: 3, day: shift(today, -3), title: 'Forza in palestra', sport: 'strength_training', family: 'strength', label: 'Forza', start_time: null, minutes: 48, distance_km: null, kcal: 300, source: 'garmin' },
  { activity_id: 4, day: shift(today, -9), title: 'Lungo domenicale', sport: 'running', family: 'run', label: 'Corsa', start_time: null, minutes: 102, distance_km: 18.1, kcal: 1100, source: 'garmin' },
  { activity_id: 5, day: shift(today, -40), title: 'Escursione', sport: 'hiking', family: 'hike', label: 'Escursione', start_time: null, minutes: 180, distance_km: 11, kcal: 900, source: 'strava' },
];
const unknown = new Set();
const errors = [];
const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
await page.setBypassServiceWorker(true);
await page.emulateTimezone('Europe/Rome');
await page.evaluateOnNewDocument(() => { localStorage.setItem('passo_dev_token', 'ux-fixture'); });
page.on('pageerror', e => errors.push(e.message));
await page.setRequestInterception(true);
page.on('request', req => {
  const url = new URL(req.url());
  if (!['http:', 'https:'].includes(url.protocol)) return req.continue();
  if (url.origin === origin) return req.continue();
  if (url.hostname.includes('fonts.g')) return req.continue();
  const path = url.pathname.replace(/^\/api/, '');
  const cors = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': '*' };
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
  let data, status = 200;
  if (path === '/plan') data = { plan };
  else if (path === '/plan/list') data = { plans, active_plan_ids: ['run', 'strength'] };
  else if (path === '/activities') data = { activities };
  else if (path === '/body/today') data = { date: today, has_overnight_data: true, readiness_score: 64, readiness_message: 'Recupero discreto, carico recente in aumento', readiness_level: 'MODERATE', readiness_factors: [], sleep: { deep_minutes: 82, light_minutes: 230, rem_minutes: 95, awake_minutes: 18, total_minutes: 425, score: 78, score_label: 'Buono' }, hrv_last_night_ms: 52, hrv_seven_day: Array.from({ length: 7 }, (_, i) => ({ date: shift(today, i - 6), value_ms: 48 + (i % 3) * 3 })), resting_heart_rate: 51, resting_heart_rate_delta: 2, battery_percent: 68, stress_level: 31, overnight_reliability: 'affidabile' };
  else if (path === '/garmin/status') data = { connected: true, session_expires_in_days: 21 };
  else if (path === '/strava/status') data = { connected: false };
  else if (path === '/garmin/workouts') data = { workouts: [] };
  else if (path === '/garmin/activities') data = { activities: [] };
  else if (path === '/plan/adaptation') data = { adaptation: null };
  else if (path === '/goal') data = { goal: null };
  else if (path === '/checkins') data = { checkins: [] };
  else if (path === '/programs/drafts') data = { drafts: [] };
  else if (path === '/goals') data = { goals: [] };
  else if (path === '/history/sync' || path.includes('/track') || path.includes('/events')) data = { ok: true };
  else { unknown.add(path); status = 404; data = { category: 'server_error', message: 'Fixture non disponibile', details: [] }; }
  return req.respond({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(data) });
});
const routes = [
  ['today', '/today'], ['week', '/week'], ['programs', '/week/programs'], ['goals', '/week/goals'],
  ['activities', '/activities'], ['trend', '/activities?view=trend'], ['body', '/body'], ['nutrition', '/nutrition'],
  ['settings', '/settings'], ['session', '/session/s3?from=%2Fweek'],
  ['edit', '/session/s3/edit'], ['new-program', '/week/programs/new'], ['coach', '/coach?from=%2Factivities'], ['summary', '/summary'],
  ['load', '/body/load'], ['diff', '/diff'], ['fuel-diary', '/body/fuel/diario'], ['entry', '/'], ['new-session', '/week/new?from=%2Fweek'],
];
for (const width of widths) {
  await page.setViewport({ width, height: width < 800 ? 844 : 900, deviceScaleFactor: 1 });
  for (const [name, path] of routes) {
    if (only && !only.includes(name)) continue;
    await page.goto(origin + path, { waitUntil: 'networkidle0', timeout: 90000 }).catch(e => errors.push(`${name}: ${e.message}`));
    await new Promise(r => setTimeout(r, 1200));
    if (process.env.UX_EVAL) console.log(name, width, await page.evaluate(process.env.UX_EVAL));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) errors.push(`${name}@${width}: horizontal overflow`);
    await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
  }
}
console.log(JSON.stringify({ unknown: [...unknown], errors }, null, 1));
await browser.close();
