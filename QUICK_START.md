# Daily Auto Push - Quick Start Guide

## What This Feature Does

Automatically re-transmits all JSON invoice files from the previous day every morning at **6 AM Nairobi time**. This ensures no invoices are left pending for more than a day.

**Example**: 
- Today is November 16, 2026
- At 6 AM Nairobi time, the system automatically processes all files from November 15
- Files are moved from `processedArchive\20261115\` to `resend\trnsSales\`

## Getting Started

### 1. Verify the Server is Running
```
npm start
```
You should see:
```
✓ Daily auto push scheduled for Farmerschoice at 6 AM Nairobi time
✓ Daily auto push scheduled for Flamingo at 6 AM Nairobi time
```

### 2. Open the Application
Navigate to: `http://127.0.0.1:4200`

### 3. Use the Daily Auto Push Tab

**Tab Navigation:**
```
| Single | Bulk | Daily Auto Push | View Logs |
```

Click on **Daily Auto Push** to access the feature.

## Features Available

### Feature 1: Check Scheduler Status
Shows when the next automatic run will occur.

```
Scheduler Status:
- Status: Running ✓
- Total Jobs: 2
- Next Scheduled Runs:
  - Farmerschoice: 2026-11-17 at 06:00 AM (Nairobi time)
  - Flamingo: 2026-11-17 at 06:00 AM (Nairobi time)
```

### Feature 2: Manually Trigger
Run the daily auto push immediately (doesn't wait for 6 AM).

**Steps:**
1. Select Entity (Farmerschoice or Flamingo)
2. Click "Trigger Daily Auto Push Now"
3. Wait for results to appear

**Result Example:**
```
✓ Daily auto push completed!
Files processed: 5
Successful: 5
Failed: 0
```

### Feature 3: View Historical Logs
See what ran on previous days.

**Steps:**
1. Click "View Logs" tab
2. Select a date from the dropdown
3. Click "View Log"

**Example Log Summary:**
```
Daily Auto Push Summary for 20261115

Total Runs: 2
Total Files Processed: 10
Successful: 10 | Failed: 0

By Entity:
- Farmerschoice - Runs: 1, Files: 5, Success: 5, Failed: 0
- Flamingo - Runs: 1, Files: 5, Success: 5, Failed: 0
```

## Automatic Schedule

The system automatically runs at:
- **Time**: 6:00 AM Nairobi Time (EAT)
- **Every Day**: Daily, 7 days a week
- **No Action Needed**: It runs automatically in the background

### Behind the Scenes (Automatic)
1. **Daily at 6 AM**: System calculates yesterday's date (e.g., today is 20261116, so process 20261115)
2. **Find Files**: Looks in `processedArchive\20261115\` for `.json` files
3. **Move Files**: Transfers each file to `resend\trnsSales\` for transmission
4. **Log Results**: Records success/failure for each file
5. **Track Stats**: Records total processed, succeeded, failed

## Logging & History

All runs are logged automatically in two places:

### Event Log (Server-wide)
**Location**: `logs\2026-11-16.json`
**Contains**: All system events including daily auto push runs
**Format**: Timestamped JSON entries

### Daily Log (Daily Auto Push specific)
**Location**: `logs\daily-auto-push\2026\11\16.json`
**Contains**: Detailed results per entity
**Example**:
```json
{
  "timestamp": "2026-11-16T06:00:00.000Z",
  "entityId": "P000592722P_00",
  "entityName": "Farmerschoice",
  "date": "20261115",
  "totalFiles": 5,
  "summary": {
    "success": 5,
    "failed": 0
  },
  "processed": [
    {
      "originalFile": "invoice_001.json",
      "movedTo": "invoice_001.json",
      "status": "success"
    }
  ]
}
```

## API Usage (For Integration)

If you want to integrate with other systems:

### Check Status
```bash
curl http://127.0.0.1:4200/api/scheduler-status
```

### Trigger Manually
```bash
curl -X POST http://127.0.0.1:4200/api/daily-auto-push \
  -H "Content-Type: application/json" \
  -d '{"entityId": "P000592722P_00"}'
```

### Get Today's Logs
```bash
curl http://127.0.0.1:4200/api/daily-logs/today
```

### Get Logs for Specific Date
```bash
# Date format: YYYYMMDD (e.g., 20261115)
curl http://127.0.0.1:4200/api/daily-logs/20261115
```

### Get Summary for Date
```bash
curl http://127.0.0.1:4200/api/daily-logs-summary/20261115
```

### List All Available Dates
```bash
curl http://127.0.0.1:4200/api/daily-logs-dates
```

## Troubleshooting

### Problem: "Previous day folder not found"
**Cause**: No files were created in yesterday's dated folder
**Solution**: This is normal if there are no invoices. The system will try again tomorrow.

### Problem: Files not processed at 6 AM
**Check**:
1. Is the server running? Check console output
2. Do files exist in the previous day's folder?
3. Check "View Logs" tab for error details

### Problem: Want to verify it's working
**Steps**:
1. Create test JSON files in a dated folder (e.g., `processedArchive\20261115\`)
2. Click "Daily Auto Push" tab
3. Select entity and click "Trigger Daily Auto Push Now"
4. Should show "Successful: [number]"
5. Verify files appear in destination folder

### Problem: Need to see detailed error information
**Steps**:
1. Click "View Logs" tab
2. Select today's date
3. Look at "Run Details" section for specific errors

## File Path Reference

### Source (Where Files Are Read From)
```
C:\Users\EKaranja\AppData\EbmData\<EntityID>\Data\processed\processedArchive\<YYYYMMDD>\
```

**Example**:
```
C:\Users\EKaranja\AppData\EbmData\P000592722P_00\Data\processed\processedArchive\20261115\
  ├── invoice_001.json
  ├── invoice_002.json
  └── invoice_003.json
```

### Destination (Where Files Are Moved To)
```
C:\Users\EKaranja\AppData\EbmData\<EntityID>\Data\resend\trnsSales\
```

### Logs (Where Results Are Stored)
```
D:\Projects\fcl\eTIMS-transmission-nodejs\logs\
  └── 2026-11-16.json (event log)

C:\Users\EKaranja\AppData\EbmData\logs\daily-auto-push\
  └── 2026\11\
      └── 16.json (daily log)
```

## Daily Workflow Example

### Monday, November 15, 2026
- ✅ 6:00 AM: System processes November 14's files
- ✅ Files moved to transmission queue
- 📝 Logs recorded for verification

### Tuesday, November 16, 2026
- ✅ 6:00 AM: System processes November 15's files
- ✅ Files moved to transmission queue
- 📝 Logs recorded for verification
- 💻 You can view yesterday's logs in the UI

### Wednesday, November 17, 2026
- ✅ 6:00 AM: System processes November 16's files
- ✅ You can manually check yesterday's results
- Click "View Logs" → Select November 16 → See statistics

## Important Notes

⚠️ **Cron Schedule**: Currently set to 6 AM Nairobi time (3 AM UTC)
- To change time: Edit `lib/scheduler.js` function `getNairobiCronExpression()`

⚠️ **All Entities**: Scheduler automatically runs for all configured entities
- Farmerschoice
- Flamingo

⚠️ **Auto-Logging**: All activities are automatically logged
- No manual log entry needed
- Logs are automatically organized by date
- Can be cleaned up after N days if needed

⚠️ **No Duplicates**: Files won't be processed twice
- Once moved to destination folder, they're gone from source
- Prevents re-processing the same invoices

## Need Help?

1. **Check Server Logs**: Run `npm start` to see real-time logs
2. **View Event Logs**: Open `logs\2026-11-16.json` in the project folder
3. **Use View Logs Tab**: See detailed statistics for any date
4. **Check Scheduler Status**: Verify when next run is scheduled
5. **Manual Test**: Click "Trigger Daily Auto Push Now" to test immediately

## Success Indicators

✅ You'll know it's working when:
1. Console shows "Daily auto push scheduled" messages at startup
2. Scheduler Status shows "Running ✓" with next run times
3. Files move from `processedArchive\YYYYMMDD\` to `resend\trnsSales\`
4. Logs appear in View Logs tab after each run
5. Statistics show "Successful" count matching number of files

🎉 That's it! The system is now automatically re-transmitting invoices daily at 6 AM!
