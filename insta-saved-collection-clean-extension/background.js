'use strict';
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.startsWith(chrome.runtime.getURL('app.html'))) return;
  const target = Number.isInteger(tab.id) ? String(tab.id) : '';
  const url = chrome.runtime.getURL('app.html') + '?tab=' + target;
  const contexts = await chrome.runtime.getContexts({contextTypes: ['TAB']});
  const existing = contexts.find((context) => context.documentUrl === url && context.tabId >= 0);
  if (existing) {
    try { await chrome.tabs.update(existing.tabId, {active: true}); return; } catch { /* Tab closed while looking it up. */ }
  }
  await chrome.tabs.create({url});
});
