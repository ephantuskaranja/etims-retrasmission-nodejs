require('dotenv').config();

const path = require('path');

// Root folder that contains the per-entity "P0000...P_00" directories.
const DATA_ROOT = process.env.EBM_DATA_ROOT || 'C:\\Users\\EKaranja\\AppData\\EbmData';

// Sub-paths (relative to <DATA_ROOT>\<entity>) for the search and drop-off folders.
const SOURCE_SUBPATH = process.env.SOURCE_SUBPATH || 'Data\\processed\\processedArchive';
const DEST_SUBPATH = process.env.DEST_SUBPATH || 'Data\\resend\\trnsSales';

const PORT = Number(process.env.PORT) || 4173;
// Binds to localhost only by default so the app can't be reached from other
// devices on the network. Only change this deliberately (e.g. "0.0.0.0").
const HOST = process.env.HOST || '127.0.0.1';
const SEARCH_MAX_DEPTH = Number(process.env.SEARCH_MAX_DEPTH) || 6;

const ENTITIES = [
  { id: 'P000592722P_00', name: 'Farmerschoice', default: true },
  { id: 'P000613908P_00', name: 'Flamingo', default: false }
];

function getEntity(entityId) {
  const entity = ENTITIES.find((e) => e.id === entityId);
  if (!entity) return null;
  return entity;
}

const RESOLVED_DATA_ROOT = path.resolve(DATA_ROOT);

// Defense-in-depth: confirms `candidate` resolves to somewhere inside `root`,
// so a mistyped SOURCE_SUBPATH/DEST_SUBPATH (or a symlink) in .env can never
// point the app at a folder outside the configured data root.
function assertWithinRoot(candidate, root, label) {
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);
  const escapes = relative.startsWith('..') || path.isAbsolute(relative);
  if (escapes) {
    throw new Error(`Refusing to use ${label} "${resolved}" — it is outside the data root "${root}".`);
  }
  return resolved;
}

function getPaths(entityId) {
  const sourceDir = assertWithinRoot(
    path.join(DATA_ROOT, entityId, SOURCE_SUBPATH),
    RESOLVED_DATA_ROOT,
    'source folder'
  );
  const destDir = assertWithinRoot(
    path.join(DATA_ROOT, entityId, DEST_SUBPATH),
    RESOLVED_DATA_ROOT,
    'destination folder'
  );
  return { sourceDir, destDir };
}

// Fail fast at startup if any configured entity resolves outside the data root,
// rather than discovering it on the first real request.
for (const entity of ENTITIES) {
  getPaths(entity.id);
}

module.exports = {
  DATA_ROOT: RESOLVED_DATA_ROOT,
  PORT,
  HOST,
  SEARCH_MAX_DEPTH,
  ENTITIES,
  getEntity,
  getPaths,
  assertWithinRoot
};
