import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Isolated browser fixtures: all non-preview requests are fulfilled locally.
// Never sends a user token, reads their browser profile, or writes to the real API.
const origin = process.env.UX_PREVIEW_ORIGIN || 'http://127.0.0.1:3101';
const executablePath = process.env.UX_BROWSER_PATH || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const output = process.env.UX_SCREENSHOTS || '/private/tmp/passo-complete-experience';
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
let constraints={revision:1,available_days:[0,1,2,3,4,5,6],max_daily_minutes:120,max_sessions_per_day:2};
const goals=[{id:'goal-consistency',revision:1,type:'consistency',name:'Allenarmi tre volte a settimana',description:'Una frequenza sostenibile',sports:['running'],priority:'primary',status:'active',review_interval_days:28,review_date:shift(today,28),success_criterion:{metric:'sessions_per_week',target:3,unit:'sedute/settimana'},linked_program_ids:['run']}];
const drafts=new Map();
const draftSessions=[{...sessions[0],id:undefined,date:shift(today,1),title:'Corsa proposta',steps:[{type:'interval',duration_type:'time',duration_value:35}]}];
drafts.set('fixture-draft',{id:'fixture-draft',revision:1,status:'draft',name:'Corsa sostenibile',source:'ai',mode:'new',target_plan_id:null,goal_id:'goal-consistency',inputs:{sports:['running'],start_date:shift(today,1),user_prompt:'Mantieni il lungo esistente'},original_yaml:null,sessions:draftSessions,skeleton:null,validation:null,result:null,error:null});
let food=[];
const total=()=>({entries:food.length,kcal:food.reduce((s,e)=>s+(e.kcal||0),0),carb_g:0,protein_g:0,fat_g:0});
const target=(date)=>({date,session_title:null,load:'riposo',duration_minutes:null,carb_g_per_kg:[3,4],protein_g_per_kg:[1.5,1.8],fat_g_per_kg:[.8,1],carb_g:[210,280],protein_g:[105,126],fat_g:[56,70],sport:null,energy:null});
const fuel=(date)=>({date,weight_kg:70,weight_source:'profile',today:target(date),tomorrow:target(shift(date,1)),advice:'Mantieni pasti regolari e adeguati alla giornata.',meals:[{key:'breakfast',name:'Colazione',clock:'08:00',timing:'Mattina',carb_g:55,protein_g:20,portions:[{food:'Yogurt',grams:170,note:null},{food:'Pane',grams:70,note:null}],note:null,role:null},{key:'lunch',name:'Pranzo',clock:'13:00',timing:'Mezzogiorno',carb_g:80,protein_g:30,portions:[{food:'Riso',grams:100,note:'a crudo'}],note:null,role:null},{key:'dinner',name:'Cena',clock:'20:00',timing:'Sera',carb_g:70,protein_g:30,portions:[{food:'Patate',grams:250,note:null}],note:null,role:null}],during:null,recovery:null,narrative:null,session_slot:null,session_clock:null});
const writes=[],errors=[],unknown=new Set();
const context=await browser.createBrowserContext();const page=await context.newPage();
await page.setBypassServiceWorker(true);await page.emulateTimezone('Europe/Rome');await page.setViewport({width:390,height:844,deviceScaleFactor:1});
await page.evaluateOnNewDocument(()=>localStorage.setItem('passo_dev_token','ux-fixture'));
page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
page.on('request',async req=>{
 const url=new URL(req.url());if(!['http:','https:'].includes(url.protocol))return req.continue();
 if(url.origin===origin&&!url.pathname.startsWith('/api/'))return req.continue();
 const path=url.pathname.replace(/^\/api/,'');if(req.method()==='OPTIONS')return req.respond({status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','access-control-allow-headers':'*'}});
 const method=req.method();if(method!=='GET')writes.push({path,method,body:req.postData()});
 let data,status=200;let body={};try{body=JSON.parse(req.postData()||'{}');}catch{}
 if(path==='/plan')data={plan:mode==='empty'?null:plan};
 else if(path==='/plan/list')data={plans:mode==='empty'?[]:plans,active_plan_ids:['run','strength']};
 else if(path==='/plan/drafts'&&method==='GET')data={drafts:[...drafts.values()]};
 else if(path==='/plan/drafts'&&method==='POST'){data={...body,id:`created-draft-${drafts.size}`,revision:1,status:'draft',sessions:body.source==='import'?draftSessions:[],skeleton:null,validation:null,result:null,error:null};drafts.set(data.id,data);}
 else if(path.startsWith('/plan/drafts/')){const [, , , id,action]=path.split('/');const d=drafts.get(id);if(!d){status=404;data={message:'Bozza non trovata'};}else if(method==='GET')data=d;else if(action==='generate'){if(body.expected_revision!==d.revision){status=422;data={category:'validation_failed',message:'expected_revision richiesto',details:[]};}else{Object.assign(d,{sessions:draftSessions,revision:d.revision+1,status:'draft',generation_result:{source:'ai'}});data=d;}}else if(action==='validate'){d.revision++;d.status='ready';d.validation={token:`fixture-validation-${d.revision}`,status:mode==='conflict'?'conflict':'insufficient_data',reviewed_on:today,conflicts:mode==='conflict'?[{code:'daily_minutes',date:shift(today,1),message:'Superato il tempo disponibile'}]:[],warnings:[],missing_data:['Carico fisiologico confrontabile fra sport non disponibile'],impact:{added:d.sessions,removed:[],preserved:sessions,programs:plans.map(({id,name,is_active})=>({id,name,is_active}))}};data=d;}else if(action==='activate'){if(mode==='stale'){status=409;data={category:'validation_failed',message:'Il calendario è cambiato. Ripeti la verifica.',details:[]};}else if(d.status!=='active'){d.status='active';d.revision++;d.result={draft_id:d.id,plan_id:'new-plan',sessions_count:d.sessions.length,status:'active'};}if(mode!=='stale')data=d.result;}else{Object.assign(d,body,{revision:d.revision+1,validation:null});data=d;}}
 else if(path==='/plan/constraints'){if(method==='PUT')constraints={...body,revision:constraints.revision+1};data=constraints;}
 else if(path==='/goals'){if(method==='POST'){data={...body,id:'created-goal',revision:1,status:'active',linked_program_ids:[]};goals.push(data);}else data={goals};}
 else if(path.endsWith('/evaluations'))data=method==='GET'?{evaluations:[]}:{id:'evaluation',status:'insufficient_data',evaluated_at:new Date().toISOString(),execution:{message:'Attività e sedute non abbinate'},progress:{status:'insufficient_data'},quality:{missing_data:['Storico incompleto']}};
 else if(path.match(/^\/plan\/[^/]+\/goals$/))data={context_revision:1,primary_goal_id:'goal-consistency',contributing_goal_ids:[]};
 else if(path==='/body/today')data={date:today,has_overnight_data:false,readiness_score:null,readiness_message:null,readiness_level:null,readiness_factors:[],sleep:null,hrv_last_night_ms:null,hrv_seven_day:[],resting_heart_rate:null,resting_heart_rate_delta:null,battery_percent:null,stress_level:null};
 else if(path==='/nutrition/targets'){if(mode==='nutrition-error'){status=500;data={category:'server_error',message:'Indicazioni non disponibili',details:[]};}else data=fuel(body.date||today);}
 else if(path==='/nutrition/narrative')data={text:'Indicazioni della giornata basate sulle sedute previste.'};
 else if(path==='/nutrition/day')data={date:url.searchParams.get('date'),entries:food.filter(e=>e.date===url.searchParams.get('date')),totals:total()};
 else if(path==='/nutrition/entries')data={entries:food};
 else if(path==='/nutrition/entry'||path==='/nutrition/confirm'){data={id:food.length+1,date:body.date,logged_at:new Date().toISOString(),source:'manual',description:body.description,kcal:body.kcal,carb_g:body.carb_g,protein_g:body.protein_g,fat_g:body.fat_g,confidence:null,corrected:true,portion:1,image_url:null};food.push(data);}
 else if(path==='/athlete/level'||path==='/level')data={level:1};
 else if(path==='/activities')data={activities:mode==='empty'?[]:activities};
 else if(path==='/garmin/status'||path==='/strava/status')data={connected:false};
 else if(path==='/garmin/workouts')data={workouts:[]};
 else if(path==='/garmin/activities')data={activities:[]};
 else if(path==='/plan/adaptation')data={adaptation:null};
 else if(path==='/goal')data={goal:null};
 else if(path==='/checkins')data={checkins:[]};
 else if(path==='/history/sync'||path.includes('/track')||path.includes('/events'))data={ok:true};
 else if(path==='/plan/move-check')data={warnings:[]};
 else if(path.startsWith('/plan/sessions/')&&method==='PATCH'){const s=sessions.find(s=>path.endsWith(s.id));Object.assign(s,body);data=s;}
 else{unknown.add(path);status=404;data={category:'server_error',message:'Fixture non disponibile',details:[]};}
 return req.respond({status,contentType:'application/json',headers:{'access-control-allow-origin':origin},body:JSON.stringify(data)});
});
const go=async path=>{await page.goto(origin+path,{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector('.frame, .page-back',{timeout:15000});};
const screenshot=async name=>{await new Promise(r=>setTimeout(r,500));await page.screenshot({path:`${output}/${name}.png`,fullPage:false});};
const text=()=>page.evaluate(()=>document.body.innerText);
const click=async selector=>{
 await page.waitForSelector(selector);
 // Keep mobile controls clear of the fixed tab bar before sending a real click.
 await page.$eval(selector,e=>e.scrollIntoView({behavior:'instant',block:'center'}));
 await new Promise(r=>setTimeout(r,250));
 await page.click(selector);
};
const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
try{
 if(!process.env.UX_JOURNEYS_ONLY)for(const [route,label]of[['/today','today'],['/body','recovery'],['/nutrition','nutrition-plan'],[`/nutrition?date=${shift(today,-1)}&view=diary`,'nutrition-diary'],['/week/programs','programs'],['/week/programs/new?source=ai','wizard'],['/week/programs/drafts/fixture-draft','draft-review'],['/week/goals','goals']]){await go(route);for(const width of [390,1440]){await page.setViewport({width,height:900});await noOverflow();await screenshot(`${label}-${width}`);}}
 await page.setViewport({width:390,height:844});await go('/body');assert.equal(new URL(page.url()).pathname,'/body');assert((await text()).includes('Oggi'));assert((await text()).includes('Tendenze'));
 await go(`/nutrition?date=${shift(today,-1)}&view=diary&log=1&from=%2Ftoday`);await click('[data-track="nutrition.text-manual"]');await page.waitForSelector('[data-track="meal-flow-screens.submit"]');await screenshot('meal-compose-390');
 await go('/week/programs/drafts/fixture-draft');await click('[data-track="draft.validate"]');await page.waitForSelector('[data-track="draft.acknowledge-limits"]');assert(await page.$eval('[data-track="draft.activate-preview"]',e=>e.getAttribute('aria-disabled')==='true'));await screenshot('draft-insufficient-data-390');await click('[data-track="draft.acknowledge-limits"]');await page.waitForSelector('[data-track="draft.activate-preview"]:not([aria-disabled])');await click('[data-track="draft.activate-preview"]');await page.waitForSelector('[data-track="draft.activate-confirm"]');await screenshot('draft-activation-confirm-390');await click('[data-track="draft.activate-confirm"]');await page.waitForFunction(()=>document.body.innerText.includes('Programma aggiunto al calendario'));assert.equal(writes.filter(w=>w.path.includes('/activate')).length,1);assert(!writes.some(w=>w.path==='/plan/sync'),'activation does not publish Garmin');await screenshot('draft-activated-390');
 // Create through both entry paths, then leave and resume the durable server draft.
 for(const source of ['ai','import']){
  await page.evaluate(()=>sessionStorage.clear());await go(`/week/programs/new?source=${source}`);
  await page.type('[data-track="program-new.name"]',`Fixture ${source}`);
  await page.select('[data-track="program-new.goal"]','goal-consistency');
  if(source==='import')await page.type('[data-track="program-new.yaml"]',`sessions:\n  - date: ${shift(today,1)}\n    sport: running\n    title: Corsa proposta`);
  await click('[data-track="program-new.next"]');await click('[data-track="program-new.next"]');await click('[data-track="program-new.next"]');
  await click('[data-track="program-new.save-draft"]');await page.waitForSelector('[data-track="draft.edit-details"]');
  const id=new URL(page.url()).pathname.split('/').at(-1);assert(drafts.has(id));assert.equal(drafts.get(id).goal_id,'goal-consistency');
  await go('/week/programs');await go(`/week/programs/drafts/${id}`);assert((await text()).includes(`Fixture ${source}`));
  if(source==='ai'){await click('[data-track="draft.generate"]');await page.waitForFunction(()=>document.body.innerText.includes('Corsa proposta'));assert.equal(JSON.parse(writes.findLast(w=>w.path.endsWith('/generate')).body).expected_revision,1);}
  else assert(drafts.get(id).original_yaml.includes('Corsa proposta'));
  mode='conflict';await click('[data-track="draft.validate"]');await page.waitForFunction(()=>document.body.innerText.includes('Superato il tempo disponibile'));assert(await page.$eval('[data-track="draft.activate-preview"]',e=>e.getAttribute('aria-disabled')==='true'));
  mode='normal';await click('[data-track="draft.validate"]');await page.waitForSelector('[data-track="draft.acknowledge-limits"]');await click('[data-track="draft.acknowledge-limits"]');await click('[data-track="draft.activate-preview"]');await page.waitForSelector('[data-track="draft.activate-confirm"]');
  if(source==='ai'){
   mode='stale';await click('[data-track="draft.activate-confirm"]');await page.waitForFunction(()=>document.body.innerText.includes('Il calendario è cambiato'));assert(await page.$eval('[data-track="draft.activate-preview"]',e=>e.getAttribute('aria-disabled')==='true'));
   mode='normal';await click('[data-track="draft.validate"]');await page.waitForFunction(()=>!document.querySelector('[data-track="draft.acknowledge-limits"]').checked);assert(await page.$eval('[data-track="draft.activate-preview"]',e=>e.getAttribute('aria-disabled')==='true'));await click('[data-track="draft.acknowledge-limits"]');await page.waitForSelector('[data-track="draft.activate-preview"]:not([aria-disabled])');await click('[data-track="draft.activate-preview"]');await page.waitForSelector('[data-track="draft.activate-confirm"]');
  }
  await click('[data-track="draft.activate-confirm"]');await page.waitForFunction(()=>document.body.innerText.includes('Programma aggiunto al calendario'));
 }
 assert(!writes.some(w=>w.path==='/plan/sync'),'no journey publishes to Garmin');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',screenshots:output,checks:[...(process.env.UX_JOURNEYS_ONLY?[]:['daily routes mobile/desktop']),'nutrition shared date and diary','review-before-activation','explicit insufficient-data acknowledgement','activation separate from Garmin','AI/import create and durable resume','generation revision','goal association','conflict block','stale context and revalidation','acknowledgement bound to current review token'],unsupportedFixtures:[...unknown],fixtureWrites:writes.map(w=>`${w.method} ${w.path}`)},null,2));
}catch(error){await page.screenshot({path:`${output}/failure.png`,fullPage:true}).catch(()=>{});console.error({url:page.url(),errors,text:(await text()).slice(0,3500),unknown:[...unknown]});throw error;}finally{await browser.close();}
