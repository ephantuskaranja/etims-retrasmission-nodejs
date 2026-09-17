const path = require('path');
const { getEntity, getPaths } = require('../config');
const { buildFileIndex, queryIndex } = require('./search');
const { safeMove } = require('./safeMove');
const { logEvent } = require('./eventLog');
const { parseSearchToken } = require('./transmit');
const { WARN_CODES, clientSafeMessage } = require('./errorCodes');

async function logOutcome({ invoiceNumber, entityId, entityName, code, message, fileName }) {
  if (code === 'SUCCESS') {
    await logEvent({
      level: 'INFO',
      event: 'TRANSMIT_SUCCESS',
      invoiceNumber,
      entityId,
      entityName,
      fileName
    });
  } else {
    await logEvent({
      level: WARN_CODES.has(code) ? 'WARN' : 'ERROR',
      event: 'TRANSMIT_FAILURE',
      invoiceNumber,
      entityId,
      code,
      message
    });
  }
}

async function transmitOne(invoiceNumber, entity, destDir, index) {
  let searchToken;
  try {
    searchToken = parseSearchToken(invoiceNumber);
  } catch (err) {
    await logOutcome({ invoiceNumber, entityId: entity.id, code: err.code, message: err.message });
    return { invoiceNumber, ok: false, code: err.code, message: err.message };
  }

  const matches = queryIndex(index, searchToken);

  if (matches.length === 0) {
    const message = `No archived file matching reference "${searchToken}" was found for ${entity.name}.`;
    await logOutcome({ invoiceNumber, entityId: entity.id, code: 'NO_MATCH', message });
    return { invoiceNumber, ok: false, code: 'NO_MATCH', message };
  }

  if (matches.length > 1) {
    const matchNames = matches.map((m) => path.basename(m.fullPath));
    const message = `Reference "${searchToken}" matched ${matches.length} files for ${entity.name}. Refine the invoice number so it matches exactly one file.`;
    await logOutcome({ invoiceNumber, entityId: entity.id, code: 'AMBIGUOUS_MATCH', message });
    return { invoiceNumber, ok: false, code: 'AMBIGUOUS_MATCH', message, matches: matchNames };
  }

  const matchEntry = matches[0];
  try {
    const destPath = await safeMove(matchEntry.fullPath, destDir);
    const fileName = path.basename(destPath);

    // Remove from the live index so a duplicate invoice number pasted
    // twice into the same batch can't re-match a file that's already been
    // moved out — same outcome as running the same request twice in a row.
    const idx = index.indexOf(matchEntry);
    if (idx !== -1) index.splice(idx, 1);

    await logOutcome({
      invoiceNumber,
      entityId: entity.id,
      entityName: entity.name,
      code: 'SUCCESS',
      fileName
    });
    return { invoiceNumber, ok: true, fileName, entityName: entity.name };
  } catch (err) {
    await logOutcome({
      invoiceNumber,
      entityId: entity.id,
      code: err.code || 'UNKNOWN',
      message: err.message
    });
    return { invoiceNumber, ok: false, code: err.code || 'UNKNOWN', message: clientSafeMessage(err) };
  }
}

/**
 * Processes many invoice numbers against one entity, strictly one at a
 * time — the next invoice's file move only starts once the current one has
 * fully finished (result logged, index updated), so two moves can never
 * overlap.
 *
 * Builds the archive's file index once up front instead of re-walking the
 * whole folder per invoice (see search.js buildFileIndex for why that
 * matters once both the batch and the archive are large).
 *
 * `onEvent` is called twice per invoice number — `{ type: 'start', index,
 * invoiceNumber }` right before it's attempted, then `{ type: 'result',
 * index, invoiceNumber, ok, ... }` once it's done — so a caller can stream
 * live progress back instead of waiting for the whole batch to complete.
 */
async function transmitBulk({ invoiceNumbers, entityId }, onEvent) {
  const entity = getEntity(entityId);
  if (!entity) {
    const err = new Error('Unknown KRA entity selected.');
    err.code = 'INVALID_ENTITY';
    throw err;
  }

  const { sourceDir, destDir } = getPaths(entity.id);
  // Lets a bad SOURCE_DIR_NOT_FOUND fail the whole batch upfront, before
  // any invoice number is attempted — same as the single-item path.
  const index = await buildFileIndex(sourceDir);

  for (let i = 0; i < invoiceNumbers.length; i++) {
    const invoiceNumber = invoiceNumbers[i];
    await onEvent({ type: 'start', index: i, invoiceNumber });
    const result = await transmitOne(invoiceNumber, entity, destDir, index);
    await onEvent({ type: 'result', index: i, ...result });
  }
}

module.exports = { transmitBulk };
