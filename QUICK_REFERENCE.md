# Daily Auto Push - Quick Reference Card

## 🎯 What It Does
Automatically re-transmits yesterday's invoice files every day at **6 AM Nairobi time**.

## 📋 Quick Facts
| Item | Details |
|------|---------|
| **Runs At** | 6:00 AM Nairobi Time (3 AM UTC) |
| **Frequency** | Every day, 7 days a week |
| **Source Folder** | `C:\...\EbmData\<Entity>\Data\processed\processedArchive\<YYYYMMDD>\` |
| **Destination** | `C:\...\EbmData\<Entity>\Data\resend\trnsSales\` |
| **Setup Required** | None - automatic! |
| **Log Location** | Project logs: `logs/YYYY-MM-DD.json` |
| **Daily Log Location** | Data logs: `C:\...\EbmData\logs\daily-auto-push\YYYY\MM\DD.json` |

## 🖱️ How to Use It

### Check Scheduler Status
1. Open: `http://127.0.0.1:4200`
2. Click "Daily Auto Push" tab
3. View "Scheduler Status" box showing next runs

### Manually Trigger
1. Click "Daily Auto Push" tab
2. Select entity
3. Click "Trigger Daily Auto Push Now"
4. View results

### View Past Runs
1. Click "View Logs" tab
2. Select date from dropdown
3. Click "View Log"
4. See statistics and details

## 📊 What Gets Logged

Each run logs:
- ✅ Entity name and ID
- ✅ Date processed (e.g., 20261115)
- ✅ Total files found
- ✅ Files successfully moved
- ✅ Files that failed
- ✅ Individual file details
- ✅ Exact timestamp

## 🔧 API Quick Reference

```bash
# Trigger manually
curl -X POST http://127.0.0.1:4200/api/daily-auto-push \
  -H "Content-Type: application/json" \
  -d '{"entityId": "P000592722P_00"}'

# Check scheduler status
curl http://127.0.0.1:4200/api/scheduler-status

# Get today's logs
curl http://127.0.0.1:4200/api/daily-logs/today

# Get logs for specific date (YYYYMMDD)
curl http://127.0.0.1:4200/api/daily-logs/20261115

# Get summary statistics
curl http://127.0.0.1:4200/api/daily-logs-summary/20261115

# Get available dates with logs
curl http://127.0.0.1:4200/api/daily-logs-dates

# Get recent logs (last 7 days)
curl http://127.0.0.1:4200/api/daily-logs-recent?days=7
```

## ⚙️ Configuration

### Change Schedule Time
**File**: `lib/scheduler.js`
```javascript
function getNairobiCronExpression() {
  return '0 0 3 * * *'; // 3 AM UTC = 6 AM Nairobi
  // Change '3' to different hour if needed
}
```

### Change Paths (if needed)
**File**: `.env`
```env
SOURCE_SUBPATH=Data\processed\processedArchive
DEST_SUBPATH=Data\resend\trnsSales
```

## 🚀 Starting the System

```bash
# Install dependencies (if not done yet)
npm install

# Start server
npm start

# Expected output:
# eTIMS retransmission tool running at http://127.0.0.1:4200
# ✓ Daily auto push scheduled for Farmerschoice at 6 AM Nairobi time
# ✓ Daily auto push scheduled for Flamingo at 6 AM Nairobi time
```

## 🆘 Troubleshooting

### Problem: No logs appearing
**Solution**: Click manual trigger to create logs first

### Problem: Files not moving at 6 AM
**Check**: 
1. Does yesterday's folder exist?
2. Are there JSON files in it?
3. Check View Logs tab for errors

### Problem: "Folder not found" message
**This is normal** if there are no invoices that day. System will retry tomorrow.

### Problem: Verify it's working
**Steps**:
1. Create test JSON files in `processedArchive\YYYYMMDD\`
2. Click "Trigger Daily Auto Push Now"
3. Should show success count
4. Files should move to destination

## 📈 Monitoring Tips

✅ Check scheduler status weekly
✅ Review logs if you see errors
✅ Verify files are being moved to transmission queue
✅ Note: System continues working even if you don't monitor it

## 🎯 Success Indicators

✅ Files moving from `processedArchive` to `resend\trnsSales`
✅ Logs appear in View Logs tab
✅ No errors in scheduler status
✅ Scheduler shows "Running ✓"
✅ Statistics show "Successful" > 0

## 📚 More Info

- **User Guide**: Read `QUICK_START.md`
- **Technical Details**: Read `DAILY_AUTO_PUSH.md`
- **Code Overview**: Read `IMPLEMENTATION_SUMMARY.md`

## ✨ Key Advantages

1. **Zero Setup** - Works automatically
2. **No Pending Items** - Files processed daily
3. **Full History** - Can review any previous day
4. **Manual Control** - Can trigger anytime
5. **Error Tracking** - All failures logged
6. **Entity-Aware** - Works for all entities
7. **Resilient** - Single file failure doesn't block batch

---

**Last Updated**: November 16, 2026
**Version**: 1.0
**Status**: ✅ Production Ready
