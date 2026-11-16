const fs = require('fs').promises;
const path = require('path');
const { getEntity, getPaths, DATA_ROOT } = require('../config');
const { buildFileIndex, findMatchingFilesSafely } = require('./search');
const { safeMove } = require('./safeMove');
const { logEvent } = require('./eventLog');
const { logDailyRun } = require('./dailyLogs');

/**
 * Gets yesterday's date in YYYYMMDD format
 */
function getYesterdayFolder() {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, '0');
  const day = String(yesterday.getDate()).padStart(2, '0');
  
  return `${year}${month}${day}`;
}

/**
 * Finds all JSON files in the previous day's folder within processedArchive
 */
async function findPreviousDayFiles(sourceDir) {
  const yesterdayFolder = getYesterdayFolder();
  const previousDayPath = path.join(sourceDir, yesterdayFolder);
  
  try {
    const stat = await fs.stat(previousDayPath);
    if (!stat.isDirectory()) {
      return { found: false, message: `Path exists but is not a directory: ${previousDayPath}`, files: [] };
    }
    
    const entries = await fs.readdir(previousDayPath);
    const jsonFiles = entries.filter(file => file.toLowerCase().endsWith('.json'));
    
    return { 
      found: true, 
      folderPath: previousDayPath,
      files: jsonFiles.map(file => path.join(previousDayPath, file))
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { 
        found: false, 
        message: `Previous day folder not found: ${previousDayPath}`, 
        files: [] 
      };
    }
    throw err;
  }
}

/**
 * Extracts invoice reference from JSON filename or content
 * Assumes filename pattern: something_REFERENCE.json or extracts from JSON content
 */
async function extractInvoiceReference(filePath) {
  try {
    // Try to extract from filename first
    const fileName = path.basename(filePath, '.json');
    const parts = fileName.split('_');
    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      // Check if it looks like an invoice reference (numeric)
      if (/^\d+$/.test(lastPart)) {
        return lastPart;
      }
    }
    
    // Fallback: read JSON and extract reference field
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    
    // Try common reference field names
    return data.reference || data.invoiceReference || data.refNo || 
           data.referenceNo || fileName;
  } catch (err) {
    // If parsing fails, use filename as fallback
    return path.basename(filePath, '.json');
  }
}

/**
 * Processes all files from previous day and moves them to resend folder
 * Returns detailed results per file
 */
async function processPreviousDayFiles(entityId) {
  const entity = getEntity(entityId);
  if (!entity) {
    const err = new Error('Unknown KRA entity selected.');
    err.code = 'INVALID_ENTITY';
    throw err;
  }

  const { sourceDir, destDir } = getPaths(entity.id);
  const yesterdayFolder = getYesterdayFolder();
  
  // Find previous day files
  const { found, folderPath, files: jsonFiles, message } = await findPreviousDayFiles(sourceDir);
  
  const results = {
    entityId,
    entityName: entity.name,
    date: yesterdayFolder,
    timestamp: new Date().toISOString(),
    folderFound: found,
    folderPath,
    totalFiles: jsonFiles.length,
    processed: [],
    skipped: [],
    errors: [],
    summary: {
      success: 0,
      failed: 0,
      skipped: 0
    }
  };

  if (!found) {
    results.message = message;
    await logEvent({
      level: 'WARN',
      event: 'DAILY_AUTO_PUSH',
      code: 'NO_PREVIOUS_DAY_FOLDER',
      entityId,
      entityName: entity.name,
      message: `Daily auto push: ${message}`
    });
    return results;
  }

  // Process each file
  for (const filePath of jsonFiles) {
    try {
      const fileName = path.basename(filePath);
      let destPath;

      try {
        destPath = await safeMove(filePath, destDir);
        const movedFileName = path.basename(destPath);
        
        results.processed.push({
          originalFile: fileName,
          movedTo: movedFileName,
          status: 'success'
        });
        results.summary.success++;

        await logEvent({
          level: 'INFO',
          event: 'DAILY_AUTO_PUSH',
          code: 'FILE_MOVED',
          entityId,
          entityName: entity.name,
          fileName,
          movedTo: movedFileName
        });
      } catch (moveErr) {
        results.errors.push({
          file: fileName,
          error: moveErr.message,
          code: moveErr.code || 'MOVE_FAILED'
        });
        results.summary.failed++;

        await logEvent({
          level: 'ERROR',
          event: 'DAILY_AUTO_PUSH',
          code: moveErr.code || 'FILE_MOVE_ERROR',
          entityId,
          entityName: entity.name,
          fileName,
          message: moveErr.message
        });
      }
    } catch (err) {
      results.errors.push({
        error: err.message,
        code: err.code || 'UNKNOWN'
      });
      results.summary.failed++;

      await logEvent({
        level: 'ERROR',
        event: 'DAILY_AUTO_PUSH',
        code: err.code || 'UNKNOWN',
        entityId,
        entityName: entity.name,
        message: err.message
      });
    }
  }

  // Log final summary
  const summaryMsg = `Daily auto push completed for ${entity.name}: ${results.summary.success} succeeded, ${results.summary.failed} failed`;
  await logEvent({
    level: results.summary.failed === 0 ? 'INFO' : 'WARN',
    event: 'DAILY_AUTO_PUSH_SUMMARY',
    entityId,
    entityName: entity.name,
    message: summaryMsg,
    totalFiles: results.totalFiles,
    success: results.summary.success,
    failed: results.summary.failed
  });

  // Log to daily logs file
  await logDailyRun(results);

  return results;
}

module.exports = {
  getYesterdayFolder,
  findPreviousDayFiles,
  processPreviousDayFiles,
  extractInvoiceReference
};
