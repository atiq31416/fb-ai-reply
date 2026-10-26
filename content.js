// In-page toolbar on Facebook's comment and reply boxes: an "AI reply"
// button plus your saved snippets. It only types into the box; you press
// Enter to post.
(() => {
  if (window.__fbrdToolbar) return;
  window.__fbrdToolbar = true;

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => clean(s).toLowerCase();
  const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
  const COMMENT_LABEL = /^(comment|reply)\s+by\s+|(মন্তব্য|উত্তর|জবাব|কমেন্ট|রিপ্লাই)/i;
  const isBox = (el) => el && el.isContentEditable && el.getAttribute && el.getAttribute('role') === 'textbox';

  let snippets = [];
  let tone = 'friendly';
  let enabled = true;
  chrome.storage.local.get(['snippets', 'tone', 'inPageToolbar']).then((s) => {
    snippets = s.snippets || [
      { title: 'Thanks', text: 'Thank you so much, {name}! 🙏' },
      { title: 'ধন্যবাদ', text: 'অনেক ধন্যবাদ {name}! ❤️' },
    ];
    tone = s.tone || tone;
    enabled = s.inPageToolbar !== false;
    renderChips();
  });
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.snippets) { snippets = ch.snippets.newValue || []; renderChips(); }
    if (ch.tone) tone = ch.tone.newValue;
    if (ch.inPageToolbar) { enabled = ch.inPageToolbar.newValue !== false; if (!enabled) hide(); }
  });

  // ---------- find the comment a box replies to ----------
  function authorOf(article) {
    const label = article.getAttribute('aria-label') || '';
    const m = label.match(/^(?:comment|reply)\s+by\s+(.+?)(?:\s+(?:\d+\s*\w*|an?\s+(?:few|minute|hour|day|week|month|year)\w*|about|just|yesterday|on)\b.*)?$/i);
    if (m) return clean(m[1]);
    for (const a of article.querySelectorAll('a[href]')) {
      if (a.closest('[role="article"]') !== article) continue;
      const t = clean(a.textContent);
      if (t && t.length < 80 && !/^\d/.test(t)) return t;
    }
    return '';
  }

  function textOf(article) {
    const author = authorOf(article);
    const parts = [...article.querySelectorAll('div[dir="auto"], span[dir="auto"]')].filter((n) => {
      if (n.closest('[role="article"]') !== article) return false;
      const p = n.parentElement && n.parentElement.closest('[dir="auto"]');
      if (p && p.closest('[role="article"]') === article) return false;
      if (n.closest('a[href]') && clean(n.textContent).length < 60) return false;
      if (n.closest('[role="button"]')) return false;
      return true;
    }).map((n) => clean(n.innerText || n.textContent));
    const t = parts.filter(Boolean).join('\n').replace(/\s*(See translation|অনুবাদ দেখুন|See original)\s*/gi, ' ').trim();
    return t === author ? '' : t;
  }

  function boxLabel(box) {
    return clean(box.getAttribute('aria-label') || box.getAttribute('aria-placeholder') ||
      (box.parentElement && box.parentElement.querySelector('[aria-hidden="true"]') || {}).textContent || '');
  }

  // Returns { article, author, text, isReply, parentAuthor } or null when the
  // box is the post's main "Write a comment" box.
  function targetFor(box) {
    // A box filled by "Fill reply" in the side panel knows its comment.
    if (box.__fbrdTarget && box.__fbrdTarget.isConnected) return describe(box.__fbrdTarget);

    const label = boxLabel(box);
    const replyTo = (label.match(/^reply(?:ing)? to\s+(.+?)[.…]*$/i) || label.match(/^(.+?)\s*(?:-?কে|এর)\s*(?:উত্তর|জবাব)/) || [])[1];
    const comments = [...document.querySelectorAll('[role="article"]')].filter(
      (a) => COMMENT_LABEL.test(a.getAttribute('aria-label') || '') &&
        (a.contains(box) || (a.compareDocumentPosition(box) & FOLLOWING))
    );
    if (!comments.length) return null;
    if (replyTo) {
      const want = norm(replyTo);
      for (let i = comments.length - 1; i >= 0; i--) {
        const au = norm(authorOf(comments[i]));
        if (au && (au === want || au.startsWith(want) || want.startsWith(au))) return describe(comments[i]);
      }
    }
    if (/comment|মন্তব্য|কমেন্ট/i.test(label) && !/reply|উত্তর|জবাব/i.test(label)) return null;
    // A reply box sits under its thread; the last comment above it is the
    // most recent message in that thread.
    return describe(comments[comments.length - 1]);
  }

  function describe(article) {
    const parent = article.parentElement && article.parentElement.closest('[role="article"]');
    const isReply = /^reply\s+by/i.test(article.getAttribute('aria-label') || '') || !!(parent && COMMENT_LABEL.test(parent.getAttribute('aria-label') || ''));
    return { article, author: authorOf(article) || 'the commenter', text: textOf(article), isReply, parentAuthor: isReply && parent ? authorOf(parent) : '' };
  }

  function postText() {
    const scopes = [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.querySelector('[role="article"]'));
    const scope = scopes[scopes.length - 1] || document.querySelector('[role="main"]') || document;
    const msg = scope.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
    return msg ? clean(msg.innerText) : '';
  }

  // ---------- typing into the box ----------
  function insert(box, text) {
    box.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount || !box.contains(sel.anchorNode)) {
      const r = document.createRange();
      r.selectNodeContents(box);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    const before = clean(box.textContent);
    const t = (before && !/\s$/.test(box.textContent) ? ' ' : '') + text;
    let ok = document.execCommand('insertText', false, t);
    if (!ok || clean(box.textContent) === before) {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }
  }

  const firstName = (n) => (n || '').split(/\s+/)[0] || '';
  const fillName = (text, name) => (firstName(name) ? text.replace(/\{name\}/gi, firstName(name)) : text.replace(/,?\s*\{name\}/gi, '')).replace(/\s+([!,.?।])/g, '$1').replace(/^[,\s]+/, '').trim();

  // ---------- toolbar UI (shadow DOM keeps Facebook's CSS out) ----------
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483646;display:none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .bar { display:flex; gap:6px; align-items:center; padding:5px 6px; border-radius:10px;
        font: 12px/1.3 system-ui, "Noto Sans Bengali", sans-serif; overflow-x:auto; scrollbar-width:thin;
        background:#fff; color:#1c1e21; border:1px solid #dadde1; box-shadow:0 2px 8px rgba(0,0,0,.12); }
      @media (prefers-color-scheme: dark) { .bar { background:#242526; color:#e4e6eb; border-color:#3e4042; } }
      button { all:unset; cursor:pointer; white-space:nowrap; padding:4px 9px; border-radius:999px;
        background:rgba(127,127,127,.14); font:inherit; }
      button:hover { background:rgba(127,127,127,.26); }
      button.ai { background:#1877f2; color:#fff; font-weight:600; }
      button.ai:hover { background:#166fe5; }
      button[disabled] { opacity:.55; cursor:default; }
      .msg { white-space:nowrap; color:#e41e3f; }
      .gear { padding:4px 6px; }
    </style>
    <div class="bar">
      <button class="ai" title="Draft a reply with AI and type it here">✨ AI reply</button>
      <span class="chips" style="display:contents"></span>
      <span class="msg"></span>
      <button class="gear" title="Open Reply Drafter (settings, snippets)">⚙</button>
    </div>`;
  const bar = root.querySelector('.bar');
  const aiBtn = root.querySelector('.ai');
  const chips = root.querySelector('.chips');
  const msgEl = root.querySelector('.msg');
  (document.body || document.documentElement).appendChild(host);

  // Keep focus (and the caret) in Facebook's box while clicking the toolbar.
  bar.addEventListener('mousedown', (e) => e.preventDefault());

  let box = null;
  let busy = false;

  function renderChips() {
    chips.innerHTML = '';
    for (const s of snippets) {
      const b = document.createElement('button');
      b.textContent = s.title;
      b.title = s.text;
      b.addEventListener('click', () => {
        if (!box) return;
        const t = targetFor(box);
        insert(box, fillName(s.text, t ? t.author : ''));
      });
      chips.appendChild(b);
    }
  }

  aiBtn.addEventListener('click', async () => {
    if (!box || busy) return;
    const target = box;
    const t = targetFor(target);
    if (!t || !t.text) {
      msgEl.textContent = t ? 'That comment has no text to reply to.' : 'Open a reply box under a comment to use AI.';
      return;
    }
    busy = true;
    aiBtn.disabled = true;
    aiBtn.textContent = '✨ Drafting…';
    msgEl.textContent = '';
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'draft', tone, postText: postText(),
        comment: { author: t.author, text: t.text, isReply: t.isReply, parentAuthor: t.parentAuthor },
      });
      if (res && res.text) insert(target, res.text);
      else msgEl.textContent = (res && res.error) || 'No reply came back.';
    } catch (e) {
      msgEl.textContent = /context invalidated/i.test(e.message) ? 'Extension was reloaded. Refresh this page.' : e.message;
    }
    busy = false;
    aiBtn.disabled = false;
    aiBtn.textContent = '✨ AI reply';
  });

  root.querySelector('.gear').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openPanel' }).catch(() => {}));

  function place() {
    if (!box || !box.isConnected) { if (!busy) hide(); return; }
    const r = box.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const wrap = box.closest('form') || box.parentElement;
    const w = Math.max(260, (wrap ? wrap.getBoundingClientRect().width : r.width));
    const left = Math.min(Math.max(8, r.left - 8), window.innerWidth - w - 8);
    host.style.left = left + 'px';
    host.style.width = w + 'px';
    const h = bar.offsetHeight || 34;
    // Below the box, so the comment being answered stays readable.
    const top = r.bottom + h + 8 <= window.innerHeight ? r.bottom + 6 : Math.max(0, r.top - h - 6);
    host.style.top = top + 'px';
  }

  function show(b) {
    if (!enabled) return;
    if (box !== b) msgEl.textContent = '';
    box = b;
    const t = targetFor(b);
    aiBtn.textContent = '✨ AI reply';
    aiBtn.title = t ? `Draft a reply to ${t.author}` : 'Open a reply box under a comment to use AI';
    host.style.display = 'block';
    place();
  }
  function hide() {
    host.style.display = 'none';
    box = null;
  }

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (isBox(el)) show(el);
  }, true);
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (busy) return;
      const a = document.activeElement;
      if (isBox(a)) show(a);
      else if (!document.hasFocus() && box) { /* window lost focus (e.g. side panel): keep showing */ }
      else hide();
    }, 150);
  }, true);
  window.addEventListener('scroll', () => { if (box) place(); }, true);
  window.addEventListener('resize', () => { if (box) place(); });
  // Facebook re-renders boxes; keep the toolbar attached to the live one.
  setInterval(() => { if (box) place(); }, 500);
})();
