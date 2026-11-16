# Daily Auto Push Bulk Upload Feature

## Overview

The **Daily Auto Push Bulk Upload** feature automatically re-transmits invoices from the previous day every day at **6 AM Nairobi time (EAT, UTC+3)**. This ensures that any pending untransmitted items are automatically re-queued for transmission daily, preventing invoice backlogs.

## How It Works

### Automatic Scheduling
- **Runs Daily**: Every day at exactly **6 AM Nairobi time** (3 AM UTC)
- **Previous Day Files**: Processes files from yesterday's dated folder (e.g., if today is 20261116, it processes 20261115)
- **Auto-Initiated**: Starts automatically when the server starts—no manual intervention needed
- **Entity Coverage**: Configured for all entities (Farmerschoice, Flamingo, etc.)

### Folder Structure
```
C:\Users\EKaranja\AppData\EbmData\<EntityID>\Data\processed\processedArchive\
├── 20261116/  (today's folder)
│   ├── file1.json
│   └── file2.json
├── 20261115/  (yesterday's folder - processed at 6 AM today)
│   ├── file1.json
│   └── file2.json
├── 20261114/
│   └── ...
```

### File Processing
1. All JSON files from yesterday's date folder are identified
2. Files are moved to the destination folder (`Data\resend\trnsSales`) for re-transmission
3. Each file movement is logged
4. Success/failure statistics are tracked per run

## Using the Feature

### Automatic Trigger
No action required—the system automatically runs at 6 AM Nairobi time daily.

### Manual Trigger
You can manually trigger the daily auto push anytime from the UI:

1. Open the application in your browser: `http://127.0.0.1:4200`
2. Click the **Daily Auto Push** tab
3. Select the entity (Farmerschoice or Flamingo)
4. Click **Trigger Daily Auto Push Now**

The system will process all files from yesterday's folder immediately.

### Scheduler Status
View the current scheduler status and next scheduled run times in the Daily Auto Push tab.

## Viewing Logs

### Today's Logs
```
GET /api/daily-logs/today
```
Returns all daily auto push runs that occurred today.

### Logs for a Specific Date
```
GET /api/daily-logs/:date
```
Replace `:date` with the date in `YYYYMMDD` format (e.g., `20261115`).

### Log Summary
```
GET /api/daily-logs-summary/:date
```
Returns aggregated statistics for a specific date, including:
- Total files processed
- Successful transfers
- Failed transfers
- Per-entity breakdown

### Available Dates with Logs
```
GET /api/daily-logs-dates
```
Returns a list of all dates that have log files.

### Recent Logs
```
GET /api/daily-logs-recent?days=7
```
Returns logs from the last N days (default: 7).

### View Logs in UI
1. Click the **View Logs** tab
2. Select a date from the dropdown (populated from available log files)
3. Click **View Log** to see detailed statistics and run history

## Log Structure

Daily logs are stored at:
```
DATA_ROOT\logs\daily-auto-push\YYYY\MM\DD.json
```

Example log entry:
```json
{
  "timestamp": "2026-11-16T06:00:00.000Z",
  "id": "2026-11-16T06:00:00.000Z-P000592722P_00",
  "entityId": "P000592722P_00",
  "entityName": "Farmerschoice",
  "date": "20261115",
  "folderFound": true,
  "folderPath": "C:\\Users\\EKaranja\\AppData\\EbmData\\P000592722P_00\\Data\\processed\\processedArchive\\20261115",
  "totalFiles": 5,
  "processed": [
    {
      "originalFile": "invoice_001.json",
      "movedTo": "invoice_001.json",
      "status": "success"
    }
  ],
  "errors": [],
  "summary": {
    "success": 5,
    "failed": 0,
    "skipped": 0
  }
}
```

## API Endpoints

### Trigger Daily Auto Push
```
POST /api/daily-auto-push
Content-Type: application/json

{
  "entityId": "P000592722P_00"  // Optional: leave empty to run for all entities
}
```

### Get Scheduler Status
```
GET /api/scheduler-status
```

Response:
```json
{
  "isRunning": true,
  "jobs": [
    {
      "name": "daily-auto-push-P000592722P_00",
      "scheduled": true,
      "nextInvocation": "2026-11-17T03:00:00.000Z"
    }
  ],
  "totalJobs": 2
}
```

## Configuration

The feature uses the following configuration from `config.js`:
- **Source Directory**: `Data\processed\processedArchive` (configurable via `SOURCE_SUBPATH`)
- **Destination Directory**: `Data\resend\trnsSales` (configurable via `DEST_SUBPATH`)
- **Schedule**: 6 AM Nairobi time (3 AM UTC) daily
- **Entities**: All entities defined in the `ENTITIES` configuration

### Environment Variables
You can customize paths in your `.env` file:
```env
SOURCE_SUBPATH=Data\processed\processedArchive
DEST_SUBPATH=Data\resend\trnsSales
```

## Error Handling

### No Previous Day Folder
If the previous day's folder doesn't exist, the system logs a warning and completes with 0 files processed.

### File Move Failures
Individual file failures are logged separately and don't prevent other files in the same batch from being processed.

### Scheduler Errors
Scheduler startup failures are logged to the event log and console. The system will retry on the next server restart.

## Logging

All daily auto push activities are logged in two places:

### Event Log
System event log at `DATA_ROOT\logs\events\YYYY\MM\DD.log` includes:
- Scheduler start events
- Individual file move results
- Summary statistics

### Daily Logs
Structured JSON logs at `DATA_ROOT\logs\daily-auto-push\YYYY\MM\DD.json` for easy querying and analysis.

## Maintenance

### Log Cleanup
The `cleanupOldLogs()` function can automatically remove logs older than 90 days:
```javascript
const { cleanupOldLogs } = require('./lib/dailyLogs');
await cleanupOldLogs(90); // Keep last 90 days
```

## Troubleshooting

### Scheduler Not Running
1. Check console output for `✓ Daily auto push scheduled` messages
2. Verify `/api/scheduler-status` returns `isRunning: true`
3. Ensure server has restarted to initialize the scheduler

### Files Not Being Processed
1. Verify folder exists: `C:\Users\EKaranja\AppData\EbmData\<EntityID>\Data\processed\processedArchive\<YYYYMMDD>`
2. Check View Logs tab for error details
3. Review event logs for move failures

### Logs Not Found
1. Run the feature at least once (manually or automatically)
2. Logs are created only after the first run
3. Check `/api/daily-logs-dates` to see available log dates

## Development Notes

### Module Structure
- `lib/dailyAutoPush.js`: Core processing logic
- `lib/scheduler.js`: Scheduling and orchestration
- `lib/dailyLogs.js`: Log management and retrieval
- `public/app.js`: Frontend UI handlers
- `server.js`: API endpoints

### Creating Custom Schedules
To change the schedule time or frequency, modify `lib/scheduler.js`:
```javascript
function getNairobiCronExpression() {
  // Cron format: second minute hour dayOfMonth month dayOfWeek
  // Current: 0 0 3 * * * (3 AM UTC = 6 AM Nairobi)
  // Change the 3 to run at a different hour
  return '0 0 3 * * *';
}
```

## Future Enhancements
- Webhook notifications on completion
- Retry logic for failed files
- Configurable schedule per entity
- Email alerts for errors
- Dashboard with statistics and trends
