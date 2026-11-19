const fs = require('fs').promises;
const path = require('path');
const { DATA_ROOT } = require('../config');

/**
 * Remembers which invoice files the daily auto push has already re-sent, per
 * entity, so each invoice gets at most ONE automatic retry.
 *
 * Without this the job snowballs: a re-sent file is re-archived by the EBM
 * service into *today's* processedArchive folder, so tomorrow's run would pick
 * it up again alongside today's new invoices — and so on forever.
 *
 * Ledger file: DATA_ROOT/logs/daily-auto-push/ledger/<entityId>.json
 *   { version, entityId, files: { "<fileName>": { sentAt, sourceFolder } } }
 *
 * Keyed by file name, because the EBM service re-archives a re-sent file under
 * the same name. Entries older than RESEND_LEDGER_RETENTION_DAYS are pruned:
 * by then the file can no longer turn up in "yesterday's" folder.
 */
const DAILY_LOGS_DIR = path.join(DATA_ROOT, 'logs', 'daily-auto-push');
const LEDGER_DIR = path.join(DAILY_LOGS_DIR, 'ledger');
const RETENTION_DAYS = Number(process.env.RESEND_LEDGER_RETENTION_DAYS) || 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function ledgerPath(entityId) {
  return path.join(LEDGER_DIR, `${entityId}.json`);
}

/**
 * First-time seed: the job ran before the ledger existed, so recover every
 * file it already re-sent from the per-day run logs. Otherwise the files moved
 * during those runs would all be pushed again on the next run.
 */
async function seedFromDailyLogs(entityId) {
  const files = {};
  let years;
  try {
    years = await fs.readdir(DAILY_LOGS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return files;
    throw err;
  }

  for (const year of years.filter((y) => /^\d{4}$/.test(y))) {
    const months = await fs.readdir(path.join(DAILY_LOGS_DIR, year)).catch(() => []);
    for (const month of months.filter((m) => /^\d{2}$/.test(m))) {
      const days = await fs.readdir(path.join(DAILY_LOGS_DIR, year, month)).catch(() => []);
      for (const dayFile of days.filter((d) => /^\d{2}\.json$/.test(d))) {
        let runs;
        try {
          runs = JSON.parse(await fs.readFile(path.join(DAILY_LOGS_DIR, year, month, dayFile), 'utf8'));
        } catch {
          continue; // A corrupt log shouldn't block the job; skip it.
        }
        if (!Array.isArray(runs)) continue;

        for (const run of runs) {
          if (run.entityId !== entityId || !Array.isArray(run.processed)) continue;
          for (const item of run.processed) {
            if (item.status !== 'success' || !item.originalFile) continue;
            files[item.originalFile] = {
              sentAt: run.timestamp || new Date().toISOString(),
              sourceFolder: run.date || null,
              seeded: true
            };
          }
        }
      }
    }
  }
  return files;
}

function prune(files, now = Date.now()) {
  const cutoff = now - RETENTION_DAYS * DAY_MS;
  for (const [name, entry] of Object.entries(files)) {
    const sentAt = Date.parse(entry.sentAt);
    if (!Number.isNaN(sentAt) && sentAt < cutoff) delete files[name];
  }
  return files;
}

/**
 * Loads the ledger for an entity. Returns an object with:
 *   has(fileName), record(fileName, sourceFolder), save()
 */
async function loadLedger(entityId) {
  const filePath = ledgerPath(entityId);
  let files;

  try {
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    files = data && typeof data.files === 'object' && data.files ? data.files : {};
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // A corrupt ledger must not silently reset to empty — that would re-send
      // every file in the folder. Fail loudly instead.
      const wrapped = new Error(`Resend ledger for ${entityId} is unreadable: ${err.message}`);
      wrapped.code = 'LEDGER_UNREADABLE';
      throw wrapped;
    }
    files = await seedFromDailyLogs(entityId);
  }

  prune(files);

  return {
    size: () => Object.keys(files).length,
    has: (fileName) => Object.prototype.hasOwnProperty.call(files, fileName),
    record(fileName, sourceFolder) {
      files[fileName] = { sentAt: new Date().toISOString(), sourceFolder };
    },
    async save() {
      await fs.mkdir(LEDGER_DIR, { recursive: true });
      // Write-then-rename so a crash mid-write can't leave a truncated ledger.
      const tmp = `${filePath}.tmp-${process.pid}`;
      await fs.writeFile(tmp, JSON.stringify({ version: 1, entityId, files }, null, 2));
      await fs.rename(tmp, filePath);
    }
  };
}

module.exports = { loadLedger, prune, RETENTION_DAYS, LEDGER_DIR };
