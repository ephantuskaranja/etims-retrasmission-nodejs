const schedule = require('node-schedule');
const { processPreviousDayFiles } = require('./dailyAutoPush');
const { logEvent } = require('./eventLog');
const { ENTITIES } = require('../config');

let scheduledJobs = {};

/**
 * Converts UTC time to Nairobi time (EAT, UTC+3)
 * Returns cron expression for 6 AM Nairobi time (3 AM UTC)
 */
function getNairobiCronExpression() {
  // Nairobi is UTC+3, so 6 AM Nairobi = 3 AM UTC
  // Cron format: second minute hour dayOfMonth month dayOfWeek
  return '0 0 3 * * *'; // 3 AM UTC every day = 6 AM Nairobi
}

/**
 * Starts the daily auto push scheduler for all entities
 * Runs at 6 AM Nairobi time every day
 */
async function startDailyAutoScheduler() {
  try {
    const cronExpression = getNairobiCronExpression();
    
    // Schedule for each entity
    for (const entity of ENTITIES) {
      const jobName = `daily-auto-push-${entity.id}`;
      
      scheduledJobs[jobName] = schedule.scheduleJob(cronExpression, async () => {
        await runDailyAutoPush(entity.id);
      });

      await logEvent({
        level: 'INFO',
        event: 'SCHEDULER_START',
        code: 'DAILY_AUTO_PUSH_SCHEDULED',
        entityId: entity.id,
        entityName: entity.name,
        message: `Daily auto push scheduled for ${entity.name} at 6 AM Nairobi time (${cronExpression})`
      });

      console.log(`✓ Daily auto push scheduled for ${entity.name} at 6 AM Nairobi time`);
    }

    return { 
      success: true, 
      message: `Daily auto push scheduler started for ${ENTITIES.length} entities at 6 AM Nairobi time`
    };
  } catch (err) {
    await logEvent({
      level: 'ERROR',
      event: 'SCHEDULER_ERROR',
      code: 'SCHEDULER_START_FAILED',
      message: `Failed to start daily auto push scheduler: ${err.message}`
    });
    console.error('Failed to start daily auto push scheduler:', err);
    throw err;
  }
}

/**
 * Stops all scheduled jobs
 */
function stopDailyAutoScheduler() {
  for (const [jobName, job] of Object.entries(scheduledJobs)) {
    if (job) {
      job.cancel();
      console.log(`✓ Cancelled scheduled job: ${jobName}`);
    }
  }
  scheduledJobs = {};
}

/**
 * Runs the daily auto push for a specific entity
 */
async function runDailyAutoPush(entityId) {
  try {
    console.log(`\n[${new Date().toISOString()}] Starting daily auto push for entity ${entityId}...`);
    
    const result = await processPreviousDayFiles(entityId);
    
    console.log(`Daily auto push completed for ${result.entityName}:`);
    console.log(`  - Total files: ${result.totalFiles}`);
    console.log(`  - Succeeded: ${result.summary.success}`);
    console.log(`  - Failed: ${result.summary.failed}`);
    
    return result;
  } catch (err) {
    console.error(`Daily auto push failed for entity ${entityId}:`, err);
    
    await logEvent({
      level: 'ERROR',
      event: 'DAILY_AUTO_PUSH_FAILURE',
      code: err.code || 'UNKNOWN',
      entityId,
      message: `Daily auto push failed: ${err.message}`
    });
    
    throw err;
  }
}

/**
 * Manually triggers daily auto push for specific or all entities
 * Used by API endpoint
 */
async function triggerDailyAutoPush(entityId) {
  if (entityId) {
    return await runDailyAutoPush(entityId);
  } else {
    // Run for all entities in parallel
    const results = await Promise.all(
      ENTITIES.map(entity => runDailyAutoPush(entity.id))
    );
    return { allResults: results };
  }
}

/**
 * Gets status of scheduled jobs
 */
function getSchedulerStatus() {
  const status = {
    isRunning: Object.keys(scheduledJobs).length > 0,
    jobs: [],
    totalJobs: Object.keys(scheduledJobs).length
  };

  for (const [jobName, job] of Object.entries(scheduledJobs)) {
    if (job) {
      status.jobs.push({
        name: jobName,
        scheduled: true,
        nextInvocation: job.nextInvocation()
      });
    }
  }

  return status;
}

module.exports = {
  startDailyAutoScheduler,
  stopDailyAutoScheduler,
  runDailyAutoPush,
  triggerDailyAutoPush,
  getSchedulerStatus,
  getNairobiCronExpression
};
