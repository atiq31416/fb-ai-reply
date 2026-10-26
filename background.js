import { DEFAULTS, callOpenRouter, buildMessages } from './ai.js';

// Clicking the toolbar icon opens the side panel (settings, snippets, bulk drafts).
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

// The in-page reply-box toolbar (content.js) can't call OpenRouter itself
// because of Facebook's CORS rules, so it asks the worker.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'draft') {
    (async () => {
      const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
      const settings = { ...DEFAULTS, ...stored, ...(msg.tone ? { tone: msg.tone } : {}) };
      try {
        const text = await callOpenRouter(buildMessages(settings, msg.postText, msg.comment), settings);
        sendResponse({ text });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true; // async response
  }
  if (msg?.type === 'openPanel' && sender.tab) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
  }
});
