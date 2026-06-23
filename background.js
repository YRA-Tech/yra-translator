chrome.runtime.onInstalled.addListener(() => {
  console.log('YRA Translator extension installed');
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (error) {
    console.error('Error injecting content script:', error);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'translationComplete':
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Translation Complete',
        message: `Page translated from ${request.sourceLanguage} to ${request.targetLanguage}`
      });
      break;
    
    case 'translationError':
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Translation Error',
        message: request.error
      });
      break;
  }
});

// Cloud-translation API proxy.
//
// Content scripts run in the page's origin and (under Manifest V3) do NOT
// inherit the extension's host_permissions, so a direct cross-origin fetch to
// yratech.com is blocked by CORS. The background service worker DOES get
// cross-origin access via host_permissions, so content.js routes its
// /api/translate and /api/jobs requests through here.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== 'nllbApiRequest') return;

  (async () => {
    try {
      const options = { method: request.method || 'GET', credentials: 'include' };
      if (request.body !== undefined && request.body !== null) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(request.body);
      }
      const res = await fetch(request.url, options);
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      sendResponse({ ok: res.ok, status: res.status, data });
    } catch (error) {
      sendResponse({ ok: false, status: 0, error: error.message || 'Network error' });
    }
  })();

  return true; // keep the message channel open for the async sendResponse
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).catch(error => {
      console.error('Error auto-injecting content script:', error);
    });
  }
});