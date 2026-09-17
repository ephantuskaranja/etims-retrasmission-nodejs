const path = require('path');
const { getEntity, getPaths } = require('../config');
const { buildFileIndex, queryIndex, findMatchingFilesSafely } = require('./search');
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

async function transmitOne(invoiceNumber, entity, sourceDir, destDir, index) {
  let searchToken;
  try {
    searchToken = parseSearchToken(invoiceNumber);
  } catch (err) {
    await logOutcome({ invoiceNumber, entityId: entity.id, code: err.code, message: err.message });
    return { invoiceNumber, ok: false, code: err.code, message: err.message };
  }

  // indexMatch tracks the {fullPath, baseNameLower} entry when the match
  // came from the pre-built index, so it can be removed from it below.
  let indexMatch = null;
  let matchPaths;

  const indexHits = queryIndex(index, searchToken);
  if (indexHits.length === 0) {
    // The batch's file index is a one-time snapshot taken when the batch
    // started. A large batch can run for minutes, and the archive folder
    // keeps growing the whole time if production is still processing new
    // invoices — so a snapshot miss isn't proof the file doesn't exist.
    // One live, targeted re-check on disk before giving up catches exactly
    // that case, at the cost of a normal per-item lookup only for actual
    // misses (the minority), not the whole batch.
    matchPaths = await findMatchingFilesSafely(sourceDir, searchToken);
  } else {
    matchPaths = indexHits.map((m) => m.fullPath);
    if (indexHits.length === 1) indexMatch = indexHits[0];
  }

  if (matchPaths.length === 0) {
    const message = `No archived file matching reference "${searchToken}" was found for ${entity.name}.`;
    await logOutcome({ invoiceNumber, entityId: entity.id, code: 'NO_MATCH', message });
    return { invoiceNumber, ok: false, code: 'NO_MATCH', message };
  }

  if (matchPaths.length > 1) {
    const matchNames = matchPaths.map((p) => path.basename(p));
    const message = `Reference "${searchToken}" matched ${matchPaths.length} files for ${entity.name}. Refine the invoice number so it matches exactly one file.`;
    await logOutcome({ invoiceNumber, entityId: entity.id, code: 'AMBIGUOUS_MATCH', message });
    return { invoiceNumber, ok: false, code: 'AMBIGUOUS_MATCH', message, matches: matchNames };
  }

  const sourcePath = matchPaths[0];
  try {
    const destPath = await safeMove(sourcePath, destDir);
    const fileName = path.basename(destPath);

    // Remove from the live index so a duplicate invoice number pasted
    // twice into the same batch can't re-match a file that's already been
    // moved out — same outcome as running the same request twice in a row.
    if (indexMatch) {
      const idx = index.indexOf(indexMatch);
      if (idx !== -1) index.splice(idx, 1);
    }

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
 * matters once both the batch and the archive are large). Because that
 * index is a one-time snapshot, a file that lands in the archive folder
 * after the batch started — normal if production is still actively
 * processing new invoices — won't be in it; transmitOne() re-checks disk
 * directly whenever the index reports no match, so that only ever shows up
 * as a per-item cost for actual misses, never as a false negative.
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
    const result = await transmitOne(invoiceNumber, entity, sourceDir, destDir, index);
    await onEvent({ type: 'result', index: i, ...result });
  }
}

module.exports = { transmitBulk };
