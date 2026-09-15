const fs = require('fs/promises');
const path = require('path');
const { SEARCH_MAX_DEPTH, assertWithinRoot } = require('../config');

/**
 * Recursively finds .json files under `dir` whose filename contains `token`.
 * Archive folders are often organised into dated sub-folders, hence the walk.
 *
 * Symbolic links are skipped rather than followed, so a link planted inside
 * the archive tree can't be used to pull files in from outside it.
 */
async function findMatchingFiles(dir, token, depth = 0) {
  if (depth > SEARCH_MAX_DEPTH) return [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      const notFound = new Error(`Source folder not found: ${dir}`);
      notFound.code = 'SOURCE_DIR_NOT_FOUND';
      throw notFound;
    }
    throw err;
  }

  const matches = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findMatchingFiles(fullPath, token, depth + 1);
      matches.push(...nested);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      const baseName = path.basename(entry.name, '.json');
      if (baseName.toLowerCase().includes(token.toLowerCase())) {
        matches.push(fullPath);
      }
    }
  }
  return matches;
}

/**
 * Finds matches under `sourceRoot`, then re-confirms each one still
 * resolves inside `sourceRoot` before handing it back — belt-and-braces
 * in case anything upstream ever changes to allow symlink traversal.
 */
async function findMatchingFilesSafely(sourceRoot, token) {
  const matches = await findMatchingFiles(sourceRoot, token);
  const resolvedRoot = path.resolve(sourceRoot);
  return matches.map((match) => assertWithinRoot(match, resolvedRoot, 'matched file'));
}

module.exports = { findMatchingFiles, findMatchingFilesSafely };
