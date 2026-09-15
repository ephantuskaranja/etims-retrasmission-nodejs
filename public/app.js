const entityOptionsEl = document.getElementById('entity-options');
const form = document.getElementById('transmit-form');
const invoiceInput = document.getElementById('invoice-number');
const submitBtn = document.getElementById('submit-btn');
const resultEl = document.getElementById('result');

let selectedEntityId = null;

async function loadEntities() {
  const res = await fetch('/api/entities');
  const entities = await res.json();

  entityOptionsEl.innerHTML = '';
  entities.forEach((entity) => {
    const el = document.createElement('div');
    el.className = 'entity-option' + (entity.default ? ' selected' : '');
    el.textContent = entity.name;
    el.dataset.id = entity.id;
    el.addEventListener('click', () => selectEntity(entity.id));
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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  resultEl.hidden = true;

  const invoiceNumber = invoiceInput.value.trim();
  if (!selectedEntityId || !invoiceNumber) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Retransmitting…';

  try {
    const res = await fetch('/api/transmit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceNumber, entityId: selectedEntityId })
    });
    const data = await res.json();

    if (res.ok) {
      showResult(data.message, true);
      form.reset();
      selectEntity(selectedEntityId);
    } else {
      let message = data.error;
      if (data.matches) {
        message += ' Matches: ' + data.matches.join(', ');
      }
      showResult(message, false);
    }
  } catch {
    showResult('Could not reach the retransmission service. Is the server running?', false);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Retransmit';
  }
});

loadEntities();
