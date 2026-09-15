const path = require('path');
const fs = require('fs/promises');
const { getEntity, getPaths } = require('../config');
const { findMatchingFilesSafely } = require('./search');
const { safeMove } = require('./safeMove');

const LOG_PATH = path.join(__dirname, '..', 'logs', 'transmissions.log');

const MAX_INVOICE_LENGTH = 120;
const MAX_TOKEN_LENGTH = 50;
// Reference numbers are alphanumeric; explicitly excludes "/", "\", ".." and
// other characters that would have any special meaning if they ever ended
// up in a path, even though the token is only ever used as a substring filter.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

async function appendLog(line) {
  try {
    await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
    await fs.appendFile(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Logging is best-effort and must never block a transmission.
  }
}

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
    await appendLog(`FAIL entity=${entity.id} invoice=${invoiceNumber} token=${searchToken} reason=no_match`);
    const err = new Error(
      `No archived file matching reference "${searchToken}" was found for ${entity.name}.`
    );
    err.code = 'NO_MATCH';
    throw err;
  }

  if (matches.length > 1) {
    await appendLog(`FAIL entity=${entity.id} invoice=${invoiceNumber} token=${searchToken} reason=ambiguous count=${matches.length}`);
    const err = new Error(
      `Reference "${searchToken}" matched ${matches.length} files for ${entity.name}. Refine the invoice number so it matches exactly one file.`
    );
    err.code = 'AMBIGUOUS_MATCH';
    err.matches = matches.map((m) => path.basename(m));
    throw err;
  }

  const [sourcePath] = matches;
  const destPath = await safeMove(sourcePath, destDir);

  await appendLog(`OK entity=${entity.id} invoice=${invoiceNumber} token=${searchToken} file=${path.basename(destPath)}`);

  return {
    fileName: path.basename(destPath),
    entityName: entity.name
  };
}

module.exports = { transmit, parseSearchToken };
