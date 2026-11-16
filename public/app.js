const entityOptionsEl = document.getElementById('entity-options');
const modeTabsEl = document.getElementById('mode-tabs');

const singleForm = document.getElementById('single-form');
const invoiceInput = document.getElementById('invoice-number');
const submitBtn = document.getElementById('submit-btn');
const resultEl = document.getElementById('result');

const bulkForm = document.getElementById('bulk-form');
const bulkInput = document.getElementById('bulk-input');
const bulkSubmitBtn = document.getElementById('bulk-submit-btn');
const bulkProgressEl = document.getElementById('bulk-progress');
const bulkResultsEl = document.getElementById('bulk-results');
const bulkSummaryEl = document.getElementById('bulk-summary');
const bulkResultsBody = document.getElementById('bulk-results-body');
const copyFailedBtn = document.getElementById('copy-failed-btn');
const copyFailedManual = document.getElementById('copy-failed-manual');
const copyFailedText = document.getElementById('copy-failed-text');

let maxBulkItems = 1000; // overwritten by loadEntities() with the server's actual configured cap
let selectedEntityId = null;
let isProcessing = false;

async function loadEntities() {
  const res = await fetch('/api/entities');
  const data = await res.json();
  const entities = data.entities || [];
  if (data.maxBulkItems) maxBulkItems = data.maxBulkItems;

  entityOptionsEl.innerHTML = '';
  entities.forEach((entity) => {
    const el = document.createElement('div');
    el.className = 'entity-option' + (entity.default ? ' selected' : '');
    el.textContent = entity.name;
    el.dataset.id = entity.id;
    el.addEventListener('click', () => {
      if (!isProcessing) selectEntity(entity.id);
    });
    entityOptionsEl.appendChild(el);

    if (entity.default) selectedEntityId = entity.id;
  });
}

function selectEntity(entityId) {
  selectedEntityId = entityId;
  [...entityOptionsEl.children].forEach((el) => {
    el.classList.toggle('selected', el.dataset.id === entityId);
  });
}

function showResult(message, isSuccess) {
  resultEl.hidden = false;
  resultEl.className = 'result ' + (isSuccess ? 'success' : 'error');
  resultEl.textContent = message;
}

// --- Mode tabs ---

modeTabsEl.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab || isProcessing) return;

  [...modeTabsEl.children].forEach((el) => el.classList.toggle('selected', el === tab));
  const mode = tab.dataset.mode;
  singleForm.hidden = mode !== 'single';
  bulkForm.hidden = mode !== 'bulk';
});

// --- Single transmit ---

singleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  resultEl.hidden = true;

  const invoiceNumber = invoiceInput.value.trim();
  if (!selectedEntityId || !invoiceNumber) return;

  isProcessing = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Retransmitting…';

  try {
    const data = await callTransmit(invoiceNumber, selectedEntityId);
    if (data.ok) {
      showResult(data.message, true);
      singleForm.reset();
    } else {
      showResult(data.displayMessage, false);
    }
  } finally {
    isProcessing = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Retransmit';
  }
});

// --- Shared call to the transmit API ---

async function callTransmit(invoiceNumber, entityId) {
  try {
    const res = await fetch('/api/transmit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceNumber, entityId })
    });
    const data = await res.json();

    if (res.ok) {
      return { ok: true, message: data.message, fileName: data.fileName };
    }

    let displayMessage = data.error;
    if (data.matches) {
      displayMessage += ' Matches: ' + data.matches.join(', ');
    }
    return { ok: false, displayMessage };
  } catch {
    return { ok: false, displayMessage: 'Could not reach the retransmission service. Is the server running?' };
  }
}

// --- Bulk transmit ---

function parseBulkInput(raw) {
  // Accepts invoice numbers separated by newlines, "|", or a mix of both.
  return raw
    .split(/\r?\n|\|/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildBulkRow(invoiceNumber) {
  const row = document.createElement('tr');
  row.className = 'row-pending';

  const invoiceCell = document.createElement('td');
  invoiceCell.textContent = invoiceNumber;

  const statusCell = document.createElement('td');
  statusCell.className = 'status-cell';
  statusCell.textContent = 'Pending';

  const detailCell = document.createElement('td');
  detailCell.className = 'detail-cell';
  detailCell.textContent = '—';

  row.append(invoiceCell, statusCell, detailCell);
  return { row, statusCell, detailCell };
}

function updateSummary(succeeded, failed, total, done) {
  bulkSummaryEl.textContent = `${done} / ${total} processed — ${succeeded} succeeded, ${failed} failed`;
}

async function copyFailedInvoices(invoiceNumbers) {
  const text = invoiceNumbers.join('\n');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      copyFailedManual.hidden = true;
      return true;
    } catch (err) {
      console.warn('Clipboard API copy failed; trying the browser fallback.', err);
    }
  }

  copyFailedText.value = text;
  copyFailedManual.hidden = false;
  copyFailedText.focus();
  copyFailedText.select();
  try {
    if (document.execCommand('copy')) {
      copyFailedManual.hidden = true;
      copyFailedBtn.focus();
      return true;
    }
  } catch (err) {
    console.warn('Browser copy fallback failed.', err);
  }
  return false;
}

bulkForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const invoiceNumbers = parseBulkInput(bulkInput.value);
  if (!selectedEntityId || invoiceNumbers.length === 0) return;

  isProcessing = true;
  bulkSubmitBtn.disabled = true;
  bulkInput.disabled = true;
  copyFailedBtn.hidden = true;
  copyFailedBtn.textContent = 'Copy failed';
  copyFailedManual.hidden = true;

  bulkProgressEl.hidden = false;
  bulkProgressEl.className = 'bulk-progress';
  bulkProgressEl.textContent = `Starting — 0 / ${invoiceNumbers.length} processed.`;
  bulkResultsEl.hidden = false;
  bulkResultsBody.innerHTML = '';

  const rows = invoiceNumbers.map((invoiceNumber) => ({
    invoiceNumber,
    ...buildBulkRow(invoiceNumber)
  }));
  rows.forEach(({ row }) => bulkResultsBody.appendChild(row));

  let succeeded = 0;
  let failed = 0;
  const failedInvoiceNumbers = [];
  updateSummary(0, 0, rows.length, 0);

  const markFailed = (index, message) => {
    const { invoiceNumber, row, statusCell, detailCell } = rows[index];
    failed += 1;
    failedInvoiceNumbers.push(invoiceNumber);
    row.className = 'row-fail';
    statusCell.textContent = 'Failed';
    detailCell.textContent = message;
  };

  // Mark both pending and interrupted rows as unconfirmed failures.
  const failRemaining = (message) => {
    rows.forEach((r, i) => {
      if (r.row.className === 'row-pending' || r.row.className === 'row-active') markFailed(i, message);
    });
    updateSummary(succeeded, failed, rows.length, succeeded + failed);
  };

  // A paste larger than the server's per-request cap is split into chunks
  // of maxBulkItems and sent one chunk after another, so the user pastes
  // once but the server never sees more than its cap in one request. Each
  // chunk only starts after the previous one has fully finished, so moves
  // stay strictly one at a time across the whole paste. Returns false if
  // the run should stop (rejected request, fatal error, dropped connection).
  const runChunk = async (chunk, offset, chunkLabel) => {
    const res = await fetch('/api/transmit-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceNumbers: chunk, entityId: selectedEntityId })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const message = data.error || 'Bulk request was rejected.';
      bulkProgressEl.className = 'bulk-progress error';
      bulkProgressEl.textContent = message;
      failRemaining(message);
      return false;
    }

    // Server processes the chunk strictly one invoice at a time and streams
    // a line back per event as it happens, so the UI updates live. Event
    // indices are relative to the chunk, hence the offset.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    let finished = false;

    while (!done) {
      const chunkRead = await reader.read();
      done = chunkRead.done;
      if (chunkRead.value) buffer += decoder.decode(chunkRead.value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) continue;

        const event = JSON.parse(line);
        const index = offset + (event.index || 0);

        if (event.type === 'start') {
          const { row, statusCell } = rows[index];
          row.className = 'row-active';
          statusCell.textContent = 'Processing…';
          row.scrollIntoView({ block: 'nearest' });
          bulkProgressEl.textContent = `${chunkLabel}Processing ${index + 1} of ${rows.length}: ${event.invoiceNumber}`;
        } else if (event.type === 'result') {
          if (event.ok) {
            succeeded += 1;
            const { row, statusCell, detailCell } = rows[index];
            row.className = 'row-success';
            statusCell.textContent = 'Success';
            detailCell.textContent = event.fileName || 'Queued for transmission';
          } else {
            let message = event.message || 'Failed';
            if (event.matches) message += ' Matches: ' + event.matches.join(', ');
            markFailed(index, message);
          }
          updateSummary(succeeded, failed, rows.length, index + 1);
        } else if (event.type === 'fatal') {
          bulkProgressEl.className = 'bulk-progress error';
          bulkProgressEl.textContent = event.message || 'Bulk processing failed.';
          failRemaining(event.message || 'Not processed.');
          return false;
        } else if (event.type === 'done') {
          finished = true;
        }
      }
    }

    // Stream ended without a "done" line — the connection dropped mid-chunk.
    if (!finished) throw new Error('Stream ended early');
    return true;
  };

  const chunkCount = Math.ceil(rows.length / maxBulkItems);
  let completed = true;
  try {
    for (let c = 0; c < chunkCount; c++) {
      const offset = c * maxBulkItems;
      const chunk = invoiceNumbers.slice(offset, offset + maxBulkItems);
      const chunkLabel = chunkCount > 1 ? `Batch ${c + 1} of ${chunkCount} — ` : '';
      if (!(await runChunk(chunk, offset, chunkLabel))) {
        completed = false;
        break;
      }
    }
    if (completed) {
      bulkProgressEl.textContent = `Done — ${succeeded} succeeded, ${failed} failed out of ${rows.length}.`;
    }
  } catch {
    bulkProgressEl.className = 'bulk-progress error';
    bulkProgressEl.textContent = 'Could not reach the retransmission service, or the connection dropped mid-batch. Check logs for what completed.';
    // The server keeps working through the chunk it was on even after the
    // client goes away, so these may or may not have been moved — retrying
    // one that was is harmless (it just reports no match).
    failRemaining('Unconfirmed — connection dropped. Check logs, or retry.');
  }

  if (failedInvoiceNumbers.length > 0) {
    copyFailedBtn.hidden = false;
    copyFailedBtn.onclick = async () => {
      if (await copyFailedInvoices(failedInvoiceNumbers)) {
        copyFailedBtn.textContent = 'Copied!';
        setTimeout(() => { copyFailedBtn.textContent = 'Copy failed'; }, 1500);
      } else {
        copyFailedBtn.textContent = 'Copy failed';
      }
    };
  }

  isProcessing = false;
  bulkSubmitBtn.disabled = false;
  bulkInput.disabled = false;
});

// --- Daily Auto Push ---

const dailyAutoForm = document.getElementById('daily-auto-form');
const dailyAutoSubmitBtn = document.getElementById('daily-auto-submit-btn');
const dailyAutoResultEl = document.getElementById('daily-auto-result');
const dailyEntityOptionsEl = document.getElementById('daily-entity-options');
const schedulerStatusEl = document.getElementById('scheduler-status');
const schedulerStatusContentEl = document.getElementById('scheduler-status-content');

let selectedDailyEntityId = null;

function setupDailyAutoForm() {
  const entities = Array.from(entityOptionsEl.children).map(el => ({
    id: el.dataset.id,
    name: el.textContent,
    default: el.classList.contains('selected')
  }));

  dailyEntityOptionsEl.innerHTML = '';
  entities.forEach((entity) => {
    const el = document.createElement('div');
    el.className = 'entity-option' + (entity.default ? ' selected' : '');
    el.textContent = entity.name;
    el.dataset.id = entity.id;
    el.addEventListener('click', () => {
      if (!isProcessing) selectDailyEntity(entity.id);
    });
    dailyEntityOptionsEl.appendChild(el);

    if (entity.default) selectedDailyEntityId = entity.id;
  });
}

function selectDailyEntity(entityId) {
  selectedDailyEntityId = entityId;
  [...dailyEntityOptionsEl.children].forEach((el) => {
    el.classList.toggle('selected', el.dataset.id === entityId);
  });
}

async function loadSchedulerStatus() {
  try {
    const res = await fetch('/api/scheduler-status');
    const data = await res.json();
    
    if (data.isRunning) {
      schedulerStatusEl.style.display = 'block';
      let statusHtml = `<p><strong>Status:</strong> Running ✓</p>`;
      statusHtml += `<p><strong>Total Jobs:</strong> ${data.totalJobs}</p>`;
      
      if (data.jobs && data.jobs.length > 0) {
        statusHtml += '<p><strong>Next Scheduled Runs:</strong></p><ul>';
        data.jobs.forEach(job => {
          const nextRun = job.nextInvocation ? new Date(job.nextInvocation).toLocaleString() : 'Unknown';
          statusHtml += `<li>${job.name.replace('daily-auto-push-', '')}: ${nextRun}</li>`;
        });
        statusHtml += '</ul>';
      }
      
      schedulerStatusContentEl.innerHTML = statusHtml;
    } else {
      schedulerStatusEl.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load scheduler status:', err);
  }
}

dailyAutoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  dailyAutoResultEl.hidden = true;

  if (!selectedDailyEntityId) {
    showDailyAutoResult('Please select an entity', false);
    return;
  }

  isProcessing = true;
  dailyAutoSubmitBtn.disabled = true;
  dailyAutoSubmitBtn.textContent = 'Processing…';

  try {
    const res = await fetch('/api/daily-auto-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: selectedDailyEntityId })
    });
    const data = await res.json();

    if (res.ok) {
      const result = data.result;
      let message = `✓ Daily auto push completed!\n`;
      message += `Files processed: ${result.totalFiles}\n`;
      message += `Successful: ${result.summary.success}\n`;
      message += `Failed: ${result.summary.failed}`;
      
      if (result.message) {
        message = `${result.message}\n${message}`;
      }
      
      showDailyAutoResult(message, true);
      loadSchedulerStatus();
    } else {
      showDailyAutoResult(data.error || 'Failed to trigger daily auto push', false);
    }
  } catch (err) {
    showDailyAutoResult('Could not reach the service. Is the server running?', false);
  } finally {
    isProcessing = false;
    dailyAutoSubmitBtn.disabled = false;
    dailyAutoSubmitBtn.textContent = 'Trigger Daily Auto Push Now';
  }
});

function showDailyAutoResult(message, isSuccess) {
  dailyAutoResultEl.hidden = false;
  dailyAutoResultEl.className = 'result ' + (isSuccess ? 'success' : 'error');
  dailyAutoResultEl.innerHTML = `<pre>${escapeHtml(message)}</pre>`;
}

// --- View Logs ---

const logsForm = document.getElementById('logs-form');
const logDateSelect = document.getElementById('log-date-select');
const viewLogBtn = document.getElementById('view-log-btn');
const logResultEl = document.getElementById('log-result');

async function loadAvailableDates() {
  try {
    const res = await fetch('/api/daily-logs-dates');
    const data = await res.json();
    
    logDateSelect.innerHTML = '<option value="">-- Select a date --</option>';
    
    if (data.availableDates && data.availableDates.length > 0) {
      data.availableDates.forEach(dateStr => {
        const option = document.createElement('option');
        option.value = dateStr;
        
        const year = dateStr.slice(0, 4);
        const month = dateStr.slice(4, 6);
        const day = dateStr.slice(6, 8);
        option.textContent = `${day}/${month}/${year}`;
        
        logDateSelect.appendChild(option);
      });
    } else {
      logDateSelect.innerHTML = '<option value="">No logs available</option>';
    }
  } catch (err) {
    console.error('Failed to load available dates:', err);
    logDateSelect.innerHTML = '<option value="">Failed to load dates</option>';
  }
}

viewLogBtn.addEventListener('click', async () => {
  const dateStr = logDateSelect.value;
  if (!dateStr) {
    showLogResult('Please select a date', false);
    return;
  }

  try {
    const res = await fetch(`/api/daily-logs-summary/${dateStr}`);
    
    if (!res.ok) {
      const data = await res.json();
      showLogResult(data.error || 'Failed to load log', false);
      return;
    }

    const summary = await res.json();
    
    let html = `<h3>Daily Auto Push Summary for ${summary.date}</h3>`;
    html += `<p><strong>Total Runs:</strong> ${summary.totalRuns}</p>`;
    html += `<p><strong>Total Files Processed:</strong> ${summary.totalFilesProcessed}</p>`;
    html += `<p><strong>Successful:</strong> ${summary.totalSuccessful} | <strong>Failed:</strong> ${summary.totalFailed}</p>`;
    
    if (Object.keys(summary.entities).length > 0) {
      html += '<h4>By Entity:</h4><ul>';
      Object.entries(summary.entities).forEach(([entityName, stats]) => {
        html += `<li><strong>${entityName}</strong> - Runs: ${stats.runs}, Files: ${stats.filesProcessed}, Success: ${stats.successful}, Failed: ${stats.failed}</li>`;
      });
      html += '</ul>';
    }
    
    if (summary.runs && summary.runs.length > 0) {
      html += '<h4>Run Details:</h4><pre>' + JSON.stringify(summary.runs, null, 2) + '</pre>';
    }
    
    logResultEl.hidden = false;
    logResultEl.className = 'result success';
    logResultEl.innerHTML = html;
  } catch (err) {
    console.error('Failed to load log:', err);
    showLogResult('Could not reach the service', false);
  }
});

function showLogResult(message, isSuccess) {
  logResultEl.hidden = false;
  logResultEl.className = 'result ' + (isSuccess ? 'success' : 'error');
  logResultEl.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Mode tabs update ---

const originalTabClickHandler = modeTabsEl.onclick;
modeTabsEl.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab || isProcessing) return;

  [...modeTabsEl.children].forEach((el) => el.classList.toggle('selected', el === tab));
  const mode = tab.dataset.mode;
  singleForm.hidden = mode !== 'single';
  bulkForm.hidden = mode !== 'bulk';
  dailyAutoForm.hidden = mode !== 'daily-auto';
  logsForm.hidden = mode !== 'logs';
  
  if (mode === 'daily-auto') {
    setupDailyAutoForm();
    loadSchedulerStatus();
  } else if (mode === 'logs') {
    loadAvailableDates();
  }
});

loadEntities();
