// Shared between the single-item and bulk transmit paths so client-facing
// behaviour can't drift between them.

// User-input rejections are logged as WARN (someone typed something wrong);
// everything else that stops a transmission is an ERROR (something the
// system itself failed to do).
const WARN_CODES = new Set([
  'INVALID_INVOICE_FORMAT',
  'INVALID_ENTITY',
  'NO_MATCH',
  'AMBIGUOUS_MATCH',
  'DEST_ALREADY_EXISTS'
]);

// Only these codes carry a message already known to be free of filesystem
// paths or other internal detail — everything else falls back to
// GENERIC_FAILURE_MESSAGE so nothing about the server's folder layout ever
// reaches the browser. Full detail always still goes to the per-day log.
const CLIENT_SAFE_CODES = new Set([
  'INVALID_INVOICE_FORMAT',
  'INVALID_ENTITY',
  'NO_MATCH',
  'AMBIGUOUS_MATCH',
  'DEST_ALREADY_EXISTS'
]);

const GENERIC_FAILURE_MESSAGE =
  'Could not complete the retransmission request. Please try again or contact support.';

const STATUS_BY_CODE = {
  INVALID_INVOICE_FORMAT: 400,
  INVALID_ENTITY: 400,
  NO_MATCH: 404,
  AMBIGUOUS_MATCH: 409,
  SOURCE_DIR_NOT_FOUND: 404,
  DEST_ALREADY_EXISTS: 409
};

function clientSafeMessage(err) {
  return CLIENT_SAFE_CODES.has(err.code) ? err.message : GENERIC_FAILURE_MESSAGE;
}

module.exports = { WARN_CODES, CLIENT_SAFE_CODES, GENERIC_FAILURE_MESSAGE, STATUS_BY_CODE, clientSafeMessage };
