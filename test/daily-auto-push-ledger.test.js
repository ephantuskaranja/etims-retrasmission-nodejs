const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the app at a throwaway data root BEFORE config is loaded (dotenv
// does not override variables that are already set).
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'etims-ledger-'));
process.env.EBM_DATA_ROOT = ROOT;

const { processPreviousDayFiles, getYesterdayFolder } = require('../lib/dailyAutoPush');
const { getPaths, ENTITIES } = require('../config');
const { prune } = require('../lib/resendLedger');

const entityId = ENTITIES[0].id;
const { sourceDir, destDir } = getPaths(entityId);
const yesterdayDir = path.join(sourceDir, getYesterdayFolder());

function addInvoices(dir, names) {
  fs.mkdirSync(dir, { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(dir, n), JSON.stringify({ n }));
}

// Simulates the EBM service transmitting everything in the resend folder and
// re-archiving it (same file name) into the archive folder.
function ebmRetransmit(intoDir) {
  fs.mkdirSync(intoDir, { recursive: true });
  for (const n of fs.readdirSync(destDir)) {
    fs.renameSync(path.join(destDir, n), path.join(intoDir, n));
  }
}

const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test('each invoice is re-sent at most once — the daily batch does not snowball', async () => {
  // Day 1: yesterday's folder holds day-1 invoices.
  addInvoices(yesterdayDir, ['inv_1.json', 'inv_2.json']);
  const r1 = await processPreviousDayFiles(entityId);
  assert.equal(r1.summary.success, 2);
  assert.equal(r1.summary.skipped, 0);
  assert.deepEqual(list(destDir), ['inv_1.json', 'inv_2.json']);

  // EBM re-archives those into the folder the next run will read, alongside
  // genuinely new invoices.
  ebmRetransmit(yesterdayDir);
  addInvoices(yesterdayDir, ['inv_3.json']);

  // Day 2: only the new invoice is pushed; the re-sent ones stay archived.
  const r2 = await processPreviousDayFiles(entityId);
  assert.equal(r2.summary.success, 1);
  assert.equal(r2.summary.skipped, 2);
  assert.deepEqual(list(destDir), ['inv_3.json']);
  assert.deepEqual(list(yesterdayDir), ['inv_1.json', 'inv_2.json']);
  assert.ok(r2.skipped.every((s) => s.reason === 'ALREADY_RESENT'));
});

test('ledger is persisted on disk and read back on every run', async () => {
  const ledgerFile = path.join(ROOT, 'logs', 'daily-auto-push', 'ledger', `${entityId}.json`);
  const saved = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  assert.deepEqual(Object.keys(saved.files).sort(), ['inv_1.json', 'inv_2.json', 'inv_3.json']);

  ebmRetransmit(yesterdayDir);
  const r = await processPreviousDayFiles(entityId);
  assert.equal(r.summary.success, 0);
  assert.equal(r.summary.skipped, 3);
});

test('overlapping runs for the same entity are rejected', async () => {
  addInvoices(yesterdayDir, ['inv_4.json']);
  const [a, b] = await Promise.allSettled([
    processPreviousDayFiles(entityId),
    processPreviousDayFiles(entityId)
  ]);
  assert.equal(a.status, 'fulfilled');
  assert.equal(b.status, 'rejected');
  assert.equal(b.reason.code, 'DAILY_PUSH_IN_PROGRESS');
});

test('first run seeds the ledger from earlier daily run logs', async () => {
  const other = ENTITIES[1].id;
  const otherPaths = getPaths(other);
  const otherYesterday = path.join(otherPaths.sourceDir, getYesterdayFolder());

  // A log from before the ledger existed, recording an earlier re-send.
  const logDir = path.join(ROOT, 'logs', 'daily-auto-push', '2026', '11');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, '17.json'), JSON.stringify([
    {
      timestamp: new Date().toISOString(),
      entityId: other,
      date: '20261116',
      processed: [{ originalFile: 'old_1.json', status: 'success' }]
    }
  ]));

  addInvoices(otherYesterday, ['old_1.json', 'new_1.json']);
  const r = await processPreviousDayFiles(other);
  assert.equal(r.summary.success, 1);
  assert.deepEqual(r.skipped.map((s) => s.file), ['old_1.json']);
  assert.deepEqual(list(otherPaths.destDir), ['new_1.json']);
});

test('entries older than the retention window are pruned', () => {
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const files = { a: { sentAt: old }, b: { sentAt: new Date().toISOString() } };
  assert.deepEqual(Object.keys(prune(files)), ['b']);
});
