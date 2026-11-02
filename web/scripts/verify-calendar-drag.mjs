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
const realToday = dateKey(new Date());
const pivot = new Date(`${realToday}T12:00:00Z`);
pivot.setUTCDate(pivot.getUTCDate() + 2 - ((pivot.getUTCDay() + 6) % 7));
const today = pivot.toISOString().slice(0, 10);
const shift = (key, days) => { const d = new Date(`${key}T12:00:00+01:00`); d.setUTCDate(d.getUTCDate() + days); return dateKey(d); };
const monday = shift(today, -((new Date(`${today}T12:00:00`).getDay() + 6) % 7));
const nextMonday = shift(monday, 7);
const sessions = [
  { id: 'ux-run', date: shift(today,1), title: 'Corsa facile', sport: 'running', plan_id: 'run' },
  { id: 'ux-strength', date: shift(today,1), title: 'Forza e mobilità', sport: 'strength_training', plan_id: 'strength' },
  { id: 'ux-next', date: nextMonday, title: 'Lungo della prossima settimana', sport: 'running', plan_id: 'run' },
].map(s => ({ ...s, origin: 'manual', steps: [{ type: 'interval', duration_type: 'time', duration_value: 40 }] }));
const plan = { yamlText: '', sessions, filename: 'fixture.yaml', importedAt: new Date().toISOString(), planId: 'run', planName: 'Preparazione corsa', goal: null };
const plans = [
  { id: 'run', name: 'Preparazione corsa', sports: ['running'], is_active: true, sessions_count: 2, goal: null, imported_at: plan.importedAt },
  { id: 'strength', name: 'Forza complementare', sports: ['strength_training'], is_active: true, sessions_count: 1, goal: null, imported_at: plan.importedAt },
];
const activities = [];//
/*
  { activity_id: '1', day: today, title: 'Corsa al parco', sport: 'running', family: 'run', label: 'Corsa', minutes: 42, distance_km: 7, source: 'garmin' },
  { activity_id: '2', day: shift(today, -1), title: 'Bici sul lago', sport: 'cycling', family: 'ride', label: 'Bici', minutes: 65, distance_km: 24, source: 'strava' },
];
*/
let mode = 'normal';
let constraints={revision:1,available_days:[0,1,2,3,4,5,6],max_daily_minutes:120,max_sessions_per_day:2};
const goals=[{id:'goal-consistency',revision:1,type:'consistency',name:'Allenarmi tre volte a settimana',description:'Una frequenza sostenibile',sports:['running'],priority:'primary',status:'active',review_interval_days:28,review_date:shift(today,28),success_criterion:{metric:'sessions_per_week',target:3,unit:'sedute/settimana'},linked_program_ids:['run']}];
const drafts=new Map();
const draftSessions=[{...sessions[0],id:undefined,date:shift(today,1),title:'Corsa proposta',steps:[{type:'interval',duration_type:'time',duration_value:35}]}];
drafts.set('fixture-draft',{id:'fixture-draft',revision:1,status:'draft',name:'Corsa sostenibile',source:'ai',mode:'new',target_plan_id:null,goal_id:'goal-consistency',inputs:{sports:['running'],start_date:shift(today,1),user_prompt:'Mantieni il lungo esistente'},original_yaml:null,sessions:draftSessions,skeleton:null,validation:null,result:null,error:null});
goals.push(...[{id:'race-a',name:'Gara A',target_time_seconds:3661},{id:'race-b',name:'Gara B',target_time_seconds:7322}].map(g=>({...g,type:'race',revision:1,status:'active',race_date:shift(today,60),distance_km:21,linked_program_ids:[]})));
let food=[];let failMeal=false;
const total=()=>({entries:food.length,kcal:food.reduce((s,e)=>s+(e.kcal||0),0),carb_g:0,protein_g:0,fat_g:0});
const target=(date)=>({date,session_title:null,load:'riposo',duration_minutes:null,carb_g_per_kg:[3,4],protein_g_per_kg:[1.5,1.8],fat_g_per_kg:[.8,1],carb_g:[210,280],protein_g:[105,126],fat_g:[56,70],sport:null,energy:null});
const fuel=(date)=>({date,weight_kg:70,weight_source:'profile',today:target(date),tomorrow:target(shift(date,1)),advice:'Mantieni pasti regolari e adeguati alla giornata.',meals:[{key:'breakfast',name:'Colazione',clock:'08:00',timing:'Mattina',carb_g:55,protein_g:20,portions:[{food:'Yogurt',grams:170,note:null},{food:'Pane',grams:70,note:null}],note:null,role:null},{key:'lunch',name:'Pranzo',clock:'13:00',timing:'Mezzogiorno',carb_g:80,protein_g:30,portions:[{food:'Riso',grams:100,note:'a crudo'}],note:null,role:null},{key:'dinner',name:'Cena',clock:'20:00',timing:'Sera',carb_g:70,protein_g:30,portions:[{food:'Patate',grams:250,note:null}],note:null,role:null}],during:null,recovery:null,narrative:null,session_slot:null,session_clock:null});
const writes=[],errors=[],unknown=new Set();
const context=await browser.createBrowserContext();const page=await context.newPage();
await page.setBypassServiceWorker(true);await page.emulateTimezone('Europe/Rome');await page.setViewport({width:390,height:844,deviceScaleFactor:1});
await page.evaluateOnNewDocument(()=>localStorage.setItem('passo_dev_token','ux-fixture'));
await page.evaluateOnNewDocument(day => { const OriginalDate = Date; class FixtureDate extends OriginalDate { constructor(...args) { super(...(args.length ? args : [`${day}T12:00:00+01:00`])); } static now() { return new OriginalDate(`${day}T12:00:00+01:00`).valueOf(); } } window.Date = FixtureDate; }, today);
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
 else if((path==='/nutrition/entry'||path==='/nutrition/confirm')&&failMeal){status=500;data={category:'server_error',message:'Errore di prova',details:[]};failMeal=false;}
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
 else if(path.startsWith('/plan/sessions/')&&method==='PATCH'){if(mode==='fail'){status=500;data={message:'Errore di prova'};}else {const s=sessions.find(s=>path.endsWith(s.id));Object.assign(s,body);data=s;}}
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

const delay=ms=>new Promise(r=>setTimeout(r,ms)); const count=()=>writes.filter(w=>w.method==='PATCH').length;
const box=async()=>{const e=await page.$('.week-card');await e.evaluate(e=>e.scrollIntoView({block:'center'}));await delay(100);return e.boundingBox()};
const targetBox=async key=>(await page.$$('.calendar-day'))[(new Date(`${key}T12:00:00`).getDay()+6)%7].boundingBox();
const drag=async p=>{let b=await box();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await delay(400);await page.mouse.move(p.x,p.y,{steps:20});await page.mouse.up();await delay(500)};
try {
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await go('/today');await page.waitForFunction(()=>document.body.innerText.includes('Prossimo allenamento'));assert((await text()).includes('Apri allenamento di domani'));await noOverflow();await screenshot('today-tomorrow-mobile');
 await go('/week?view=list');await page.waitForSelector('.week-card');await screenshot('week-mobile');let cdp=await page.createCDPSession();let touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});let b=await box();let initial=await page.evaluate(()=>scrollY);await touch('touchStart',b.x+60,b.y+60);for(let i=1;i<=8;i++)await touch('touchMove',b.x+60,b.y+60-i*12);await touch('touchEnd');await delay(300);assert(await page.evaluate(()=>scrollY)>initial,'scroll');assert.equal(count(),0);
 b=await box();let t=await targetBox(shift(today,2));await touch('touchStart',b.x+b.width/2,b.y+b.height/2);await delay(400);for(let i=1;i<=20;i++)await touch('touchMove',b.x+b.width/2+(t.x+t.width/2-b.x-b.width/2)*i/20,b.y+b.height/2+(t.y+40-b.y-b.height/2)*i/20);await touch('touchEnd');await delay(600);assert.equal(count(),1);assert.equal(new URL(page.url()).pathname,'/week');assert.equal(JSON.parse(writes.findLast(w=>w.method==='PATCH').body).date,shift(today,2));
 for(const view of ['columns','list']){await page.setViewport({width:1440,height:900,isMobile:false,hasTouch:false});await go('/week?view='+view);await page.waitForSelector('.week-card');await screenshot('week-'+view);let n=count();b=await box();await drag({x:b.x+b.width/2,y:b.y+b.height/2+12});assert.equal(count(),n,'same day');await drag({x:5,y:150});assert.equal(count(),n,'outside');t=await targetBox(shift(today,-1));await drag({x:t.x+t.width/2,y:t.y+40});assert.equal(count(),n,'past');t=await targetBox(shift(today,view==='columns'?2:3));await drag({x:t.x+t.width/2,y:t.y+40});assert.equal(count(),n+1,view);assert.equal(new URL(page.url()).pathname,'/week');}
 mode='fail';await go('/week?view=columns');await page.waitForSelector('.week-card');t=await targetBox(shift(today,4));await drag({x:t.x+t.width/2,y:t.y+40});await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('non è stata salvata'));
 mode='normal';await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await go('/week?view=list');await page.waitForSelector('.week-card');b=await box();await touch('touchStart',b.x+30,b.y+30);await touch('touchEnd');await page.waitForFunction(()=>location.pathname.startsWith('/session/'));console.log('PASS: scroll, tap, touch, desktop drag, invalid drops, failed save');
} finally {await browser.close()}
