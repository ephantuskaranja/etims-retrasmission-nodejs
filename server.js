const express = require('express');
const path = require('path');
const { ENTITIES, PORT, HOST, ALLOWED_ORIGINS: EXTRA_ORIGINS, MAX_BULK_ITEMS } = require('./config');
const { transmit } = require('./lib/transmit');
const { transmitBulk } = require('./lib/bulkTransmit');
const { logEvent } = require('./lib/eventLog');
const { CLIENT_SAFE_CODES, STATUS_BY_CODE, GENERIC_FAILURE_MESSAGE, clientSafeMessage } = require('./lib/errorCodes');

const app = express();

const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  ...EXTRA_ORIGINS
]);

// Blocks CSRF-style requests: a page open in another tab/site cannot silently
// trigger a file move here, because browsers stamp a real cross-origin
// request with an Origin/Referer header that won't match this app's own
// origin. Non-browser clients (curl, scripts) that omit both are still let
// through, since they aren't subject to the browser attack this guards against.
function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  const referer = req.get('referer');

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Cross-origin request rejected.', code: 'FORBIDDEN_ORIGIN' });
  }
  if (!origin && referer) {
    const refererOrigin = new URL(referer).origin;
    if (!ALLOWED_ORIGINS.has(refererOrigin)) {
      return res.status(403).json({ error: 'Cross-origin request rejected.', code: 'FORBIDDEN_ORIGIN' });
    }
  }
  next();
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/entities', (_req, res) => {
  res.json({ entities: ENTITIES, maxBulkItems: MAX_BULK_ITEMS });
});

app.post('/api/transmit', requireSameOrigin, async (req, res) => {
  const { invoiceNumber, entityId } = req.body || {};

  if (!invoiceNumber || !entityId) {
    await logEvent({
      level: 'WARN',
      event: 'TRANSMIT_FAILURE',
      code: 'MISSING_FIELDS',
      invoiceNumber,
      entityId,
      message: 'invoiceNumber and entityId are required.'
    });
    return res.status(400).json({ error: 'invoiceNumber and entityId are required.' });
  }

  try {
    const result = await transmit({ invoiceNumber, entityId });
    res.json({
      message: `Re-transmission request successful. "${result.fileName}" has been queued for ${result.entityName} — you can verify with KRA in the next few minutes.`,
      fileName: result.fileName,
      entityName: result.entityName
    });
  } catch (err) {
    const status = STATUS_BY_CODE[err.code] || 500;
    const message = clientSafeMessage(err);

    if (!CLIENT_SAFE_CODES.has(err.code)) {
      console.error(`transmit failed [${err.code || 'UNKNOWN'}]:`, err.message);
    }

    res.status(status).json({
      error: message,
      code: err.code || 'UNKNOWN',
      matches: err.matches
    });
  }
});

// Processes a whole batch of invoice numbers against one entity, strictly
// one at a time (see lib/bulkTransmit.js), streaming one newline-delimited
// JSON object back per event as it happens instead of waiting for the
// whole batch to finish. This is what lets a run of thousands of invoices:
//  - keep the HTTP connection actively sending data (rather than sitting
//    idle for tens of minutes, which risks a proxy or browser timeout),
//  - update the UI live, one row at a time, exactly as before.
app.post('/api/transmit-bulk', requireSameOrigin, async (req, res) => {
  const { invoiceNumbers, entityId } = req.body || {};

  if (!Array.isArray(invoiceNumbers) || invoiceNumbers.length === 0 || !entityId) {
    return res.status(400).json({ error: 'invoiceNumbers (a non-empty array) and entityId are required.' });
  }
  if (!invoiceNumbers.every((n) => typeof n === 'string')) {
    return res.status(400).json({ error: 'invoiceNumbers must be an array of strings.' });
  }
  if (invoiceNumbers.length > MAX_BULK_ITEMS) {
    return res.status(400).json({
      error: `Too many invoice numbers (${invoiceNumbers.length}). Please process at most ${MAX_BULK_ITEMS} at a time.`,
      code: 'TOO_MANY_ITEMS'
    });
  }

  res.status(200);
  res.set('Content-Type', 'application/x-ndjson');
  res.set('Cache-Control', 'no-cache');
  res.set('X-Accel-Buffering', 'no'); // disable buffering on nginx-style proxies, if any sit in front
  if (res.flushHeaders) res.flushHeaders();

  // If the browser tab closes or navigates away mid-batch, keep processing
  // and logging server-side (the file moves and audit trail matter more
  // than whether anyone is still watching) — just stop trying to write to
  // the dead connection.
  let clientGone = false;
  res.on('close', () => { clientGone = true; });

  const writeLine = (obj) => {
    if (clientGone) return;
    try {
      res.write(JSON.stringify(obj) + '\n');
    } catch {
      clientGone = true;
    }
  };

  try {
    await transmitBulk({ invoiceNumbers, entityId }, async (event) => {
      writeLine(event);
    });
    writeLine({ type: 'done' });
  } catch (err) {
    // Only entity/archive-folder-level failures reach here (per-invoice
    // failures are already captured as individual "result" lines) — these
    // fail the whole batch before any invoice was attempted.
    console.error(`transmit-bulk failed [${err.code || 'UNKNOWN'}]:`, err.message);
    writeLine({
      type: 'fatal',
      code: err.code || 'UNKNOWN',
      message: CLIENT_SAFE_CODES.has(err.code) ? err.message : GENERIC_FAILURE_MESSAGE
    });
  } finally {
    if (!clientGone) res.end();
  }
});

// Catches anything that reaches here unhandled — a malformed request body,
// a thrown error from a route that forgot to catch it, etc. Without this,
// Express's default handler renders a full stack trace (with real file
// paths) as the HTTP response, which must never reach the browser.
app.use((err, _req, res, _next) => {
  console.error('Unhandled request error:', err);
  logEvent({
    level: 'ERROR',
    event: 'SYSTEM_ERROR',
    code: err.code || 'UNHANDLED_REQUEST_ERROR',
    message: err.message
  });
  if (res.headersSent) return;
  res.status(400).json({ error: 'Invalid request.', code: 'BAD_REQUEST' });
});

app.listen(PORT, HOST, () => {
  console.log(`eTIMS retransmission tool running at http://${HOST}:${PORT}`);
});
