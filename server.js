const express = require('express');
const path = require('path');
const { ENTITIES, PORT, HOST } = require('./config');
const { transmit } = require('./lib/transmit');
const { logEvent } = require('./lib/eventLog');

const app = express();

const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/entities', (_req, res) => {
  res.json(ENTITIES);
});

// Only these codes carry a message already known to be free of filesystem
// paths or other internal detail — everything else falls back to a generic
// message below so nothing about the server's folder layout ever reaches
// the browser. Full detail is still written to logs/<YYYY-MM-DD>.json.
const CLIENT_SAFE_CODES = new Set([
  'INVALID_INVOICE_FORMAT',
  'INVALID_ENTITY',
  'NO_MATCH',
  'AMBIGUOUS_MATCH',
  'DEST_ALREADY_EXISTS'
]);

const STATUS_BY_CODE = {
  INVALID_INVOICE_FORMAT: 400,
  INVALID_ENTITY: 400,
  NO_MATCH: 404,
  AMBIGUOUS_MATCH: 409,
  SOURCE_DIR_NOT_FOUND: 404,
  DEST_ALREADY_EXISTS: 409
};

const GENERIC_FAILURE_MESSAGE =
  'Could not complete the retransmission request. Please try again or contact support.';

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
    const message = CLIENT_SAFE_CODES.has(err.code) ? err.message : GENERIC_FAILURE_MESSAGE;

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
