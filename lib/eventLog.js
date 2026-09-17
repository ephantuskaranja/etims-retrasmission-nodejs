const fs = require('fs/promises');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// Every file this module writes always ends with exactly these 2 bytes,
// which is what makes the fast append path below possible.
const TAIL = '\n]';
const TAIL_BYTES = Buffer.byteLength(TAIL);

// Serializes writes per day-file so concurrent requests can't race on the
// same append and corrupt or drop each other's entries.
const writeQueues = new Map();

function dailyLogPath(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `${y}-${m}-${d}.json`);
}

async function quarantine(filePath) {
  try {
    await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`);
  } catch {
    // If even that fails there's nothing more we can safely do here.
  }
}

async function createWithFirstEntry(filePath, line) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `[\n  ${line}${TAIL}`);
}

// Full read-modify-rewrite. Used only as a fallback: the first entry of a
// new day-file, or whenever the fast path's assumption about the file's
// exact trailing bytes doesn't hold (e.g. hand-edited file, older format).
// Self-healing — it rewrites the file back into the exact shape the fast
// path expects, so the next append can use the fast path again.
async function rewriteWithAppendedEntry(filePath, line) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return createWithFirstEntry(filePath, line);
    throw err;
  }

  let entries;
  try {
    const parsed = JSON.parse(raw);
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    // Genuinely unparseable: preserve it for inspection rather than
    // silently discarding whatever was already logged today.
    await quarantine(filePath);
    entries = [];
  }

  const lines = entries.map((e) => JSON.stringify(e));
  lines.push(line);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tempPath, `[\n  ${lines.join(',\n  ')}${TAIL}`);
  await fs.rename(tempPath, filePath);
}

// Fast path: appends without ever reading or rewriting prior entries.
// Overwrites the file's known trailing "\n]" with ",\n  <entry>\n]" — O(1)
// regardless of how many entries already exist, which is what keeps a
// large batch (thousands of entries in one day-file) from slowing down as
// it goes, unlike a full read-modify-rewrite would.
async function appendInPlace(filePath, line) {
  let handle;
  try {
    handle = await fs.open(filePath, 'r+');
  } catch (err) {
    if (err.code === 'ENOENT') return createWithFirstEntry(filePath, line);
    throw err;
  }

  try {
    const { size } = await handle.stat();
    if (size < TAIL_BYTES) {
      await handle.close();
      return rewriteWithAppendedEntry(filePath, line);
    }

    const tailBuf = Buffer.alloc(TAIL_BYTES);
    await handle.read(tailBuf, 0, TAIL_BYTES, size - TAIL_BYTES);
    if (tailBuf.toString('utf8') !== TAIL) {
      await handle.close();
      return rewriteWithAppendedEntry(filePath, line);
    }

    const addition = Buffer.from(`,\n  ${line}${TAIL}`);
    await handle.write(addition, 0, addition.length, size - TAIL_BYTES);
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Appends one entry to today's logs/<YYYY-MM-DD>.json array.
 * Fire-and-forget from the caller's point of view: logging must never be
 * allowed to fail a real transmit request, so errors here are swallowed
 * after being reported to the console.
 */
function logEvent(entry) {
  const filePath = dailyLogPath();
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  const previous = writeQueues.get(filePath) || Promise.resolve();

  const next = previous
    .catch(() => {})
    .then(() => appendInPlace(filePath, line))
    .catch((err) => {
      console.error('Failed to write event log entry:', err);
    });

  writeQueues.set(filePath, next);
  return next;
}

module.exports = { logEvent, dailyLogPath };
