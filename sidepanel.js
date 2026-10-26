import { scanPage, highlightComment, fillReply, fillOpenReplyBox } from './scanner.js';
import { TONES, DEFAULTS, callOpenRouter as aiCall, buildMessages as aiBuild } from './ai.js';

const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULTS };
let state = { tabId: null, postText: '', comments: [] }; // comment: {id, author, text, isReply, parentAuthor, hasMedia, draft, busy, error, done}
let editingSnippet = -1;

// ---------- storage ----------
async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  settings = { ...DEFAULTS, ...stored };
}
async function saveSettings(patch) {
  Object.assign(settings, patch);
  await chrome.storage.local.set(patch);
}

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
  })
);
function showTab(name) { document.querySelector(`.tab[data-tab="${name}"]`).click(); }

function setStatus(el, msg, kind = '') {
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

// ---------- settings UI ----------
function fillToneSelect(sel) {
  sel.innerHTML = '';
  for (const k of Object.keys(TONES)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = k[0].toUpperCase() + k.slice(1);
    sel.appendChild(o);
  }
}

function renderSettings() {
  $('apiKey').value = settings.apiKey;
  $('model').value = settings.model;
  $('tone').value = settings.tone;
  $('toneQuick').value = settings.tone;
  $('length').value = settings.replyLength;
  $('myName').value = settings.myName;
  $('extra').value = settings.extra;
  $('optExpand').checked = settings.optExpand;
  $('optReplies').checked = settings.optReplies;
  $('optSkipMine').checked = settings.optSkipMine;
  $('inPageToolbar').checked = settings.inPageToolbar;
}

$('toggleKey').addEventListener('click', () => {
  const k = $('apiKey');
  k.type = k.type === 'password' ? 'text' : 'password';
  $('toggleKey').textContent = k.type === 'password' ? 'Show' : 'Hide';
});

$('saveSettings').addEventListener('click', async () => {
  await saveSettings({
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim() || DEFAULTS.model,
    tone: $('tone').value,
    replyLength: $('length').value,
    myName: $('myName').value.trim(),
    extra: $('extra').value.trim(),
  });
  $('toneQuick').value = settings.tone;
  setStatus($('settingsStatus'), 'Saved.', 'ok');
});

$('testKey').addEventListener('click', async () => {
  const st = $('settingsStatus');
  setStatus(st, 'Testing…');
  try {
    const out = await callOpenRouter(
      [{ role: 'user', content: 'Reply with the single word OK.' }],
      { apiKey: $('apiKey').value.trim(), model: $('model').value.trim() || DEFAULTS.model }
    );
    setStatus(st, 'Connected. Model replied: ' + out.slice(0, 60), 'ok');
  } catch (e) {
    setStatus(st, e.message, 'err');
  }
});

for (const id of ['optExpand', 'optReplies', 'optSkipMine', 'inPageToolbar']) {
  $(id).addEventListener('change', () => saveSettings({ [id]: $(id).checked }));
}
$('toneQuick').addEventListener('change', () => {
  saveSettings({ tone: $('toneQuick').value });
  $('tone').value = settings.tone;
});

async function loadModelList() {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models');
    if (!r.ok) return;
    const { data } = await r.json();
    const dl = $('modelList');
    dl.innerHTML = '';
    for (const m of data || []) {
      const o = document.createElement('option');
      o.value = m.id;
      o.label = m.name || m.id;
      dl.appendChild(o);
    }
  } catch { /* offline: free-text model id still works */ }
}

// ---------- OpenRouter ----------
const callOpenRouter = (messages, opts = {}) =>
  aiCall(messages, { apiKey: opts.apiKey ?? settings.apiKey, model: opts.model ?? settings.model });
const buildMessages = (c) => aiBuild(settings, state.postText, c);

async function draftFor(c) {
  c.busy = true; c.error = '';
  renderComment(c);
  try {
    c.draft = await callOpenRouter(buildMessages(c));
  } catch (e) {
    c.error = e.message;
  }
  c.busy = false;
  renderComment(c);
}

async function draftAll() {
  const todo = visibleComments().filter((c) => c.text && !c.draft && !c.busy);
  if (!todo.length) return;
  if (!settings.apiKey) { showTab('settings'); setStatus($('settingsStatus'), 'Add your OpenRouter API key first.', 'err'); return; }
  $('genAllBtn').disabled = true;
  let i = 0, done = 0;
  const worker = async () => {
    while (i < todo.length) {
      const c = todo[i++];
      await draftFor(c);
      done++;
      setStatus($('status'), `Drafting… ${done}/${todo.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  setStatus($('status'), `Drafted ${done} repl${done === 1 ? 'y' : 'ies'}.`, 'ok');
  $('genAllBtn').disabled = false;
}

// ---------- scanning ----------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function scan() {
  const st = $('status');
  const tab = await activeTab();
  if (!tab || !/^https:\/\/([a-z0-9-]+\.)*facebook\.com\//.test(tab.url || '')) {
    setStatus(st, 'Open a Facebook post in this tab first.', 'err');
    return;
  }
  $('scanBtn').disabled = true;
  setStatus(st, settings.optExpand ? 'Loading all comments and replies… this can take a few seconds.' : 'Reading comments…');
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanPage,
      args: [{ expand: settings.optExpand, includeReplies: settings.optReplies }],
    });
    state.tabId = tab.id;
    state.postText = result.postText;
    const mine = settings.myName.toLowerCase();
    // Keep drafts for comments we already had.
    const prev = new Map(state.comments.map((c) => [c.author + '|' + c.text, c]));
    state.comments = result.comments
      .filter((c) => !(settings.optSkipMine && mine && c.author.toLowerCase() === mine))
      .map((c) => {
        const old = prev.get(c.author + '|' + c.text);
        return { ...c, draft: old?.draft || '', done: old?.done || false, busy: false, error: '' };
      });
    $('postText').value = state.postText;
    $('postBox').hidden = !state.postText;
    renderAll();
    const n = state.comments.length;
    if (!n) setStatus(st, 'No comments found. Make sure the post and its comments are visible, then scan again.', 'err');
    else setStatus(st, `Found ${n} comment${n === 1 ? '' : 's'}.`, 'ok');
  } catch (e) {
    setStatus(st, 'Could not read the page: ' + e.message, 'err');
  }
  $('scanBtn').disabled = false;
}

$('scanBtn').addEventListener('click', scan);
$('genAllBtn').addEventListener('click', draftAll);
$('postText').addEventListener('input', () => { state.postText = $('postText').value; });
$('filter').addEventListener('input', renderAll);

// ---------- rendering ----------
function firstName(name) { return (name || '').split(/\s+/)[0] || ''; }
function fillSnippet(text, c) { const n = c ? firstName(c.author) : ''; return (n ? text.replace(/\{name\}/gi, n) : text.replace(/,?\s*\{name\}/gi, '')).replace(/\s+([!,.?।])/g, '$1').trim(); }

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = old; }, 1200);
  } catch {
    btn.textContent = 'Copy failed';
  }
}

function visibleComments() {
  const q = $('filter').value.trim().toLowerCase();
  if (!q) return state.comments;
  return state.comments.filter((c) => (c.author + ' ' + c.text).toLowerCase().includes(q));
}

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

function renderAll() {
  const box = $('comments');
  box.innerHTML = '';
  for (const c of visibleComments()) {
    const card = el('div');
    card.dataset.id = c.id;
    box.appendChild(card);
    renderComment(c, card);
  }
  const has = state.comments.length > 0;
  $('empty').hidden = has;
  $('filterBar').hidden = !has;
  $('genAllBtn').disabled = !has;
}

function renderComment(c, card = document.querySelector(`#comments [data-id="${c.id}"]`)) {
  if (!card) return;
  card.className = 'card' + (c.isReply ? ' reply' : '') + (c.done ? ' done' : '');
  card.innerHTML = '';

  const locate = el('button', { className: 'small', textContent: 'Show on page', title: 'Scroll Facebook to this comment' });
  locate.onclick = () => chrome.scripting.executeScript({ target: { tabId: state.tabId }, func: highlightComment, args: [c.id, c.author, c.text] }).catch(() => {});

  card.append(
    el('div', { className: 'head' },
      el('span', { className: 'author', textContent: c.author }),
      el('span', { className: 'meta', textContent: c.isReply ? 'reply' + (c.parentAuthor ? ' to ' + c.parentAuthor : '') : '' })),
    el('div', { className: 'text', textContent: c.text || (c.hasMedia ? '(sticker, photo or GIF only)' : '(no text)') })
  );

  const draft = el('textarea', { className: 'draft', rows: 3, placeholder: c.busy ? 'Drafting…' : 'Draft a reply with AI, pick a snippet, or type here.', value: c.draft || '' });
  draft.oninput = () => { c.draft = draft.value; };

  const gen = el('button', { className: 'small', textContent: c.busy ? 'Drafting…' : c.draft ? 'Redo' : 'Draft', disabled: c.busy || !c.text });
  gen.onclick = () => draftFor(c);

  const snip = el('select', { title: 'Fill a saved snippet into the reply box' });
  snip.append(el('option', { value: '', textContent: 'Snippet…' }));
  settings.snippets.forEach((s, i) => snip.append(el('option', { value: String(i), textContent: s.title })));
  const fillBtn = el('button', { className: 'small primary', textContent: 'Fill reply', title: 'Open the reply box on Facebook and type this draft. You press Enter to post.' });
  const doFill = async () => {
    const text = draft.value.trim();
    if (!text) return;
    fillBtn.disabled = true;
    fillBtn.textContent = 'Filling…';
    let res;
    try {
      [{ result: res }] = await chrome.scripting.executeScript({ target: { tabId: state.tabId }, func: fillReply, args: [c.id, text, c.author, c.text] });
    } catch (e) {
      res = { ok: false, reason: e.message };
    }
    fillBtn.disabled = false;
    card.querySelector('.err')?.remove();
    if (res && res.ok) {
      fillBtn.textContent = 'Filled ✓';
      c.done = true;
      card.classList.add('done');
      c.error = '';
      // Hand focus to the page so pressing Enter posts the reply.
      chrome.tabs.update(state.tabId, { active: true }).catch(() => {});
      setTimeout(() => { fillBtn.textContent = 'Fill reply'; }, 1500);
    } else {
      fillBtn.textContent = 'Fill reply';
      c.error = (res && res.reason) || 'Could not fill the reply box.';
      card.append(el('div', { className: 'err', textContent: c.error }));
    }
  };
  fillBtn.onclick = doFill;

  // Picking a snippet puts it in the draft and fills Facebook's reply box.
  snip.onchange = () => {
    if (snip.value === '') return;
    c.draft = fillSnippet(settings.snippets[+snip.value].text, c);
    draft.value = c.draft;
    snip.value = '';
    doFill();
  };

  const copyBtn = el('button', { className: 'small', textContent: 'Copy' });
  copyBtn.onclick = async () => {
    await copy(draft.value, copyBtn);
    c.done = true;
    card.classList.add('done');
  };

  card.append(draft, el('div', { className: 'actions' }, gen, snip),
    el('div', { className: 'actions' }, fillBtn, copyBtn, locate));
  if (c.error) card.append(el('div', { className: 'err', textContent: c.error }));
}

// ---------- snippets ----------
function renderSnippets() {
  const list = $('snippetList');
  list.innerHTML = '';
  if (!settings.snippets.length) list.append(el('p', { className: 'hint', textContent: 'No snippets yet.' }));
  settings.snippets.forEach((s, i) => {
    const fillBtn = el('button', { className: 'small primary', textContent: 'Fill', title: 'Type into the reply box that is open on Facebook' });
    fillBtn.onclick = () => fillOpenBox(s.text, fillBtn);
    const edit = el('button', { className: 'small', textContent: 'Edit' });
    edit.onclick = () => {
      editingSnippet = i;
      $('snipTitle').value = s.title; $('snipText').value = s.text;
      $('snipSave').textContent = 'Save changes'; $('snipCancel').hidden = false;
      $('snipText').focus();
    };
    const del = el('button', { className: 'small', textContent: 'Delete' });
    del.onclick = async () => {
      const next = settings.snippets.filter((_, j) => j !== i);
      await saveSettings({ snippets: next });
      resetSnippetForm(); renderSnippets(); renderAll();
    };
    list.append(el('div', { className: 'card snip' },
      el('div', { className: 'author', textContent: s.title }),
      el('div', { className: 'snip-text', textContent: s.text }),
      el('div', { className: 'actions' }, fillBtn, edit, del)));
  });
}

// Snippets tab: type into whichever Facebook reply box was used last. If the
// box belongs to a scanned comment, {name} becomes that commenter's name.
async function fillOpenBox(text, btn) {
  const tab = state.tabId ? { id: state.tabId } : await activeTab();
  let res;
  try {
    [{ result: res }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillOpenReplyBox, args: [text] });
  } catch (e) {
    res = { ok: false, reason: e.message };
  }
  const old = btn.textContent;
  if (res && res.ok) {
    btn.textContent = 'Filled ✓';
    chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  } else {
    await navigator.clipboard.writeText(fillSnippet(text, null)).catch(() => {});
    btn.textContent = 'Copied';
    btn.title = 'No reply box is open on Facebook, so the snippet was copied instead. Click Reply on a comment first, or pick the snippet from a comment card.';
  }
  setTimeout(() => { btn.textContent = old; }, 1800);
}

function resetSnippetForm() {
  editingSnippet = -1;
  $('snipTitle').value = ''; $('snipText').value = '';
  $('snipSave').textContent = 'Add snippet'; $('snipCancel').hidden = true;
}

$('snipSave').addEventListener('click', async () => {
  const text = $('snipText').value.trim();
  if (!text) return;
  const title = $('snipTitle').value.trim() || text.slice(0, 24);
  const next = [...settings.snippets];
  if (editingSnippet >= 0) next[editingSnippet] = { title, text };
  else next.push({ title, text });
  await saveSettings({ snippets: next });
  resetSnippetForm(); renderSnippets(); renderAll();
});
$('snipCancel').addEventListener('click', resetSnippetForm);

// ---------- updates ----------
// An unpacked extension can't update itself. This compares the installed
// version with the one on GitHub and tells you when to pull and reload.
const UPDATE_REPO = 'atiq31416/fb-ai-reply';
const UPDATE_BRANCH = 'main';

function newerVersion(remote, local) {
  const a = remote.split('.').map(Number), b = local.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

async function checkForUpdate(manual) {
  const local = chrome.runtime.getManifest().version;
  const st = $('updateStatus');
  if (manual) setStatus(st, 'Checking GitHub…');
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${UPDATE_REPO}/${UPDATE_BRANCH}/manifest.json`, { cache: 'no-store' });
    if (!r.ok) throw new Error('GitHub returned ' + r.status + (r.status === 404 ? ' (is the repo public?)' : ''));
    const remote = (await r.json()).version;
    if (newerVersion(remote, local)) {
      const banner = $('updateBanner');
      banner.hidden = false;
      banner.innerHTML = '';
      const btn = el('button', { className: 'small', textContent: 'Reload' });
      btn.onclick = () => chrome.runtime.reload();
      banner.append(`Version ${remote} is on GitHub (you have ${local}). Pull the latest code, then `, btn);
      if (manual) setStatus(st, `Update available: ${remote}.`, 'ok');
    } else if (manual) {
      setStatus(st, `You're up to date (${local}).`, 'ok');
    }
  } catch (e) {
    if (manual) setStatus(st, 'Could not check: ' + e.message, 'err');
  }
}

$('checkUpdate').addEventListener('click', () => checkForUpdate(true));
$('reloadExt').addEventListener('click', () => chrome.runtime.reload());

// ---------- init ----------
(async function init() {
  fillToneSelect($('tone'));
  fillToneSelect($('toneQuick'));
  await loadSettings();
  renderSettings();
  renderSnippets();
  renderAll();
  if (!settings.apiKey) setStatus($('status'), 'First add your OpenRouter API key in Settings.');
  $('curVersion').textContent = chrome.runtime.getManifest().version;
  loadModelList();
  checkForUpdate(false);
})();
