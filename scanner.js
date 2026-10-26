// These functions are injected into the Facebook tab with
// chrome.scripting.executeScript({ func }). Each one must be fully
// self-contained: no references to anything outside its own body.
//
// Facebook's class names are obfuscated and change often, so the scanner
// relies only on roles, aria-labels, dir="auto" text nodes and DOM nesting.

export async function scanPage(opts) {
  const o = Object.assign({ expand: true, maxRounds: 12, includeReplies: true }, opts || {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // --- 1. Find the area that holds the post and its comments -------------
  // A post opened from the feed shows in a dialog; a permalink page uses main.
  function findScope() {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
      (d) => d.querySelector('[role="article"]') && d.offsetParent !== null
    );
    if (dialogs.length) return dialogs[dialogs.length - 1];
    return document.querySelector('[role="main"]') || document.body;
  }
  let scope = findScope();

  // --- 2. Expand "View more comments", "View N replies", "See more" -------
  const EXPAND_PATTERNS = [
    /^(view|see|show)\s+(\d+\s+)?(more|previous|all|other)?\s*(\d+\s+)?(comments?|repl(y|ies))/i,
    /^\d+\s+(more\s+)?repl(y|ies)$/i,
    /^(view|see)\s+(\d+\s+)?more$/i,
    /^see more$/i,
    /replied\s*·\s*\d+\s+repl(y|ies)/i,
    /আরও\s*(\S+\s+)?(মন্তব্য|কমেন্ট)/,
    /(মন্তব্য|কমেন্ট)\s*(গুলি|গুলো)?\s*দেখুন/,
    /(উত্তর|জবাব|রিপ্লাই)\s*(গুলি|গুলো)?\s*দেখুন/,
    /\d+\s*টি?\s*(উত্তর|জবাব|রিপ্লাই)/,
    /[০-৯]+\s*টি?\s*(উত্তর|জবাব|রিপ্লাই)/,
    /^আরও\s*দেখুন$/,
  ];
  const AVOID = /hide|লুকান|write|লিখুন|reply$|উত্তর দিন|like|share|শেয়ার|most relevant|newest|all comments|সবচেয়ে প্রাসঙ্গিক/i;

  function expandCandidates() {
    const els = scope.querySelectorAll('[role="button"], div[tabindex="0"], span[role="button"]');
    const out = [];
    for (const el of els) {
      if (el.dataset.fbrdClicked) continue;
      const t = clean(el.textContent);
      if (!t || t.length > 60) continue;
      if (AVOID.test(t) && !/repl(y|ies)\b.*\d|\d.*repl/i.test(t)) continue;
      if (EXPAND_PATTERNS.some((p) => p.test(t))) out.push(el);
    }
    return out;
  }

  function scrollToBottom() {
    // Scroll the nearest scrollable container so lazy-loaded comments appear.
    let el = scope;
    const candidates = [scope, ...scope.querySelectorAll('div')];
    for (const c of candidates) {
      if (c.scrollHeight > c.clientHeight + 50) {
        const st = getComputedStyle(c).overflowY;
        if (st === 'auto' || st === 'scroll') { el = c; break; }
      }
    }
    if (el === scope && scope === document.body) window.scrollTo(0, document.body.scrollHeight);
    else el.scrollTop = el.scrollHeight;
  }

  let clicks = 0;
  if (o.expand) {
    for (let round = 0; round < o.maxRounds; round++) {
      scrollToBottom();
      await sleep(600);
      scope = findScope();
      const btns = expandCandidates();
      if (!btns.length) {
        if (round > 0) break;
        continue;
      }
      for (const b of btns) {
        b.dataset.fbrdClicked = '1';
        try { b.click(); clicks++; } catch (e) { /* ignore */ }
        await sleep(150);
      }
      await sleep(1200);
    }
    scope = findScope();
  }

  // --- 3. Collect comment articles ---------------------------------------
  // Clear marks from earlier scans so ids never point at two comments.
  document.querySelectorAll('[data-fbrd-id]').forEach((n) => n.removeAttribute('data-fbrd-id'));
  const COMMENT_LABEL = /^(comment|reply)\s+by\s+|(মন্তব্য|উত্তর|জবাব|কমেন্ট|রিপ্লাই)/i;
  const all = [...scope.querySelectorAll('[role="article"]')];
  let comments = all.filter((a) => COMMENT_LABEL.test(a.getAttribute('aria-label') || ''));
  if (!comments.length) {
    // No usable aria-labels: treat any article nested inside another, or any
    // article after the first (the post itself), as a comment.
    comments = all.filter((a, i) => i > 0 || a.parentElement.closest('[role="article"]'));
  }

  function parseAuthorFromLabel(label) {
    const m = label.match(/^(?:comment|reply)\s+by\s+(.+?)(?:\s+(?:\d+\s*\w*|an?\s+(?:few|minute|hour|day|week|month|year)\w*|about|just|yesterday|on)\b.*)?$/i);
    if (m) return clean(m[1]);
    const bn = label.match(/^(.+?)\s+(?:এর|-এর)\s/);
    if (bn) return clean(bn[1]);
    return '';
  }

  function ownTextNodes(article) {
    // dir="auto" blocks that belong to this article, not to a nested reply.
    return [...article.querySelectorAll('div[dir="auto"], span[dir="auto"]')].filter((n) => {
      if (n.closest('[role="article"]') !== article) return false;
      // Skip text inside a dir=auto we already include (avoid duplicates).
      const parentAuto = n.parentElement && n.parentElement.closest('[dir="auto"]');
      if (parentAuto && article.contains(parentAuto) && parentAuto.closest('[role="article"]') === article) return false;
      if (n.closest('a[role="link"], a[href]') && clean(n.textContent).length < 60) return false; // author name / links
      if (n.closest('[role="button"]')) return false;
      return true;
    });
  }

  function authorOf(article) {
    const fromLabel = parseAuthorFromLabel(article.getAttribute('aria-label') || '');
    if (fromLabel) return fromLabel;
    for (const a of article.querySelectorAll('a[href]')) {
      if (a.closest('[role="article"]') !== article) continue;
      const t = clean(a.textContent);
      if (t && t.length < 80 && !/^\d/.test(t)) return t;
    }
    return 'Unknown';
  }

  const seen = new Set();
  const results = [];
  let idx = 0;
  for (const a of comments) {
    const parentComment = a.parentElement && a.parentElement.closest('[role="article"]');
    const label = a.getAttribute('aria-label') || '';
    const isReply = /^reply\s+by/i.test(label) || (parentComment && comments.includes(parentComment));
    if (isReply && !o.includeReplies) continue;

    const author = authorOf(a);
    let text = ownTextNodes(a).map((n) => clean(n.innerText || n.textContent)).filter(Boolean).join('\n');
    text = text.replace(/\s*(See translation|অনুবাদ দেখুন|See original|Rate this translation)\s*/gi, ' ').trim();
    if (text === author) text = '';
    const hasMedia = !!a.querySelector('img[src*="scontent"], img[src*="fbcdn"], video, svg image');

    const key = author + '|' + text;
    if (seen.has(key)) continue;
    seen.add(key);

    const id = 'c' + idx++;
    a.dataset.fbrdId = id;
    results.push({
      id,
      author,
      text,
      isReply: !!isReply,
      parentAuthor: isReply && parentComment ? authorOf(parentComment) : '',
      hasMedia: !text && hasMedia,
    });
  }

  // --- 4. Post text, for context -----------------------------------------
  let postText = '';
  const msg = scope.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
  if (msg) postText = clean(msg.innerText);
  if (!postText) {
    const postArticle = all.find((a) => !comments.includes(a));
    const block = postArticle && postArticle.querySelector('div[dir="auto"]');
    if (block) postText = clean(block.innerText);
  }

  return {
    url: location.href,
    isFacebook: /(^|\.)facebook\.com$/.test(location.hostname),
    postText,
    expandClicks: clicks,
    comments: results,
  };
}

// Finds the comment's article. Facebook re-renders and recycles DOM nodes,
// so the id mark is checked against the comment's text and author, and the
// page is searched again if the mark has drifted to another comment.
// (Duplicated in each injected function because they must be self-contained.)
export function highlightComment(id, author, commentText) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const probe = norm(commentText).slice(0, 40);
  const matches = (a) => (!probe || norm(a.innerText).includes(probe)) && (!author || norm(a.innerText + ' ' + a.getAttribute('aria-label')).includes(norm(author)));
  let el = document.querySelector('[data-fbrd-id="' + id + '"]');
  if (!el || !matches(el)) {
    const own = [...document.querySelectorAll('[role="article"]')].filter(matches);
    el = own.find((a) => !own.some((b) => b !== a && a.contains(b))) || null;
  }
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const prev = el.style.outline;
  el.style.outline = '3px solid #1877f2';
  el.style.outlineOffset = '2px';
  setTimeout(() => { el.style.outline = prev; }, 2500);
  return true;
}

// Opens Facebook's reply box under a comment and types `text` into it.
// It never submits: the user reviews it and presses Enter themselves.
export async function fillReply(id, text, author, commentText) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => clean(s).toLowerCase();
  const FOLLOWS = Node.DOCUMENT_POSITION_FOLLOWING;
  const after = (a, b) => !!(a.compareDocumentPosition(b) & FOLLOWS); // b comes after a

  // 1. Find the right comment.
  const probe = norm(commentText).slice(0, 40);
  const matches = (a) => (!probe || norm(a.innerText).includes(probe)) && (!author || norm(a.innerText + ' ' + a.getAttribute('aria-label')).includes(norm(author)));
  let article = document.querySelector('[data-fbrd-id="' + id + '"]');
  if (!article || !matches(article)) {
    const own = [...document.querySelectorAll('[role="article"]')].filter(matches);
    article = own.find((a) => !own.some((b) => b !== a && a.contains(b))) || null;
  }
  if (!article) return { ok: false, reason: 'Comment not found on the page. Scan again.' };

  // 2. Work out where this comment's thread ends: its reply box must sit
  // after the comment and before the next top-level comment.
  const COMMENT_LABEL = /^(comment|reply)\s+by\s+|(মন্তব্য|উত্তর|জবাব|কমেন্ট|রিপ্লাই)/i;
  const isComment = (a) => a.dataset.fbrdId || COMMENT_LABEL.test(a.getAttribute('aria-label') || '');
  let top = article;
  for (let p = article.parentElement && article.parentElement.closest('[role="article"]'); p; p = p.parentElement && p.parentElement.closest('[role="article"]')) {
    if (isComment(p)) top = p;
  }
  const nextTop = [...document.querySelectorAll('[role="article"]')].find(
    (a) => a !== top && isComment(a) && !top.contains(a) && !a.contains(top) && after(top, a)
  );
  const inThread = (box) => (article.contains(box) || after(article, box)) && (!nextTop || after(box, nextTop));

  // 3. Click this comment's own Reply button (not one in a nested reply).
  const REPLY = /^(reply|উত্তর দিন|জবাব দিন|উত্তর|জবাব|রিপ্লাই)$/i;
  const replyBtn = [...article.querySelectorAll('[role="button"], div[tabindex="0"], span')].find(
    (b) => b.closest('[role="article"]') === article && REPLY.test(clean(b.textContent))
  );
  if (!replyBtn) return { ok: false, reason: 'Could not find the Reply button for this comment.' };

  const boxes = () => [...document.querySelectorAll('[contenteditable="true"][role="textbox"]')];
  const before = new Set(boxes());
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  article.scrollIntoView({ block: 'center' });
  replyBtn.click();

  // 4. Wait for a reply box inside this comment's thread. Prefer a newly
  // opened one; never take a box that belongs to another comment.
  let box = null;
  for (let i = 0; i < 40 && !box; i++) {
    await sleep(100);
    const cands = boxes().filter(inThread);
    const active = document.activeElement;
    box = (active && cands.includes(active) && active) || cands.find((b) => !before.has(b)) || (i >= 10 ? cands[0] : null) || null;
  }
  if (!box) return { ok: false, reason: "The reply box for this comment didn't open. Try again, or use Copy." };

  // 5. Type the draft at the end, after any @mention Facebook pre-fills.
  box.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(box);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  const existing = clean(box.textContent);
  const insert = (existing ? ' ' : '') + text;
  // Facebook's editor listens for real input events; execCommand produces
  // them. A synthetic paste is the fallback.
  let ok = document.execCommand('insertText', false, insert);
  // Facebook applies the insert a moment later; check before falling back,
  // or the text gets typed twice.
  if (ok) await sleep(200);
  if (!ok || !clean(box.textContent).includes(clean(text).slice(0, 20))) {
    const dt = new DataTransfer();
    dt.setData('text/plain', insert);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(100);
    ok = clean(box.textContent).includes(clean(text).slice(0, 20));
  }
  box.__fbrdTarget = article; // lets the in-page toolbar know which comment this box answers
  window.__fbrdLastBox = box;
  window.__fbrdLastAuthor = clean(author).split(' ')[0];
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return ok ? { ok: true } : { ok: false, reason: 'Opened the reply box but could not type into it. Use Copy instead.' };
}

// Types a snippet into the reply box that is focused, or the one Fill reply
// used last. {name} becomes the first name of the comment that box replies to.
export async function fillOpenReplyBox(text) {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const isBox = (el) => el && el.isConnected && el.isContentEditable && el.getAttribute('role') === 'textbox';
  let box = isBox(document.activeElement) ? document.activeElement : window.__fbrdLastBox;
  if (!isBox(box)) return { ok: false, reason: 'No reply box is open.' };

  // The commenter this box replies to: the one Fill reply used last, else
  // the nearest top-level scanned comment above the box.
  let name = box === window.__fbrdLastBox ? window.__fbrdLastAuthor || '' : '';
  if (!name) {
    const marked = [...document.querySelectorAll('[data-fbrd-id]')].filter(
      (a) => !(a.parentElement && a.parentElement.closest('[role="article"][data-fbrd-id]')) &&
        (a.contains(box) || (a.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING))
    );
    const owner = marked[marked.length - 1];
    if (owner) {
      const m = (owner.getAttribute('aria-label') || '').match(/^(?:comment|reply)\s+by\s+(\S+)/i);
      const link = owner.querySelector('a[href]');
      name = (m && m[1]) || clean(link && link.textContent).split(' ')[0] || '';
    }
  }
  const filled = (name ? text.replace(/\{name\}/gi, name) : text.replace(/,?\s*\{name\}/gi, '')).replace(/\s+([!,.?।])/g, '$1').trim();

  box.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(box);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  const insert = (clean(box.textContent) ? ' ' : '') + filled;
  let ok = document.execCommand('insertText', false, insert);
  if (ok) await new Promise((r) => setTimeout(r, 200));
  if (!ok || !clean(box.textContent).includes(clean(filled).slice(0, 20))) {
    const dt = new DataTransfer();
    dt.setData('text/plain', insert);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    ok = clean(box.textContent).includes(clean(filled).slice(0, 20));
  }
  return ok ? { ok: true } : { ok: false, reason: 'Could not type into the reply box.' };
}
