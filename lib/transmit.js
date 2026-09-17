const path = require('path');
const { getEntity, getPaths } = require('../config');
const { findMatchingFilesSafely } = require('./search');
const { safeMove } = require('./safeMove');
const { logEvent } = require('./eventLog');
const { WARN_CODES } = require('./errorCodes');

const MAX_INVOICE_LENGTH = 120;
const MAX_TOKEN_LENGTH = 50;
// Reference numbers are alphanumeric; explicitly excludes "/", "\", ".." and
// other characters that would have any special meaning if they ever ended
// up in a path, even though the token is only ever used as a substring filter.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

function invalidFormatError() {
  const err = new Error(
    'Invoice number must be in the format KRACU0300007620/478344 (a reference after the "/").'
  );
  err.code = 'INVALID_INVOICE_FORMAT';
  return err;
}

function parseSearchToken(invoiceNumber) {
  const trimmed = (invoiceNumber || '').trim();
  if (!trimmed || trimmed.length > MAX_INVOICE_LENGTH) {
    throw invalidFormatError();
  }

  const slashIndex = trimmed.lastIndexOf('/');
  if (slashIndex === -1 || slashIndex === trimmed.length - 1) {
    throw invalidFormatError();
  }

  const token = trimmed.slice(slashIndex + 1).trim();
  if (!token || token.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(token)) {
    throw invalidFormatError();
  }

  return token;
}

async function transmit({ invoiceNumber, entityId }) {
  try {
    const entity = getEntity(entityId);
    if (!entity) {
      const err = new Error('Unknown KRA entity selected.');
      err.code = 'INVALID_ENTITY';
      throw err;
    }

    const searchToken = parseSearchToken(invoiceNumber);
    const { sourceDir, destDir } = getPaths(entity.id);

    const matches = await findMatchingFilesSafely(sourceDir, searchToken);

    if (matches.length === 0) {
      const err = new Error(
        `No archived file matching reference "${searchToken}" was found for ${entity.name}.`
      );
      err.code = 'NO_MATCH';
      throw err;
    }

    if (matches.length > 1) {
      const err = new Error(
        `Reference "${searchToken}" matched ${matches.length} files for ${entity.name}. Refine the invoice number so it matches exactly one file.`
      );
      err.code = 'AMBIGUOUS_MATCH';
      err.matches = matches.map((m) => path.basename(m));
      throw err;
    }

    const [sourcePath] = matches;
    const destPath = await safeMove(sourcePath, destDir);
    const fileName = path.basename(destPath);

    await logEvent({
      level: 'INFO',
      event: 'TRANSMIT_SUCCESS',
      invoiceNumber,
      entityId: entity.id,
      entityName: entity.name,
      fileName
    });

    return { fileName, entityName: entity.name };
  } catch (err) {
    // Full detail (including any filesystem paths) goes to the internal
    // per-day log only — the HTTP layer (server.js) decides what, if
    // anything, of this is safe to send back to the browser.
    await logEvent({
      level: WARN_CODES.has(err.code) ? 'WARN' : 'ERROR',
      event: 'TRANSMIT_FAILURE',
      invoiceNumber,
      entityId,
      code: err.code || 'UNKNOWN',
      message: err.message
    });
    throw err;
  }
}

module.exports = { transmit, parseSearchToken };
