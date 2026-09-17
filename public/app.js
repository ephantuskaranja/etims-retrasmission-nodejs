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

const MAX_BULK_ITEMS = 500;

let selectedEntityId = null;
let isProcessing = false;

async function loadEntities() {
  const res = await fetch('/api/entities');
  const entities = await res.json();

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

bulkForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const invoiceNumbers = parseBulkInput(bulkInput.value);
  if (!selectedEntityId || invoiceNumbers.length === 0) return;

  if (invoiceNumbers.length > MAX_BULK_ITEMS) {
    bulkProgressEl.hidden = false;
    bulkProgressEl.className = 'bulk-progress error';
    bulkProgressEl.textContent = `Too many invoice numbers (${invoiceNumbers.length}). Please process at most ${MAX_BULK_ITEMS} at a time.`;
    return;
  }

  isProcessing = true;
  bulkSubmitBtn.disabled = true;
  bulkInput.disabled = true;
  copyFailedBtn.hidden = true;

  bulkProgressEl.hidden = false;
  bulkProgressEl.className = 'bulk-progress';
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

  // Processed strictly one at a time: the next invoice is only sent once the
  // current one's response has come back, so two file moves can never
  // overlap and race each other.
  for (let i = 0; i < rows.length; i++) {
    const { invoiceNumber, row, statusCell, detailCell } = rows[i];

    row.className = 'row-active';
    statusCell.textContent = 'Processing…';
    row.scrollIntoView({ block: 'nearest' });
    bulkProgressEl.textContent = `Processing ${i + 1} of ${rows.length}: ${invoiceNumber}`;

    const result = await callTransmit(invoiceNumber, selectedEntityId);

    if (result.ok) {
      succeeded += 1;
      row.className = 'row-success';
      statusCell.textContent = 'Success';
      detailCell.textContent = result.fileName || 'Queued for transmission';
    } else {
      failed += 1;
      failedInvoiceNumbers.push(invoiceNumber);
      row.className = 'row-fail';
      statusCell.textContent = 'Failed';
      detailCell.textContent = result.displayMessage;
    }

    updateSummary(succeeded, failed, rows.length, i + 1);
  }

  bulkProgressEl.textContent = `Done — ${succeeded} succeeded, ${failed} failed out of ${rows.length}.`;

  if (failedInvoiceNumbers.length > 0) {
    copyFailedBtn.hidden = false;
    copyFailedBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(failedInvoiceNumbers.join('\n'));
        copyFailedBtn.textContent = 'Copied!';
        setTimeout(() => { copyFailedBtn.textContent = 'Copy failed'; }, 1500);
      } catch {
        // Clipboard access can be denied by the browser; nothing to do but leave the button as-is.
      }
    };
  }

  isProcessing = false;
  bulkSubmitBtn.disabled = false;
  bulkInput.disabled = false;
});

loadEntities();
