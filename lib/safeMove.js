const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');

async function fileChecksum(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Moves `sourcePath` into `destDir` without ever deleting the source until
 * the copy at the destination has been verified byte-for-byte identical.
 *
 * Sequence: copy to a temp file in destDir -> fsync -> checksum-verify ->
 * atomic rename to the final name -> only then delete the source.
 * Any failure before the final delete leaves the source untouched and
 * removes any partial temp file it created (rollback).
 */
async function safeMove(sourcePath, destDir) {
  const fileName = path.basename(sourcePath);
  const finalDestPath = path.join(destDir, fileName);
  const tempDestPath = path.join(
    destDir,
    `.${fileName}.transmitting-${process.pid}-${Date.now()}`
  );

  await fs.mkdir(destDir, { recursive: true });

  if (fsSync.existsSync(finalDestPath)) {
    const err = new Error(
      `A file named "${fileName}" already exists in the resend folder. Nothing was moved.`
    );
    err.code = 'DEST_ALREADY_EXISTS';
    throw err;
  }

  const sourceChecksum = await fileChecksum(sourcePath);

  try {
    // Copy, then force the bytes to disk before trusting them.
    const srcHandle = await fs.open(sourcePath, 'r');
    const destHandle = await fs.open(tempDestPath, 'wx');
    try {
      const data = await srcHandle.readFile();
      await destHandle.writeFile(data);
      await destHandle.sync();
    } finally {
      await srcHandle.close();
      await destHandle.close();
    }

    const destChecksum = await fileChecksum(tempDestPath);
    if (destChecksum !== sourceChecksum) {
      throw new Error('Checksum mismatch after copy — destination file did not match the source.');
    }

    // Atomic on the same volume: either it lands fully or not at all.
    await fs.rename(tempDestPath, finalDestPath);
  } catch (err) {
    await fs.rm(tempDestPath, { force: true });
    err.code = err.code || 'COPY_FAILED';
    throw err;
  }

  // Only now that the destination copy is confirmed good do we remove the source.
  try {
    await fs.unlink(sourcePath);
  } catch (err) {
    // The transmit copy already landed safely; the source just failed to delete.
    // Do not roll back the destination — surface this as a non-fatal warning instead.
    err.code = 'SOURCE_CLEANUP_FAILED';
    err.destPath = finalDestPath;
    throw err;
  }

  return finalDestPath;
}

module.exports = { safeMove };
