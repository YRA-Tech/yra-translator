// Node smoke test for the extension's NLLB batch client logic.
//
// Loads the real content.js in a vm context with mocked window/document/chrome,
// then drives translateBatchNLLB through a fake background worker + server
// (via chrome.runtime.sendMessage) to verify chunking, map-back, cache keying,
// the size-mismatch guard, and the submit->poll round trip.
//
// Run:  node tests/batch-logic.test.mjs
//
// Note: this does NOT exercise a real browser, so it cannot settle the
// SameSite session-cookie question — that needs Chrome + a running monitor.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

process.on('unhandledRejection', () => {});

// --- Fake background worker + server, reached via chrome.runtime.sendMessage ---
let jobSeq = 0;
const jobs = new Map();          // jobId -> translated_texts[]
const submitCalls = [];          // captured request bodies
let forceMismatch = false;

const fakeTranslate = (t) => 'DE:' + t;

async function fakeSendMessage(msg) {
  if (!msg || msg.action !== 'nllbApiRequest') return undefined; // progress msgs, etc.
  const url = new URL(msg.url);
  // Mirror the background proxy's allowlist contract.
  assert.ok(url.origin === 'https://stage.yratech.com', 'unexpected origin ' + url.origin);

  if (msg.method === 'POST' && url.pathname === '/api/translate') {
    submitCalls.push(msg.body);
    const id = 'job-' + (++jobSeq);
    jobs.set(id, msg.body.texts.map(fakeTranslate));
    return { ok: true, status: 202, data: { job_id: id } };
  }
  if (msg.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
    const id = url.pathname.split('/').pop();
    let translated = jobs.get(id) || [];
    if (forceMismatch) translated = translated.slice(0, -1);
    return { ok: true, status: 200, data: { status: 'completed', result_payload: { translated_texts: translated } } };
  }
  return { ok: false, status: 404, data: null };
}

// --- Minimal browser/extension globals so content.js loads and constructs ---
const windowMock = { addEventListener() {}, removeEventListener() {}, postMessage() {}, Translator: undefined };
windowMock.top = windowMock; // not an iframe
const elMock = () => ({ setAttribute() {}, remove() {}, appendChild() {} });
const documentMock = {
  querySelector: () => null,
  createElement: () => elMock(),
  head: { appendChild() {} },
  documentElement: { appendChild() {} },
  body: { appendChild() {} },
};
const chromeMock = {
  runtime: { onMessage: { addListener() {} }, getURL: (p) => p, sendMessage: fakeSendMessage },
  storage: { local: { get: async () => ({}), set: async () => {} } },
};

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, URL,
  window: windowMock, document: documentMock, chrome: chromeMock, self: windowMock,
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'content.js' });

const t = sandbox.window.YRATranslator;
assert.ok(t, 'YRATranslator instance was created');
t.nllbApiBase = 'https://stage.yratech.com';

function reset() {
  submitCalls.length = 0;
  jobs.clear();
  jobSeq = 0;
  t.textTranslationCache = new Map();
  t.currentLanguagePair = 'nllb:eng_Latn-deu_Latn';
}

async function main() {
  // 1) chunking to <=200, map-back, cache keyed by language pair
  reset();
  const unique = Array.from({ length: 250 }, (_, i) => 'text-' + i);
  await t.translateBatchNLLB(unique, 'eng_Latn', 'deu_Latn');

  assert.equal(submitCalls.length, 2, '250 texts -> 2 chunks');
  assert.equal(submitCalls[0].texts.length, 200, 'first chunk = 200');
  assert.equal(submitCalls[1].texts.length, 50, 'second chunk = 50');
  assert.equal(submitCalls[0].source_language, 'eng_Latn');
  assert.equal(submitCalls[0].target_language, 'deu_Latn');
  assert.equal(t.textTranslationCache.size, 250, 'all 250 cached');
  assert.equal(t.textTranslationCache.get('nllb:eng_Latn-deu_Latn:text-0'), 'DE:text-0');
  assert.equal(t.textTranslationCache.get('nllb:eng_Latn-deu_Latn:text-249'), 'DE:text-249');
  console.log('PASS  chunk to <=200, map translated_texts back, cache keyed by language pair');

  // 2) size-mismatch guard
  reset();
  forceMismatch = true;
  let threw = false;
  try {
    await t.translateBatchNLLB(['a', 'b', 'c'], 'eng_Latn', 'deu_Latn');
  } catch (e) {
    threw = /size mismatch/i.test(e.message);
  }
  forceMismatch = false;
  assert.ok(threw, 'mismatched translated_texts length must throw');
  console.log('PASS  response size-mismatch raises');

  // 3) full submit -> poll round trip through the chrome.runtime.sendMessage proxy
  reset();
  await t.translateBatchNLLB(['Hello'], 'eng_Latn', 'deu_Latn');
  assert.equal(submitCalls.length, 1);
  assert.equal(t.textTranslationCache.get('nllb:eng_Latn-deu_Latn:Hello'), 'DE:Hello');
  console.log('PASS  submit -> poll round trip via background proxy contract');

  console.log('\nALL EXTENSION BATCH-LOGIC CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
