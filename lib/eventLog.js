const fs = require('fs/promises');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// Serializes writes per day-file so concurrent requests can't race on the
// same read-modify-write and silently drop each other's entries.
const writeQueues = new Map();

function dailyLogPath(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `${y}-${m}-${d}.json`);
}

async function readEntries(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    // Corrupt file: quarantine it for inspection instead of silently
    // discarding whatever was already logged today.
    try {
      await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`);
    } catch {
      // If even that fails there's nothing more we can safely do here.
    }
    return [];
  }
}

async function writeEntriesAtomically(filePath, entries) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(entries, null, 2));
  await fs.rename(tempPath, filePath);
}

/**
 * Appends one entry to today's logs/<YYYY-MM-DD>.json array.
 * Fire-and-forget from the caller's point of view: logging must never be
 * allowed to fail a real transmit request, so errors here are swallowed
 * after being reported to the console.
 */
function logEvent(entry) {
  const filePath = dailyLogPath();
  const previous = writeQueues.get(filePath) || Promise.resolve();

  const next = previous
    .catch(() => {})
    .then(async () => {
      const entries = await readEntries(filePath);
      entries.push({ timestamp: new Date().toISOString(), ...entry });
      await writeEntriesAtomically(filePath, entries);
    })
    .catch((err) => {
      console.error('Failed to write event log entry:', err);
    });

  writeQueues.set(filePath, next);
  return next;
}

module.exports = { logEvent, dailyLogPath };
