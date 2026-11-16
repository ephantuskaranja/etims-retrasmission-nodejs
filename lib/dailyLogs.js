const fs = require('fs').promises;
const path = require('path');
const { DATA_ROOT } = require('../config');

/**
 * Daily logs folder structure:
 * DATA_ROOT/logs/daily-auto-push/YYYY/MM/DD.json
 * Each file contains an array of run results for that day
 */
const DAILY_LOGS_DIR = path.join(DATA_ROOT, 'logs', 'daily-auto-push');

/**
 * Gets the log file path for a specific date
 */
function getLogFilePath(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  const dirPath = path.join(DAILY_LOGS_DIR, year.toString(), month);
  const filePath = path.join(dirPath, `${day}.json`);
  
  return { dirPath, filePath, dateStr: `${year}${month}${day}` };
}

/**
 * Creates directory structure if it doesn't exist
 */
async function ensureLogDirectory() {
  const { dirPath } = getLogFilePath();
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}

/**
 * Reads today's log file
 */
async function readTodayLog() {
  const { filePath } = getLogFilePath();
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Reads log file for a specific date (YYYYMMDD format)
 */
async function readDateLog(dateStr) {
  // Parse YYYYMMDD format
  const year = parseInt(dateStr.slice(0, 4));
  const month = parseInt(dateStr.slice(4, 6));
  const day = parseInt(dateStr.slice(6, 8));
  
  if (isNaN(year) || isNaN(month) || isNaN(day) || 
      month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid date format: ${dateStr}. Use YYYYMMDD format.`);
  }
  
  const date = new Date(year, month - 1, day);
  const { filePath } = getLogFilePath(date);
  
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null; // Log file doesn't exist for that date
    }
    throw err;
  }
}

/**
 * Appends a run result to today's log
 */
async function logDailyRun(runResult) {
  await ensureLogDirectory();
  
  const { filePath } = getLogFilePath();
  const timestamp = new Date().toISOString();
  
  const entry = {
    timestamp,
    ...runResult,
    id: `${timestamp}-${runResult.entityId}`
  };

  try {
    const logs = await readTodayLog();
    logs.push(entry);
    await fs.writeFile(filePath, JSON.stringify(logs, null, 2));
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.writeFile(filePath, JSON.stringify([entry], null, 2));
    } else {
      throw err;
    }
  }

  return entry;
}

/**
 * Gets all logs for a specific date range
 */
async function getLogsForDateRange(startDate, endDate) {
  const logs = {};
  const current = new Date(startDate);
  
  while (current <= endDate) {
    const { dirPath: _, filePath: __, dateStr } = getLogFilePath(current);
    const log = await readDateLog(dateStr);
    
    if (log) {
      logs[dateStr] = log;
    }
    
    current.setDate(current.getDate() + 1);
  }
  
  return logs;
}

/**
 * Gets summary of all runs for a specific date
 */
async function getDaySummary(dateStr) {
  const log = await readDateLog(dateStr);
  
  if (!log) {
    return null;
  }

  const summary = {
    date: dateStr,
    totalRuns: log.length,
    entities: {},
    totalFilesProcessed: 0,
    totalSuccessful: 0,
    totalFailed: 0,
    runs: log
  };

  for (const entry of log) {
    if (!summary.entities[entry.entityName]) {
      summary.entities[entry.entityName] = {
        runs: 0,
        filesProcessed: 0,
        successful: 0,
        failed: 0
      };
    }

    const entity = summary.entities[entry.entityName];
    entity.runs++;
    entity.filesProcessed += entry.totalFiles || 0;
    entity.successful += entry.summary?.success || 0;
    entity.failed += entry.summary?.failed || 0;

    summary.totalFilesProcessed += entry.totalFiles || 0;
    summary.totalSuccessful += entry.summary?.success || 0;
    summary.totalFailed += entry.summary?.failed || 0;
  }

  return summary;
}

/**
 * Gets logs for the last N days
 */
async function getRecentLogs(days = 7) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  
  return await getLogsForDateRange(startDate, endDate);
}

/**
 * Gets a list of dates that have logs
 */
async function getAvailableDates() {
  const dates = [];
  
  try {
    const yearDirs = await fs.readdir(DAILY_LOGS_DIR);
    
    for (const year of yearDirs) {
      const yearPath = path.join(DAILY_LOGS_DIR, year);
      const stat = await fs.stat(yearPath);
      
      if (!stat.isDirectory()) continue;
      
      const monthDirs = await fs.readdir(yearPath);
      
      for (const month of monthDirs) {
        const monthPath = path.join(yearPath, month);
        const stat = await fs.stat(monthPath);
        
        if (!stat.isDirectory()) continue;
        
        const files = await fs.readdir(monthPath);
        
        for (const file of files) {
          if (file.endsWith('.json')) {
            const day = file.replace('.json', '');
            dates.push(`${year}${month}${day}`);
          }
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  return dates.sort().reverse(); // Most recent first
}

/**
 * Cleans up old logs (optional maintenance function)
 */
async function cleanupOldLogs(daysToKeep = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const availableDates = await getAvailableDates();
  let deletedCount = 0;

  for (const dateStr of availableDates) {
    const year = parseInt(dateStr.slice(0, 4));
    const month = parseInt(dateStr.slice(4, 6));
    const day = parseInt(dateStr.slice(6, 8));
    const logDate = new Date(year, month - 1, day);

    if (logDate < cutoffDate) {
      const { filePath } = getLogFilePath(logDate);
      try {
        await fs.unlink(filePath);
        deletedCount++;
      } catch (err) {
        console.error(`Failed to delete log file ${filePath}:`, err);
      }
    }
  }

  return { deletedCount, cutoffDate };
}

module.exports = {
  logDailyRun,
  readTodayLog,
  readDateLog,
  getDaySummary,
  getLogsForDateRange,
  getRecentLogs,
  getAvailableDates,
  cleanupOldLogs,
  getLogFilePath
};
