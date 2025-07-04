class PopupController {
  constructor() {
    console.log('POPUP: PopupController constructor called');
    this.elements = {
      apiStatus: document.getElementById('apiStatus'),
      sourceLanguage: document.getElementById('sourceLanguage'),
      targetLanguage: document.getElementById('targetLanguage'),
      swapLanguages: document.getElementById('swapLanguages'),
      addLangAttributes: document.getElementById('addLangAttributes'),
      translateButton: document.getElementById('translateButton'),
      translateSelectionButton: document.getElementById('translateSelectionButton'),
      restoreButton: document.getElementById('restoreButton'),
      status: document.getElementById('status'),
      progress: document.getElementById('progress'),
      progressBar: document.getElementById('progressBar')
    };

    console.log('POPUP: Elements loaded:', this.elements);
    this.isTranslating = false;
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupEventListeners();
    await this.checkAPIAvailability();
    await this.checkTextSelection();
  }

  setupEventListeners() {
    this.elements.swapLanguages.addEventListener('click', () => {
      this.swapLanguages();
    });

    this.elements.translateButton.addEventListener('click', () => {
      this.translatePage();
    });

    this.elements.translateSelectionButton.addEventListener('click', () => {
      this.translateSelection();
    });

    this.elements.restoreButton.addEventListener('click', () => {
      this.restoreOriginalText();
    });

    this.elements.sourceLanguage.addEventListener('change', () => {
      this.saveSettings();
    });

    this.elements.targetLanguage.addEventListener('change', () => {
      this.saveSettings();
    });

    this.elements.addLangAttributes.addEventListener('change', () => {
      this.saveSettings();
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch (request.action) {
        case 'translationComplete':
          this.onTranslationComplete(request.sourceLanguage, request.targetLanguage);
          break;
        case 'translationError':
          this.onTranslationError(request.error);
          break;
        case 'translationProgress':
          this.updateProgress(request.progress);
          break;
        case 'iframeTranslationWarning':
          this.showStatus(request.message, 'warning');
          break;
        case 'iframeTranslationError':
          this.showStatus(request.message, 'warning');
          break;
        case 'iframeHasSelection':
          console.log('POPUP: Received iframeHasSelection message:', request.hasSelection);
          this.updateSelectionUI(request.hasSelection);
          break;
        case 'languageDownloadNeeded':
          this.showLanguageDownloadPrompt(request.sourceLanguage, request.targetLanguage);
          break;
        case 'languageDownloadStarted':
          this.showLanguageDownloadProgress(request.sourceLanguage, request.targetLanguage, 0);
          break;
        case 'languageDownloadProgress':
          this.updateLanguageDownloadProgress(request.progress);
          break;
        case 'languageDownloadSuccess':
          this.showStatus(`Language model downloaded successfully! You can now translate to ${this.getLanguageName(request.targetLanguage)}.`, 'success');
          break;
        case 'languageDownloadFailed':
          this.showStatus(`Failed to download language model: ${request.error}`, 'error');
          break;
      }
    });
  }

  async loadSettings() {
    try {
      const settings = await chrome.storage.sync.get({
        sourceLanguage: 'auto',
        targetLanguage: 'en',
        addLangAttributes: true
      });

      this.elements.sourceLanguage.value = settings.sourceLanguage;
      this.elements.targetLanguage.value = settings.targetLanguage;
      this.elements.addLangAttributes.checked = settings.addLangAttributes;
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async saveSettings() {
    try {
      await chrome.storage.sync.set({
        sourceLanguage: this.elements.sourceLanguage.value,
        targetLanguage: this.elements.targetLanguage.value,
        addLangAttributes: this.elements.addLangAttributes.checked
      });
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  swapLanguages() {
    if (this.elements.sourceLanguage.value === 'auto') {
      this.showStatus('Cannot swap when source is auto-detect', 'error');
      return;
    }

    const sourceValue = this.elements.sourceLanguage.value;
    const targetValue = this.elements.targetLanguage.value;

    this.elements.sourceLanguage.value = targetValue;
    this.elements.targetLanguage.value = sourceValue;

    this.saveSettings();
  }

  async checkAPIAvailability() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      if (!tab) {
        this.updateAPIStatus(false, 'No active tab');
        return;
      }

      // Check if tab URL is restricted
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://')) {
        this.updateAPIStatus(false, 'Cannot access restricted pages');
        return;
      }

      // Try to inject content script if not already present
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
      } catch (injectionError) {
        // Content script might already be injected, continue
      }

      // Wait a bit for content script to initialize
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('Sending checkAvailability message to tab:', tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'checkAvailability'
      });

      console.log('Received response:', response);
      this.updateAPIStatus(response, response ? 'Translation API available' : 'Translation API not available');
    } catch (error) {
      console.error('Error checking API availability:', error);
      this.updateAPIStatus(false, 'Error checking API availability');
    }
  }

  updateAPIStatus(available, message) {
    this.elements.apiStatus.textContent = message;
    this.elements.apiStatus.className = `api-status ${available ? 'available' : 'unavailable'}`;
    
    this.elements.translateButton.disabled = !available;
    
    if (!available) {
      this.elements.translateButton.textContent = 'API Not Available';
    } else {
      this.elements.translateButton.textContent = 'Translate Page';
    }
  }

  async checkTextSelection() {
    try {
      console.log('POPUP: Starting text selection check');
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      if (!tab) {
        console.log('POPUP: No active tab found');
        return;
      }

      // Check if tab URL is restricted
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://')) {
        console.log('POPUP: Tab URL is restricted:', tab.url);
        return;
      }

      console.log('POPUP: Checking selection on tab:', tab.id);
      const hasSelection = await chrome.tabs.sendMessage(tab.id, {
        action: 'checkSelection'
      });

      console.log('POPUP: Main page selection result:', hasSelection);
      this.updateSelectionUI(hasSelection);
      
      // Also check for iframe selections by requesting all iframes to report their selection status
      if (!hasSelection) {
        console.log('POPUP: No main page selection, checking iframes');
        // Send a message to trigger iframe selection checking
        chrome.tabs.sendMessage(tab.id, {
          action: 'checkIframeSelections'
        }).catch((error) => {
          console.log('POPUP: Error checking iframe selections:', error);
        });
      } else {
        console.log('POPUP: Main page has selection, no need to check iframes');
      }
    } catch (error) {
      console.log('POPUP: Could not check text selection:', error);
      this.updateSelectionUI(false);
    }
  }

  updateSelectionUI(hasSelection) {
    console.log('POPUP: Updating selection UI with hasSelection:', hasSelection);
    if (hasSelection) {
      // Show translate selection button
      if (this.elements.translateSelectionButton) {
        console.log('POPUP: Showing translate selection button');
        this.elements.translateSelectionButton.style.display = 'block';
      } else {
        console.log('POPUP: Error - translateSelectionButton element not found');
      }
    } else {
      // Hide translate selection button
      if (this.elements.translateSelectionButton) {
        console.log('POPUP: Hiding translate selection button');
        this.elements.translateSelectionButton.style.display = 'none';
      }
    }
  }

  async translatePage() {
    if (this.isTranslating) return;

    const sourceLanguage = this.elements.sourceLanguage.value;
    const targetLanguage = this.elements.targetLanguage.value;

    if (sourceLanguage === targetLanguage) {
      this.showStatus('Source and target languages cannot be the same', 'error');
      return;
    }

    this.isTranslating = true;
    this.elements.translateButton.disabled = true;
    this.elements.translateButton.textContent = 'Translating...';
    this.showProgress();
    this.showStatus('Starting translation...', 'info');

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      if (!tab) {
        throw new Error('No active tab found');
      }

      // Handle auto-detect by detecting page language
      let actualSourceLanguage = sourceLanguage;
      if (sourceLanguage === 'auto') {
        // Try to detect page language, default to English if can't detect
        try {
          const detectedLang = await chrome.tabs.sendMessage(tab.id, {
            action: 'detectLanguage'
          });
          actualSourceLanguage = detectedLang || 'en';
        } catch (error) {
          console.warn('Language detection failed, defaulting to English:', error);
          actualSourceLanguage = 'en';
        }
      }

      await chrome.tabs.sendMessage(tab.id, {
        action: 'translate',
        sourceLanguage: actualSourceLanguage,
        targetLanguage,
        addLangAttributes: this.elements.addLangAttributes.checked
      });

    } catch (error) {
      console.error('Translation error:', error);
      this.onTranslationError(error.message);
    }
  }

  async translateSelection() {
    if (this.isTranslating) return;

    const sourceLanguage = this.elements.sourceLanguage.value;
    const targetLanguage = this.elements.targetLanguage.value;

    if (sourceLanguage === targetLanguage) {
      this.showStatus('Source and target languages cannot be the same', 'error');
      return;
    }

    this.isTranslating = true;
    this.elements.translateButton.disabled = true;
    this.elements.translateSelectionButton.disabled = true;
    this.elements.translateSelectionButton.textContent = 'Translating...';
    this.showProgress();
    this.showStatus('Translating selection...', 'info');

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      if (!tab) {
        throw new Error('No active tab found');
      }

      // Handle auto-detect by detecting page language
      let actualSourceLanguage = sourceLanguage;
      if (sourceLanguage === 'auto') {
        try {
          const detectedLang = await chrome.tabs.sendMessage(tab.id, {
            action: 'detectLanguage'
          });
          actualSourceLanguage = detectedLang || 'en';
        } catch (error) {
          console.warn('Language detection failed, defaulting to English:', error);
          actualSourceLanguage = 'en';
        }
      }

      await chrome.tabs.sendMessage(tab.id, {
        action: 'translateSelection',
        sourceLanguage: actualSourceLanguage,
        targetLanguage,
        addLangAttributes: this.elements.addLangAttributes.checked
      });

    } catch (error) {
      console.error('Selection translation error:', error);
      this.onTranslationError(error.message);
    }
  }

  async restoreOriginalText() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      if (!tab) {
        throw new Error('No active tab found');
      }

      await chrome.tabs.sendMessage(tab.id, {
        action: 'restore'
      });

      this.showStatus('Original text restored', 'success');
    } catch (error) {
      console.error('Restore error:', error);
      this.showStatus('Error restoring text: ' + error.message, 'error');
    }
  }

  onTranslationComplete(sourceLanguage, targetLanguage) {
    this.isTranslating = false;
    this.elements.translateButton.disabled = false;
    this.elements.translateButton.textContent = 'Translate Page';
    this.elements.translateSelectionButton.disabled = false;
    this.elements.translateSelectionButton.textContent = 'Translate Selection';
    this.hideProgress();
    
    const sourceName = this.getLanguageName(sourceLanguage);
    const targetName = this.getLanguageName(targetLanguage);
    this.showStatus(`Translation completed: ${sourceName} → ${targetName}`, 'success');
  }

  onTranslationError(error) {
    this.isTranslating = false;
    this.elements.translateButton.disabled = false;
    this.elements.translateButton.textContent = 'Translate Page';
    this.elements.translateSelectionButton.disabled = false;
    this.elements.translateSelectionButton.textContent = 'Translate Selection';
    this.hideProgress();
    this.showStatus('Translation failed: ' + error, 'error');
  }

  updateProgress(progress) {
    this.elements.progressBar.style.width = progress + '%';
  }

  showStatus(message, type = 'info') {
    this.elements.status.textContent = message;
    this.elements.status.className = `status ${type}`;
    this.elements.status.classList.remove('hidden');

    setTimeout(() => {
      this.elements.status.classList.add('hidden');
    }, 15000);
  }

  showProgress() {
    this.elements.progress.classList.remove('hidden');
    this.elements.progressBar.style.width = '0%';
  }

  hideProgress() {
    this.elements.progress.classList.add('hidden');
  }

  updateProgress(progress) {
    this.elements.progressBar.style.width = progress + '%';
    this.elements.progress.setAttribute('aria-valuenow', progress);
  }

  getLanguageName(code) {
    const languages = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ru': 'Russian',
      'ja': 'Japanese',
      'ko': 'Korean',
      'zh': 'Chinese',
      'ar': 'Arabic',
      'hi': 'Hindi'
    };
    return languages[code] || code;
  }

  showLanguageDownloadPrompt(sourceLanguage, targetLanguage) {
    const sourceName = this.getLanguageName(sourceLanguage);
    const targetName = this.getLanguageName(targetLanguage);
    
    // Create a custom status with download button
    const statusEl = this.elements.status;
    statusEl.innerHTML = `
      <div style="margin-bottom: 8px;">
        Language model for ${targetName} needs to be downloaded.
      </div>
      <button id="downloadLanguageBtn" class="btn btn-primary" style="font-size: 1rem; padding: 6px 12px;">
        Download ${targetName} Language Model
      </button>
    `;
    statusEl.className = 'status warning';
    statusEl.classList.remove('hidden');
    
    // Add click handler for download button
    const downloadBtn = document.getElementById('downloadLanguageBtn');
    downloadBtn.addEventListener('click', async () => {
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Downloading...';
      
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        
        if (tab) {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'downloadLanguageModel',
            sourceLanguage,
            targetLanguage
          });
        }
      } catch (error) {
        console.error('Error triggering language download:', error);
        this.showStatus('Failed to start language download', 'error');
      }
    });
    
    // Auto-hide after 15 seconds
    setTimeout(() => {
      if (statusEl.innerHTML.includes('Download')) {
        statusEl.classList.add('hidden');
      }
    }, 15000);
  }

  showLanguageDownloadProgress(sourceLanguage, targetLanguage, progress) {
    const targetName = this.getLanguageName(targetLanguage);
    
    // Update status to show download progress
    const statusEl = this.elements.status;
    statusEl.innerHTML = `
      <div style="margin-bottom: 8px;">
        Downloading ${targetName} language model...
      </div>
      <div class="progress" style="margin-bottom: 8px;">
        <div class="progress-bar" id="languageDownloadProgressBar" style="width: ${progress}%;"></div>
      </div>
      <div style="font-size: 1rem; color: #666;">
        ${Math.round(progress)}% complete
      </div>
    `;
    statusEl.className = 'status info';
    statusEl.classList.remove('hidden');
  }

  updateLanguageDownloadProgress(progress) {
    const progressBar = document.getElementById('languageDownloadProgressBar');
    const statusEl = this.elements.status;
    
    if (progressBar && statusEl.innerHTML.includes('Downloading')) {
      progressBar.style.width = progress + '%';
      
      // Update percentage text
      const percentageText = statusEl.querySelector('div:last-child');
      if (percentageText) {
        percentageText.textContent = `${Math.round(progress)}% complete`;
      }
    }
  }
}

console.log('POPUP: popup.js script loaded');

document.addEventListener('DOMContentLoaded', () => {
  console.log('POPUP: DOMContentLoaded event fired, creating PopupController');
  new PopupController();
});