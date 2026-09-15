const express = require('express');
const path = require('path');
const { ENTITIES, PORT, HOST } = require('./config');
const { transmit } = require('./lib/transmit');

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

app.post('/api/transmit', requireSameOrigin, async (req, res) => {
  const { invoiceNumber, entityId } = req.body || {};

  if (!invoiceNumber || !entityId) {
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
    const status = {
      INVALID_INVOICE_FORMAT: 400,
      INVALID_ENTITY: 400,
      NO_MATCH: 404,
      AMBIGUOUS_MATCH: 409,
      SOURCE_DIR_NOT_FOUND: 404,
      DEST_ALREADY_EXISTS: 409
    }[err.code] || 500;

    res.status(status).json({
      error: err.message,
      code: err.code || 'UNKNOWN',
      matches: err.matches
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`eTIMS retransmission tool running at http://${HOST}:${PORT}`);
});
