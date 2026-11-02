import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function loadTypeScript(path, mocks) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => mocks[name] ?? require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    keys: () => [...values.keys()],
  };
}

test('reset and logout clear account data without deleting the remote plan', async () => {
  const local = storage();
  const session = storage();
  const original = Object.fromEntries(['window', 'localStorage', 'sessionStorage'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.window = { localStorage: local, sessionStorage: session };
  globalThis.localStorage = local;
  globalThis.sessionStorage = session;
  // Browser Storage exposes its keys through Object.keys().
  for (const key of ['passo.return-history', 'passo-program-wizard:new', 'passo-editor:new:1', 'other-tab']) {
    session.setItem(key, 'saved');
    session[key] = 'saved';
  }
  for (const key of ['passo-plan', 'passo-device-state', 'passo-query-cache', 'passo-adaptation-checked', 'passo-events-queue', 'passo-tracking', 'passo_dev_token', 'sb-auth-token']) local.setItem(key, 'saved');

  const initial = { prefs: { menoMovimento: false }, profile: { name: '' }, writeJobHistory: [], manualWeight: null };
  let state = { ...initial, prefs: { menoMovimento: true }, profile: { name: 'A' }, writeJobHistory: [{ jobId: '1' }], manualWeight: { weightKg: 72 } };
  let persistClears = 0;
  let cacheClears = 0;
  let remoteDeletes = 0;
  const store = {
    getInitialState: () => initial,
    setState: (next) => { state = next; local.setItem('passo-device-state', JSON.stringify(next)); },
    persist: { clearStorage: () => { persistClears++; local.removeItem('passo-device-state'); } },
  };
  try {
    const tracker = loadTypeScript('../src/lib/tracker.ts', { './auth': { getAccessToken: async () => null } });
    const { clearLocalAccountData } = loadTypeScript('../src/lib/queries.ts', {
      react: {},
      '@tanstack/react-query': {},
      './apiClient': { apiDelete: () => { remoteDeletes++; } },
      './store': { usePassoStore: store },
      './tracker': tracker,
      './sessionVisuals': {},
    });
    clearLocalAccountData({ clear: () => { cacheClears++; } });
    assert.equal(remoteDeletes, 0);
    assert.equal(cacheClears, 1);
    assert.equal(persistClears, 1);
    assert.deepEqual(state, initial);
    for (const key of ['passo-plan', 'passo-device-state', 'passo-query-cache', 'passo-adaptation-checked', 'passo-events-queue']) assert.equal(local.getItem(key), null, key);
    for (const key of ['passo-tracking', 'passo_dev_token', 'sb-auth-token']) assert.equal(local.getItem(key), 'saved', key);
    for (const key of ['passo.return-history', 'passo-program-wizard:new', 'passo-editor:new:1']) assert.equal(session.getItem(key), null, key);
    assert.equal(session.getItem('other-tab'), 'saved');

    const { signOut } = loadTypeScript('../src/lib/auth.ts', {
      react: {},
      './supabaseClient': { supabase: { auth: { signOut: async () => ({ error: null }) } } },
    });
    await signOut();
    clearLocalAccountData({ clear: () => { cacheClears++; } });
    assert.equal(local.getItem('passo_dev_token'), null);
    assert.equal(remoteDeletes, 0);
    assert.equal(cacheClears, 2);
  } finally {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('failed sign-out retains the local session and reports the error', async () => {
  const local = storage();
  local.setItem('passo_dev_token', 'saved');
  const original = Object.fromEntries(['window', 'localStorage'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.window = {};
  globalThis.localStorage = local;
  try {
    const failure = new Error('sign-out failed');
    const { signOut } = loadTypeScript('../src/lib/auth.ts', {
      react: {},
      './supabaseClient': { supabase: { auth: { signOut: async () => ({ error: failure }) } } },
    });
    await assert.rejects(signOut(), failure);
    assert.equal(local.getItem('passo_dev_token'), 'saved');
  } finally {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
