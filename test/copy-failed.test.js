const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function createElement() {
  return {
    children: [],
    dataset: {},
    classList: { toggle() {}, contains() { return false; } },
    style: {},
    hidden: false,
    textContent: '',
    value: '',
    addEventListener(type, handler) { this[type] = handler; },
    appendChild(child) { this.children.push(child); },
    append(...children) { this.children.push(...children); },
    focus() { this.focused = true; },
    select() { this.selected = true; },
    scrollIntoView() {}
  };
}

async function setup({ clipboard, execCommand = () => false, events = [] } = {}) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    createElement,
    execCommand
  };
  const context = vm.createContext({
    document,
    navigator: { clipboard },
    console: { warn() {}, error() {} },
    setTimeout() {},
    TextDecoder,
    fetch: async (url) => {
      if (url === '/api/entities') {
        return { json: async () => ({ entities: [{ id: 'test', name: 'Test', default: true }] }) };
      }
      if (url === '/api/transmit-bulk') {
        let sent = false;
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: async () => {
                if (sent) return { done: true };
                sent = true;
                return { done: false, value: new TextEncoder().encode(events.map(event => JSON.stringify(event)).join('\n') + '\n') };
              }
            })
          }
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  vm.runInContext(app, context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, elements };
}

test('copies failed invoices with the Clipboard API', async () => {
  let copied;
  const { context, elements } = await setup({
    clipboard: { writeText: async text => { copied = text; } },
    execCommand: () => { throw new Error('Fallback should not run'); }
  });

  assert.equal(await vm.runInContext("copyFailedInvoices(['A', 'B'])", context), true);
  assert.equal(copied, 'A\nB');
  assert.equal(elements.get('copy-failed-manual').hidden, true);
});

test('uses the legacy copy command when the Clipboard API is unavailable or denied', async () => {
  for (const clipboard of [undefined, { writeText: async () => { throw new Error('denied'); } }]) {
    let command;
    const { context, elements } = await setup({
      clipboard,
      execCommand: value => { command = value; return true; }
    });

    assert.equal(await vm.runInContext("copyFailedInvoices(['A', 'B'])", context), true);
    assert.equal(command, 'copy');
    assert.equal(elements.get('copy-failed-text').value, 'A\nB');
    assert.equal(elements.get('copy-failed-text').selected, true);
    assert.equal(elements.get('copy-failed-manual').hidden, true);
  }
});

test('offers selected text for manual copying when automatic copying fails', async () => {
  for (const execCommand of [() => false, () => { throw new Error('denied'); }]) {
    const { context, elements } = await setup({ execCommand });
    assert.equal(await vm.runInContext("copyFailedInvoices(['A', 'B'])", context), false);
    assert.equal(elements.get('copy-failed-manual').hidden, false);
    assert.equal(elements.get('copy-failed-text').value, 'A\nB');
    assert.equal(elements.get('copy-failed-text').selected, true);
  }
});

test('copies only failed rows and clears the manual fallback for a new batch', async () => {
  const { elements } = await setup({
    events: [
      { type: 'result', index: 0, ok: false, message: 'Not found' },
      { type: 'result', index: 1, ok: true },
      { type: 'result', index: 2, ok: false, message: 'Not found' },
      { type: 'done' }
    ]
  });
  elements.get('bulk-input').value = 'A\nB\nC';
  const submit = () => elements.get('bulk-form').submit({ preventDefault() {} });
  await submit();
  await elements.get('copy-failed-btn').onclick();
  assert.equal(elements.get('copy-failed-text').value, 'A\nC');
  assert.equal(elements.get('copy-failed-manual').hidden, false);

  await submit();
  assert.equal(elements.get('copy-failed-manual').hidden, true);
});

test('includes interrupted and pending invoices in the copy list', async () => {
  let copied;
  const { elements } = await setup({
    clipboard: { writeText: async text => { copied = text; } },
    events: [
      { type: 'result', index: 0, ok: true },
      { type: 'start', index: 1, invoiceNumber: 'B' }
    ]
  });
  elements.get('bulk-input').value = 'A\nB\nC';
  await elements.get('bulk-form').submit({ preventDefault() {} });
  assert.equal(elements.get('bulk-summary').textContent, '3 / 3 processed — 1 succeeded, 2 failed');
  assert.equal(elements.get('copy-failed-btn').hidden, false);
  await elements.get('copy-failed-btn').onclick();
  assert.equal(copied, 'B\nC');
});
