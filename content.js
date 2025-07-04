// Prevent multiple injections
if (typeof window.YRATranslator !== 'undefined') {
  console.log('YRATranslator already exists, skipping initialization');
} else {

class YRATranslator {
  constructor() {
    this.isTranslating = false;
    this.currentTranslator = null;
    this.originalTexts = new Map();
    this.translatedTexts = new Map();
    this.textTranslationCache = new Map(); // Cache translations by text content
    this.currentLanguagePair = null;
    this.isInIframe = window !== window.top;
    this.init();
  }

  async init() {
    this.injectTranslatorScript();
    this.setupMessageListener();
    this.setupWindowMessageListener();
    await this.checkAPIAvailability();
  }

  injectTranslatorScript() {
    // Check if already injected
    if (document.querySelector('script[data-yra-injected]')) {
      return;
    }

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.setAttribute('data-yra-injected', 'true');
    script.onload = () => script.remove();
    script.onerror = () => {
      console.error('Failed to load injected script');
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch (request.action) {
        case 'translate':
          if (this.isInIframe) {
            // Iframe ignores direct translate messages - will be handled via parent coordination
            console.log('IFRAME: Ignoring direct translate message, waiting for parent coordination');
            return;
          } else {
            // Parent frame handles translation for itself and coordinates iframe translation
            this.translatePageAndIframes(request.sourceLanguage, request.targetLanguage, request.addLangAttributes);
          }
          break;
        case 'restore':
          this.restoreOriginalText();
          // If we're in the top frame, also restore iframes
          if (!this.isInIframe) {
            this.restoreIframes();
          }
          break;
        case 'checkAvailability':
          console.log('Content script received checkAvailability message');
          this.checkAPIAvailability().then(result => {
            console.log('Content script sending response:', result);
            sendResponse(result);
          });
          return true;
        case 'detectLanguage':
          const detectedLang = this.detectPageLanguage();
          sendResponse(detectedLang);
          break;
        case 'checkSelection':
          const hasSelection = this.checkTextSelection();
          sendResponse(hasSelection);
          break;
        case 'translateSelection':
          this.translateSelectedText(request.sourceLanguage, request.targetLanguage, request.addLangAttributes);
          break;
        case 'checkIframeSelections':
          this.checkIframeSelections();
          break;
        case 'downloadLanguageModel':
          this.downloadLanguageModel(request.sourceLanguage, request.targetLanguage);
          break;
      }
    });
  }

  setupWindowMessageListener() {
    // Listen for iframe translation messages
    window.addEventListener('message', async (event) => {
      // Only process messages meant for YRA translator
      if (!event.data.type || !event.data.type.startsWith('YRA_')) return;

      switch (event.data.type) {
        case 'YRA_TRANSLATE_IFRAME':
          if (this.isInIframe) {
            console.log('Iframe received full page translation request - URL:', window.location.href);
            console.log('IFRAME: Message data:', event.data.sourceLanguage, '->', event.data.targetLanguage);
            try {
              await this.translateIframePageUsingParentDelegation(
                event.data.sourceLanguage, 
                event.data.targetLanguage, 
                event.data.addLangAttributes
              );
              // Notify parent that iframe translation succeeded
              parent.postMessage({
                type: 'YRA_IFRAME_TRANSLATION_SUCCESS'
              }, '*');
            } catch (error) {
              console.error('Iframe translation failed:', error);
              // Notify parent that iframe translation failed
              parent.postMessage({
                type: 'YRA_IFRAME_TRANSLATION_FAILED',
                error: error.message
              }, '*');
            }
          }
          break;
        case 'YRA_RESTORE_IFRAME':
          if (this.isInIframe) {
            console.log('Iframe received restore request');
            this.restoreOriginalText();
            // Notify parent that iframe restore was completed
            parent.postMessage({
              type: 'YRA_IFRAME_RESTORE_COMPLETE'
            }, '*');
          }
          break;
        case 'YRA_IFRAME_TRANSLATION_SUCCESS':
          if (!this.isInIframe) {
            console.log('Iframe translation succeeded');
            if (!this.iframeResponses) this.iframeResponses = new Set();
            this.iframeResponses.add(event.source);
          }
          break;
        case 'YRA_IFRAME_TRANSLATION_FAILED':
          if (!this.isInIframe) {
            console.warn('Iframe translation failed:', event.data.error);
            if (!this.iframeResponses) this.iframeResponses = new Set();
            this.iframeResponses.add(event.source);
            
            // Show user-friendly error for specific permission policy errors
            if (event.data.error.includes('permission') || event.data.error.includes('policy')) {
              chrome.runtime.sendMessage({
                action: 'iframeTranslationError',
                message: 'Some iframe content cannot be translated due to security restrictions from the content provider.'
              });
            }
          }
          break;
        case 'YRA_CHECK_SELECTION_FROM_IFRAME':
          if (!this.isInIframe) {
            // Parent frame checking selection for iframe
            const selection = window.getSelection();
            let hasSelection = selection && selection.toString().trim().length > 0;
            
            // If parent doesn't have selection, check all iframes for selections
            if (!hasSelection) {
              const iframes = document.querySelectorAll('iframe');
              for (const iframe of iframes) {
                try {
                  if (iframe.contentWindow) {
                    // Ask each iframe if it has a selection
                    iframe.contentWindow.postMessage({
                      type: 'YRA_REQUEST_SELECTION_STATUS'
                    }, '*');
                  }
                } catch (error) {
                  // Cross-origin iframe, can't communicate
                }
              }
            }
            
            // Respond back to iframe
            event.source.postMessage({
              type: 'YRA_SELECTION_STATUS_RESPONSE',
              hasSelection: hasSelection
            }, '*');
          }
          break;
        case 'YRA_SELECTION_STATUS_RESPONSE':
          if (this.isInIframe) {
            // Iframe received selection status from parent
            this.parentHasSelection = event.data.hasSelection;
          }
          break;
        case 'YRA_REQUEST_SELECTION_STATUS':
          if (this.isInIframe) {
            // Parent is asking for our selection status
            const selection = window.getSelection();
            const hasSelection = selection && selection.toString().trim().length > 0;
            
            console.log('IFRAME: Received YRA_REQUEST_SELECTION_STATUS');
            console.log('IFRAME: Has selection:', hasSelection);
            console.log('IFRAME: Selection text:', selection ? `"${selection.toString()}"` : 'null');
            
            // Respond back to parent
            parent.postMessage({
              type: 'YRA_IFRAME_SELECTION_STATUS',
              hasSelection: hasSelection
            }, '*');
          }
          break;
        case 'YRA_IFRAME_SELECTION_STATUS':
          if (!this.isInIframe) {
            // Parent received selection status from iframe
            console.log('PARENT: Received YRA_IFRAME_SELECTION_STATUS');
            console.log('PARENT: Iframe has selection:', event.data.hasSelection);
            
            if (event.data.hasSelection) {
              // Update UI to show selection button since an iframe has selection
              console.log('PARENT: Notifying popup that iframe has selection');
              chrome.runtime.sendMessage({
                action: 'iframeHasSelection',
                hasSelection: true
              });
            }
          }
          break;
        case 'YRA_TRANSLATE_IFRAME_SELECTION':
          if (this.isInIframe) {
            console.log('IFRAME: Received YRA_TRANSLATE_IFRAME_SELECTION request');
            // Iframe received request to translate its selection - use same logic as parent page
            const selection = window.getSelection();
            console.log('IFRAME: Current selection:', selection ? selection.toString() : 'null');
            console.log('IFRAME: Selection range count:', selection ? selection.rangeCount : 0);
            
            if (selection && selection.toString().trim().length > 0) {
              console.log('IFRAME: Processing iframe selection using same logic as parent page');
              try {
                // Use the same selection translation logic as the parent page
                await this.translateIframeSelectionUsingNormalMethod(
                  event.data.sourceLanguage, 
                  event.data.targetLanguage, 
                  event.data.addLangAttributes
                );
                
                // Notify parent that iframe selection was translated
                parent.postMessage({
                  type: 'YRA_IFRAME_SELECTION_TRANSLATED'
                }, '*');
                
              } catch (error) {
                console.error('IFRAME: Selection processing failed:', error);
                parent.postMessage({
                  type: 'YRA_IFRAME_SELECTION_TRANSLATION_FAILED',
                  error: error.message
                }, '*');
              }
            } else {
              console.log('IFRAME: No selection found, not sending translation request');
              // Don't send error - this is normal for iframes without selections
            }
          }
          break;
        case 'YRA_IFRAME_SELECTION_CONTENT':
          if (!this.isInIframe) {
            // Parent received selection content from iframe for translation
            console.log('PARENT: Received iframe selection content for translation');
            console.log('PARENT: Content data:', event.data);
            try {
              // Translate the content using parent's translation capabilities
              await this.translateIframeSelectionContent(event.data, event.source);
            } catch (error) {
              console.error('PARENT: Translation of iframe content failed:', error);
              event.source.postMessage({
                type: 'YRA_IFRAME_SELECTION_TRANSLATION_FAILED',
                error: error.message
              }, '*');
            }
          }
          break;
        case 'YRA_IFRAME_SELECTION_TRANSLATED':
          if (!this.isInIframe) {
            // Parent received confirmation that iframe selection was translated
            chrome.runtime.sendMessage({
              action: 'translationComplete',
              sourceLanguage: 'detected',
              targetLanguage: 'target'
            });
          }
          break;
        case 'YRA_IFRAME_SELECTION_TRANSLATION_FAILED':
          if (!this.isInIframe) {
            // Parent received error from iframe selection translation
            chrome.runtime.sendMessage({
              action: 'translationError',
              error: event.data.error || 'Iframe selection translation failed'
            });
          }
          break;
        case 'YRA_IFRAME_TEXT_TRANSLATION_REQUEST':
          if (!this.isInIframe) {
            // Parent received request to translate individual text from iframe
            console.log('PARENT: Received text translation request from iframe:', event.data.text);
            this.handleIframeTextTranslationRequest(event.data, event.source);
          }
          break;
        case 'YRA_IFRAME_TEXT_TRANSLATION_RESPONSE':
          if (this.isInIframe) {
            // Iframe received translated text response from parent
            console.log('IFRAME: Received text translation response from parent');
            this.handleIframeTextTranslationResponse(event.data);
          }
          break;
        case 'YRA_IFRAME_TRANSLATED_CONTENT':
          if (this.isInIframe) {
            // Iframe received translated content from parent
            console.log('IFRAME: Received translated content from parent');
            console.log('IFRAME: Translated content data:', event.data);
            try {
              this.applyTranslatedContentToSelection(event.data);
              // Notify parent that iframe display was successful
              console.log('IFRAME: Successfully applied translated content, notifying parent');
              parent.postMessage({
                type: 'YRA_IFRAME_SELECTION_TRANSLATED'
              }, '*');
            } catch (error) {
              console.error('IFRAME: Content application failed:', error);
              parent.postMessage({
                type: 'YRA_IFRAME_SELECTION_TRANSLATION_FAILED',
                error: error.message
              }, '*');
            }
          }
          break;
      }
    });
  }

  isSuspiciousTranslation(originalText, translatedText) {
    // Check if the API is returning obviously wrong results
    
    // If long text gets translated to a short date-like string, it's suspicious
    if (originalText.length > 10 && translatedText.length < 20 && 
        translatedText.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
      return true;
    }
    
    // If very different text gets the same translation, it's suspicious
    if (this.textTranslationCache.size > 0) {
      const values = Array.from(this.textTranslationCache.values());
      const sameTranslationCount = values.filter(v => v === translatedText).length;
      if (sameTranslationCount >= 2) {
        return true;
      }
    }
    
    // Check for obviously wrong translations
    // If "." gets translated to a long phrase, it's wrong
    if (originalText === "." && translatedText.length > 10) {
      return true;
    }
    
    // If very different English words get identical translations, it's suspicious
    const existingTexts = Array.from(this.textTranslationCache.keys());
    const existingWithSameTranslation = existingTexts.filter(key => 
      this.textTranslationCache.get(key) === translatedText
    );
    
    if (existingWithSameTranslation.length > 0) {
      // Check if the original texts are very different
      const similarity = this.calculateSimilarity(originalText, existingWithSameTranslation[0]);
      if (similarity < 0.3) { // Very different texts
        return true;
      }
    }
    
    return false;
  }

  calculateSimilarity(str1, str2) {
    // Simple similarity check - count common words
    const words1 = str1.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const words2 = str2.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const commonWords = words1.filter(w => words2.includes(w));
    return commonWords.length / Math.max(words1.length, words2.length);
  }

  detectPageLanguage() {
    // Try to detect language from HTML lang attribute
    const htmlLang = document.documentElement.lang;
    if (htmlLang) {
      // Convert to two-letter code if it's a longer code like 'en-US'
      return htmlLang.split('-')[0].toLowerCase();
    }

    // Try to detect from meta tags
    const metaLang = document.querySelector('meta[http-equiv="content-language"]');
    if (metaLang) {
      return metaLang.getAttribute('content').split('-')[0].toLowerCase();
    }

    // Default to English if no language detected
    return 'en';
  }

  checkTextSelection() {
    const selection = window.getSelection();
    const hasSelection = selection && selection.toString().trim().length > 0;
    
    // If in iframe and no selection in current frame, check if parent has reported selection
    if (!hasSelection && this.isInIframe) {
      // Post message to parent to check for cross-frame selection
      try {
        parent.postMessage({
          type: 'YRA_CHECK_SELECTION_FROM_IFRAME'
        }, '*');
        // Return the cached parent selection status if available
        return this.parentHasSelection || false;
      } catch (error) {
        // Cross-origin iframe, can't communicate with parent
        return false;
      }
    }
    
    return hasSelection;
  }

  checkIframeSelections() {
    // Only run in parent frame
    if (this.isInIframe) return;
    
    console.log('PARENT: Checking iframe selections');
    const iframes = document.querySelectorAll('iframe');
    console.log('PARENT: Found', iframes.length, 'iframes for selection check');
    
    for (const iframe of iframes) {
      try {
        if (iframe.contentWindow) {
          console.log('PARENT: Requesting selection status from iframe:', iframe.src || 'about:blank');
          // Ask each iframe if it has a selection
          iframe.contentWindow.postMessage({
            type: 'YRA_REQUEST_SELECTION_STATUS'
          }, '*');
        }
      } catch (error) {
        console.log('PARENT: Cannot communicate with iframe for selection check:', error.message);
      }
    }
  }

  async translateIframeSelectionContent(contentData, iframeSource) {
    // Only run in parent frame
    if (this.isInIframe) return;
    
    const { selectedText, originalSelectedText, sourceLanguage, targetLanguage, addLangAttributes } = contentData;
    
    console.log(`PARENT: Starting translation of iframe selection: "${selectedText}"`);
    console.log(`PARENT: Language pair: ${sourceLanguage} -> ${targetLanguage}`);
    
    // Ensure we have a translator for this language pair
    const languagePair = `${sourceLanguage}-${targetLanguage}`;
    
    // If switching language pairs, clear caches
    if (this.currentLanguagePair && this.currentLanguagePair !== languagePair) {
      console.log('PARENT: Switching language pairs for iframe selection');
      this.textTranslationCache.clear();
      this.translatedTexts.clear();
    }

    if (!this.currentTranslator || this.currentLanguagePair !== languagePair) {
      if (this.currentTranslator) {
        console.log('PARENT: Destroying existing translator');
        this.currentTranslator.destroy();
      }

      console.log('PARENT: Creating new translator for iframe selection');
      this.currentTranslator = await this.createTranslator(sourceLanguage, targetLanguage);
      this.currentLanguagePair = languagePair;
      this.textTranslationCache.clear();
      this.translatedTexts.clear();
      console.log(`PARENT: Created new translator for iframe selection ${languagePair}, caches cleared`);
    }

    // Translate the selected text
    let translatedText;
    const cacheKey = `${this.currentLanguagePair}:${selectedText}`;
    if (this.textTranslationCache.has(cacheKey)) {
      translatedText = this.textTranslationCache.get(cacheKey);
      console.log(`PARENT: Using cached translation for iframe selection: "${selectedText}" -> "${translatedText}" (language pair: ${this.currentLanguagePair})`);
    } else {
      console.log(`PARENT: Translating text with API: "${selectedText}"`);
      translatedText = await this.currentTranslator.translate(selectedText);
      this.textTranslationCache.set(cacheKey, translatedText);
      
      if (selectedText === translatedText) {
        console.log(`PARENT: API returned unchanged for iframe selection: "${selectedText}" (likely proper noun/technical term)`);
      } else {
        console.log(`PARENT: New translation for iframe selection: "${selectedText}" -> "${translatedText}"`);
      }
    }

    // Preserve leading and trailing whitespace
    const leadingWhitespace = originalSelectedText.match(/^\s*/)[0];
    const trailingWhitespace = originalSelectedText.match(/\s*$/)[0];
    
    console.log(`PARENT: Leading whitespace: "${leadingWhitespace}"`);
    console.log(`PARENT: Trailing whitespace: "${trailingWhitespace}"`);

    // Send translated content back to iframe
    console.log('PARENT: Sending translated content back to iframe');
    iframeSource.postMessage({
      type: 'YRA_IFRAME_TRANSLATED_CONTENT',
      translatedText: translatedText,
      leadingWhitespace: leadingWhitespace,
      trailingWhitespace: trailingWhitespace,
      addLangAttributes: addLangAttributes,
      targetLanguage: targetLanguage
    }, '*');
  }

  applyTranslatedContentToSelection(contentData) {
    // Only run in iframe
    if (!this.isInIframe) return;
    
    const { translatedText, leadingWhitespace, trailingWhitespace, addLangAttributes, targetLanguage } = contentData;
    
    console.log(`Iframe applying translated content: "${translatedText}"`);
    
    // Use the stored selection range
    if (!this.pendingSelectionRange) {
      throw new Error('No pending selection range found');
    }
    
    const range = this.pendingSelectionRange.cloneRange();
    
    // Validate that the range is still valid in the document
    try {
      // Check if range is still valid
      range.toString();
    } catch (error) {
      throw new Error('Selection range is no longer valid in the document');
    }
    
    console.log(`Replacing content in range. Original: "${this.pendingOriginalText}"`);
    
    // Check if selection spans multiple elements - if so, preserve structure
    if (this.selectionSpansMultipleElements(range)) {
      console.log('IFRAME: Selection spans multiple elements, preserving structure');
      this.applyTranslationPreservingStructure(range, translatedText, addLangAttributes, targetLanguage);
    } else {
      console.log('IFRAME: Single element selection, simple replacement');
      this.applySimpleTranslation(range, translatedText, leadingWhitespace, trailingWhitespace, addLangAttributes, targetLanguage);
    }
    
    // Store translation info for restoration
    if (this.pendingRangeId) {
      this.translatedTexts.set(this.pendingRangeId, translatedText);
    }
    
    // Clear the pending data
    this.pendingSelectionRange = null;
    this.pendingOriginalContent = null;
    this.pendingOriginalText = null;
    this.pendingRangeId = null;
    
    // Clear the selection
    const selection = window.getSelection();
    selection.removeAllRanges();
    
    console.log('Iframe selection translation completed');
  }

  selectionSpansMultipleElements(range) {
    // Check if start and end containers are different elements
    return range.startContainer !== range.endContainer ||
           range.startContainer.parentElement !== range.endContainer.parentElement;
  }

  applyTranslationPreservingStructure(range, translatedText, addLangAttributes, targetLanguage) {
    // For multi-element selections, we need to be more careful
    // Store the original content structure
    const originalContent = range.cloneContents();
    
    // Find all text nodes in the selection
    const textNodes = [];
    const walker = document.createTreeWalker(
      originalContent,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node.nodeValue.trim()) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );
    
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node.nodeValue.trim());
    }
    
    console.log('IFRAME: Found text nodes in selection:', textNodes);
    
    // For now, use simple replacement but with a warning
    console.log('IFRAME: Using simple replacement for multi-element selection (structure may change)');
    this.applySimpleTranslation(range, translatedText, '', '', addLangAttributes, targetLanguage);
  }

  applySimpleTranslation(range, translatedText, leadingWhitespace, trailingWhitespace, addLangAttributes, targetLanguage) {
    // Delete only the exact selected content
    range.deleteContents();
    
    // Create the replacement content with proper lang attribute handling
    if (addLangAttributes && translatedText !== this.pendingOriginalText.trim()) {
      // Create a span element to wrap the translated text with lang attribute
      const span = document.createElement('span');
      span.setAttribute('lang', targetLanguage);
      span.setAttribute('data-yra-translated', 'true');
      span.setAttribute('data-yra-iframe-translation', 'true');
      
      // Add the translated text
      span.textContent = translatedText;
      
      // Create document fragment to handle whitespace properly
      const fragment = document.createDocumentFragment();
      
      // Add leading whitespace if present
      if (leadingWhitespace) {
        fragment.appendChild(document.createTextNode(leadingWhitespace));
      }
      
      // Add the span with translated content
      fragment.appendChild(span);
      
      // Add trailing whitespace if present
      if (trailingWhitespace) {
        fragment.appendChild(document.createTextNode(trailingWhitespace));
      }
      
      range.insertNode(fragment);
    } else {
      // No lang attribute needed, just insert text with preserved whitespace
      const fullTranslatedText = leadingWhitespace + translatedText + trailingWhitespace;
      const textNode = document.createTextNode(fullTranslatedText);
      range.insertNode(textNode);
    }
  }

  async translateIframeSelectionUsingNormalMethod(sourceLanguage, targetLanguage, addLangAttributes) {
    // This method uses the same structure-preserving logic as the parent page
    // but sends individual text nodes to the parent for translation
    
    console.log('IFRAME: Starting structure-preserving selection translation');
    
    const selection = window.getSelection();
    if (!selection || selection.toString().trim().length === 0) {
      throw new Error('No selection found in iframe');
    }

    // Store settings for the translation
    this.addLangAttributes = addLangAttributes;
    this.targetLanguage = targetLanguage;
    
    // Use the same selection content translation method as the parent page
    // but with a modified translator that sends requests to parent
    this.iframeTranslator = {
      translate: async (text) => {
        return await this.requestTranslationFromParent(text, sourceLanguage, targetLanguage);
      }
    };
    
    // Set up for iframe translation
    this.pendingIframeTranslations = new Map();
    this.completedIframeTranslations = 0;
    this.totalIframeTranslations = 0;
    
    // Use the existing translateSelectionContent method with our iframe translator
    await this.translateSelectionContent(selection);
    
    console.log('IFRAME: Structure-preserving selection translation completed');
  }

  async requestTranslationFromParent(text, sourceLanguage, targetLanguage) {
    // Send individual text to parent for translation and wait for response
    return new Promise((resolve, reject) => {
      const requestId = 'iframe-text-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      
      // Store the promise resolver
      if (!this.pendingIframeTranslations) {
        this.pendingIframeTranslations = new Map();
      }
      this.pendingIframeTranslations.set(requestId, { resolve, reject });
      
      console.log('IFRAME: Requesting translation from parent for:', `"${text}"`);
      console.log('IFRAME: Request using languages:', sourceLanguage, '->', targetLanguage);
      
      // Send request to parent
      parent.postMessage({
        type: 'YRA_IFRAME_TEXT_TRANSLATION_REQUEST',
        requestId: requestId,
        text: text,
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage
      }, '*');
      
      // Set timeout for the request
      setTimeout(() => {
        if (this.pendingIframeTranslations.has(requestId)) {
          this.pendingIframeTranslations.delete(requestId);
          reject(new Error('Translation request timeout'));
        }
      }, 10000); // 10 second timeout
    });
  }

  async translateSelectedText(sourceLanguage, targetLanguage, addLangAttributes = true) {
    if (this.isTranslating) return;

    const selection = window.getSelection();
    const hasLocalSelection = selection && selection.toString().trim().length > 0;
    
    // If no selection in current frame, check if we should translate iframe selections
    if (!hasLocalSelection) {
      console.log('SELECTION: No local selection found');
      // If we're in the parent frame, try to find and translate iframe selections
      if (!this.isInIframe) {
        console.log('SELECTION: In parent frame, checking iframes for selections');
        const iframes = document.querySelectorAll('iframe');
        console.log('SELECTION: Found', iframes.length, 'iframes');
        let iframeTranslated = false;
        
        for (const iframe of iframes) {
          try {
            if (iframe.contentWindow) {
              console.log('SELECTION: Sending translation request to iframe:', iframe.src || 'about:blank');
              // Ask iframe to translate its selection
              iframe.contentWindow.postMessage({
                type: 'YRA_TRANSLATE_IFRAME_SELECTION',
                sourceLanguage,
                targetLanguage,
                addLangAttributes
              }, '*');
              iframeTranslated = true;
            }
          } catch (error) {
            console.log('SELECTION: Cannot communicate with iframe:', error.message);
          }
        }
        
        if (iframeTranslated) {
          console.log('SELECTION: Initiated iframe translation, waiting for response');
          // At least one iframe might have a selection, so we've initiated translation
          return;
        }
      }
      
      console.log('SELECTION: No selection found anywhere');
      // No selection found anywhere
      chrome.runtime.sendMessage({
        action: 'translationError',
        error: 'No text selected'
      });
      return;
    }

    this.isTranslating = true;
    this.addLangAttributes = addLangAttributes;
    this.targetLanguage = targetLanguage;
    const languagePair = `${sourceLanguage}-${targetLanguage}`;

    try {
      // If switching language pairs, clear caches
      if (this.currentLanguagePair && this.currentLanguagePair !== languagePair) {
        console.log('Switching language pairs for selection');
        this.textTranslationCache.clear();
        this.translatedTexts.clear();
      }

      if (!this.currentTranslator || this.currentLanguagePair !== languagePair) {
        if (this.currentTranslator) {
          this.currentTranslator.destroy();
        }

        this.currentTranslator = await this.createTranslator(sourceLanguage, targetLanguage);
        this.currentLanguagePair = languagePair;
        this.textTranslationCache.clear();
        this.translatedTexts.clear();
        console.log(`Created new translator for selection ${languagePair}, caches cleared`);
      }

      // Handle selection translation differently - replace selected content directly
      await this.translateSelectionContent(selection);

      chrome.runtime.sendMessage({
        action: 'translationComplete',
        sourceLanguage,
        targetLanguage
      });

    } catch (error) {
      console.error('Selection translation error:', error);
      
      // Handle language model download errors
      if (this.isLanguageDownloadError(error)) {
        this.handleLanguageDownloadNeeded(sourceLanguage, targetLanguage, error);
      } else {
        chrome.runtime.sendMessage({
          action: 'translationError',
          error: this.getLanguageErrorMessage(error, sourceLanguage, targetLanguage)
        });
      }
    } finally {
      this.isTranslating = false;
    }
  }

  async translateSelectionContent(selection) {
    // Get the selected text content with whitespace preservation
    const originalSelectedText = selection.toString();
    const selectedText = originalSelectedText.trim();
    if (!selectedText) return;

    console.log(`Translating selected text: "${selectedText}"`);

    // Preserve leading and trailing whitespace
    const leadingWhitespace = originalSelectedText.match(/^\s*/)[0];
    const trailingWhitespace = originalSelectedText.match(/\s*$/)[0];

    // Translate the selected text
    let translatedText;
    const cacheKey = `${this.currentLanguagePair}:${selectedText}`;
    if (this.textTranslationCache.has(cacheKey)) {
      translatedText = this.textTranslationCache.get(cacheKey);
      console.log(`Using cached translation for selection: "${selectedText}" -> "${translatedText}" (language pair: ${this.currentLanguagePair})`);
    } else {
      // Use iframe translator if available, otherwise use current translator
      const translator = this.iframeTranslator || this.currentTranslator;
      translatedText = await translator.translate(selectedText);
      this.textTranslationCache.set(cacheKey, translatedText);
      
      if (selectedText === translatedText) {
        console.log(`API returned unchanged for selection: "${selectedText}" (likely proper noun/technical term)`);
      } else {
        console.log(`New translation for selection: "${selectedText}" -> "${translatedText}"`);
      }
    }

    // Replace the selection with the translated text
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      
      // Store original content for potential restoration
      const originalContent = range.cloneContents();
      
      // Delete the selected content
      range.deleteContents();
      
      // Create the replacement content with proper lang attribute handling
      if (this.addLangAttributes && selectedText !== translatedText) {
        // Create a span element to wrap the translated text with lang attribute
        const span = document.createElement('span');
        span.setAttribute('lang', this.targetLanguage);
        span.setAttribute('data-yra-translated', 'true');
        
        // Add the translated text with preserved whitespace
        span.textContent = translatedText;
        
        // Create document fragment to handle whitespace properly
        const fragment = document.createDocumentFragment();
        
        // Add leading whitespace if present
        if (leadingWhitespace) {
          fragment.appendChild(document.createTextNode(leadingWhitespace));
        }
        
        // Add the span with translated content
        fragment.appendChild(span);
        
        // Add trailing whitespace if present
        if (trailingWhitespace) {
          fragment.appendChild(document.createTextNode(trailingWhitespace));
        }
        
        range.insertNode(fragment);
      } else {
        // No lang attribute needed, just insert text with preserved whitespace
        const fullTranslatedText = leadingWhitespace + translatedText + trailingWhitespace;
        const textNode = document.createTextNode(fullTranslatedText);
        range.insertNode(textNode);
      }
      
      // Clear the selection
      selection.removeAllRanges();
    }
  }

  getSelectedTextNodes(selection) {
    const textNodes = [];
    
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      
      // Get all text nodes that contain the selection
      const walker = document.createTreeWalker(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            if (!node.nodeValue.trim() || 
                this.isScriptOrStyle(node.parentNode) ||
                this.isHidden(node.parentNode)) {
              return NodeFilter.FILTER_REJECT;
            }
            
            // Check if any part of this text node is actually selected
            if (this.isTextNodeInSelection(node, range)) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
          }
        }
      );

      let node;
      while (node = walker.nextNode()) {
        textNodes.push(node);
      }
    }
    
    return textNodes;
  }

  isTextNodeInSelection(textNode, range) {
    try {
      // Create a range that spans the entire text node
      const nodeRange = document.createRange();
      nodeRange.selectNodeContents(textNode);
      
      // Check if the selection range overlaps with any part of this text node
      return range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0 &&
             range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0;
    } catch (error) {
      // Fallback to simple intersection check
      console.warn('Range comparison failed, using fallback:', error);
      return range.intersectsNode(textNode);
    }
  }

  async checkAPIAvailability() {
    return new Promise((resolve) => {
      const messageId = Date.now();
      let responseReceived = false;

      window.postMessage({
        type: 'CHECK_TRANSLATOR_API',
        id: messageId
      }, '*');

      const handleResponse = (event) => {
        if (event.data.type === 'TRANSLATOR_API_RESPONSE' && event.data.id === messageId) {
          responseReceived = true;
          window.removeEventListener('message', handleResponse);
          resolve(event.data.available);
        }
      };

      window.addEventListener('message', handleResponse);

      // Timeout after 2 seconds if no response
      setTimeout(() => {
        if (!responseReceived) {
          window.removeEventListener('message', handleResponse);
          resolve(false);
        }
      }, 2000);
    });
  }

  async translatePage(sourceLanguage, targetLanguage, addLangAttributes = true) {
    if (this.isTranslating) return;

    this.isTranslating = true;
    this.addLangAttributes = addLangAttributes;
    this.targetLanguage = targetLanguage;
    const languagePair = `${sourceLanguage}-${targetLanguage}`;

    try {
      // If switching language pairs, restore original text and clear all caches first
      if (this.currentLanguagePair && this.currentLanguagePair !== languagePair) {
        console.log('Switching language pairs, restoring original text first');
        this.restoreOriginalText();
        // Clear caches immediately after restore
        this.textTranslationCache.clear();
        this.translatedTexts.clear();
      }

      if (!this.currentTranslator || this.currentLanguagePair !== languagePair) {
        if (this.currentTranslator) {
          this.currentTranslator.destroy();
        }

        this.currentTranslator = await this.createTranslator(sourceLanguage, targetLanguage);
        this.currentLanguagePair = languagePair;
        // Ensure caches are cleared for new language pair
        this.textTranslationCache.clear();
        this.translatedTexts.clear();
        console.log(`Created new translator for ${languagePair}, caches cleared`);
      }

      const textNodes = this.getAllTextNodes();
      const ariaNodes = this.getAllAriaNodes();

      // Initialize progress tracking
      this.totalTextNodes = textNodes.length;
      this.totalAriaNodes = ariaNodes.length;
      this.completedTextNodes = 0;
      this.completedAriaNodes = 0;

      // Send initial progress
      chrome.runtime.sendMessage({
        action: 'translationProgress',
        progress: 0
      });

      await this.translateNodes(textNodes);
      await this.translateAriaAttributes(ariaNodes);

      chrome.runtime.sendMessage({
        action: 'translationComplete',
        sourceLanguage,
        targetLanguage
      });

    } catch (error) {
      console.error('Translation error:', error);
      
      // Handle language model download errors
      if (this.isLanguageDownloadError(error)) {
        this.handleLanguageDownloadNeeded(sourceLanguage, targetLanguage, error);
      } else {
        chrome.runtime.sendMessage({
          action: 'translationError',
          error: this.getLanguageErrorMessage(error, sourceLanguage, targetLanguage)
        });
      }
    } finally {
      this.isTranslating = false;
    }
  }

  async createTranslator(sourceLanguage, targetLanguage) {
    return new Promise((resolve, reject) => {
      const messageId = Date.now();
      
      window.postMessage({
        type: 'CREATE_TRANSLATOR',
        id: messageId,
        sourceLanguage,
        targetLanguage
      }, '*');

      const handleResponse = (event) => {
        if (event.data.type === 'TRANSLATOR_CREATED' && event.data.id === messageId) {
          window.removeEventListener('message', handleResponse);
          if (event.data.success) {
            resolve({
              translate: (text) => this.translateText(text, messageId),
              destroy: () => this.destroyTranslator(messageId)
            });
          } else {
            reject(new Error(event.data.error));
          }
        }
      };

      window.addEventListener('message', handleResponse);
    });
  }

  async translateText(text, translatorId) {
    return new Promise((resolve, reject) => {
      const messageId = Date.now();
      
      window.postMessage({
        type: 'TRANSLATE_TEXT',
        id: messageId,
        translatorId,
        text
      }, '*');

      const handleResponse = (event) => {
        if (event.data.type === 'TEXT_TRANSLATED' && event.data.id === messageId) {
          window.removeEventListener('message', handleResponse);
          if (event.data.success) {
            resolve(event.data.translatedText);
          } else {
            reject(new Error(event.data.error));
          }
        }
      };

      window.addEventListener('message', handleResponse);
    });
  }

  destroyTranslator(translatorId) {
    window.postMessage({
      type: 'DESTROY_TRANSLATOR',
      translatorId
    }, '*');
  }

  getAllTextNodes() {
    const textNodes = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node.nodeValue.trim() && 
              !this.isScriptOrStyle(node.parentNode) &&
              !this.isHidden(node.parentNode)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }
    return textNodes;
  }

  getAllAriaNodes() {
    const ariaAttributes = [
      'aria-label', 'aria-labelledby', 'aria-describedby', 
      'aria-placeholder', 'title', 'alt'
    ];
    
    const nodes = [];
    for (const attr of ariaAttributes) {
      const elements = document.querySelectorAll(`[${attr}]`);
      elements.forEach(element => {
        const value = element.getAttribute(attr);
        if (value && value.trim()) {
          nodes.push({ element, attribute: attr, value });
        }
      });
    }
    return nodes;
  }

  async translateNodes(textNodes) {
    // Process nodes one by one synchronously to prevent API corruption
    for (let i = 0; i < textNodes.length; i++) {
      await this.translateTextNode(textNodes[i]);
      
      this.completedTextNodes = i + 1;
      
      // Calculate overall progress (text nodes take 80% of progress, ARIA 20%)
      const textProgress = (this.completedTextNodes / this.totalTextNodes) * 80;
      const ariaProgress = (this.completedAriaNodes / Math.max(this.totalAriaNodes, 1)) * 20;
      const totalProgress = Math.round(textProgress + ariaProgress);
      
      chrome.runtime.sendMessage({
        action: 'translationProgress',
        progress: totalProgress
      });
      
      // Small delay to prevent API overwhelming
      if (i < textNodes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }

  async translateTextNode(node) {
    const originalText = node.nodeValue.trim();
    if (!originalText) return;

    const nodeId = this.getNodeId(node);
    
    if (!this.originalTexts.has(nodeId)) {
      this.originalTexts.set(nodeId, originalText);
    }

    try {
      let translatedText;
      
      // Check if we already have a translation for this text in the current language pair
      const cacheKey = `${this.currentLanguagePair}:${originalText}`;
      if (this.textTranslationCache.has(cacheKey)) {
        translatedText = this.textTranslationCache.get(cacheKey);
        console.log(`Using cached translation for "${originalText}" -> "${translatedText}" (language pair: ${this.currentLanguagePair})`);
      } else {
        // Get new translation and cache it
        translatedText = await this.currentTranslator.translate(originalText);
        
        // Suspicious translation detection disabled for synchronous flow
        // if (this.isSuspiciousTranslation(originalText, translatedText)) {
        //   console.error('Suspicious translation detected, recreating translator');
        //   console.error(`Input: "${originalText}" -> Output: "${translatedText}"`);
        //   // Recreate the translator
        //   this.currentTranslator.destroy();
        //   this.currentTranslator = await this.createTranslator(
        //     this.currentLanguagePair.split('-')[0],
        //     this.currentLanguagePair.split('-')[1]
        //   );
        //   // Try translation again with new translator
        //   translatedText = await this.currentTranslator.translate(originalText);
        //   console.log(`Retry translation: "${originalText}" -> "${translatedText}"`);
        // }
        
        this.textTranslationCache.set(cacheKey, translatedText);
        
        // Log if translation equals original (API chose not to translate)
        if (originalText === translatedText) {
          console.log(`API returned unchanged: "${originalText}" (likely proper noun/technical term)`);
        } else {
          console.log(`New translation for "${originalText}" -> "${translatedText}"`);
        }
      }
      
      this.translatedTexts.set(nodeId, translatedText);
      // Replace the entire node value since originalText is the trimmed version
      const fullNodeValue = node.nodeValue;
      const trimmedValue = fullNodeValue.trim();
      
      if (trimmedValue === originalText) {
        // If the trimmed value matches exactly, replace while preserving whitespace
        const leadingWhitespace = fullNodeValue.match(/^\s*/)[0];
        const trailingWhitespace = fullNodeValue.match(/\s*$/)[0];
        node.nodeValue = leadingWhitespace + translatedText + trailingWhitespace;
      } else {
        // Fallback to simple replace if logic doesn't match
        node.nodeValue = fullNodeValue.replace(originalText, translatedText);
      }

      // Add lang attribute to parent element if enabled
      if (this.addLangAttributes && originalText !== translatedText) {
        this.addLangAttributeToElement(node.parentNode, this.targetLanguage);
      }
    } catch (error) {
      console.error('Error translating text node:', error);
    }
  }

  async translateAriaAttributes(ariaNodes) {
    // Process attributes one by one synchronously to prevent API corruption
    for (let i = 0; i < ariaNodes.length; i++) {
      await this.translateAriaAttribute(ariaNodes[i]);
      
      this.completedAriaNodes = i + 1;
      
      // Calculate overall progress (text nodes take 80% of progress, ARIA 20%)
      const textProgress = (this.completedTextNodes / Math.max(this.totalTextNodes, 1)) * 80;
      const ariaProgress = (this.completedAriaNodes / this.totalAriaNodes) * 20;
      const totalProgress = Math.round(textProgress + ariaProgress);
      
      chrome.runtime.sendMessage({
        action: 'translationProgress',
        progress: totalProgress
      });
      
      // Small delay to prevent API overwhelming
      if (i < ariaNodes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }

  async translateAriaAttribute(nodeData) {
    const { element, attribute, value } = nodeData;
    const nodeId = this.getAriaNodeId(element, attribute);
    
    if (!this.originalTexts.has(nodeId)) {
      this.originalTexts.set(nodeId, value);
    }

    try {
      let translatedText;
      
      // Check if we already have a translation for this text in the current language pair
      const cacheKey = `${this.currentLanguagePair}:${value}`;
      if (this.textTranslationCache.has(cacheKey)) {
        translatedText = this.textTranslationCache.get(cacheKey);
      } else {
        // Get new translation and cache it
        translatedText = await this.currentTranslator.translate(value);
        this.textTranslationCache.set(cacheKey, translatedText);
      }
      
      this.translatedTexts.set(nodeId, translatedText);
      element.setAttribute(attribute, translatedText);
    } catch (error) {
      console.error('Error translating ARIA attribute:', error);
    }
  }

  restoreOriginalText() {
    this.originalTexts.forEach((originalText, nodeId) => {
      if (nodeId.startsWith('aria-')) {
        const [, elementId, attribute] = nodeId.split('-', 3);
        const element = document.querySelector(`[data-yra-id="${elementId}"]`);
        if (element) {
          element.setAttribute(attribute, originalText);
        }
      } else {
        const textNodes = this.getAllTextNodes();
        const node = textNodes.find(n => this.getNodeId(n) === nodeId);
        if (node) {
          const currentText = node.nodeValue;
          const translatedText = this.translatedTexts.get(nodeId);
          if (translatedText) {
            node.nodeValue = currentText.replace(translatedText, originalText);
          }
        }
      }
    });

    this.translatedTexts.clear();
    
    // Restore original lang attributes
    this.restoreOriginalLangAttributes();
  }

  restoreOriginalLangAttributes() {
    // Restore original lang attributes for full-page translations
    const elementsWithLang = document.querySelectorAll('[data-yra-original-lang]');
    elementsWithLang.forEach(element => {
      const originalLang = element.dataset.yraOriginalLang;
      if (originalLang) {
        element.setAttribute('lang', originalLang);
      } else {
        element.removeAttribute('lang');
      }
      // Clean up the data attribute
      delete element.dataset.yraOriginalLang;
    });

    // Remove spans created for selection translations (both regular and iframe)
    const translatedSpans = document.querySelectorAll('span[data-yra-translated]');
    translatedSpans.forEach(span => {
      // Replace the span with its text content, preserving whitespace
      const textNode = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(textNode, span);
    });
    
    // Special handling for iframe translations - restore original content
    if (this.isInIframe) {
      this.restoreIframeSelections();
    }
  }

  restoreIframeSelections() {
    // Restore iframe selection translations by finding and replacing translated spans
    const iframeTranslatedSpans = document.querySelectorAll('span[data-yra-iframe-translation]');
    iframeTranslatedSpans.forEach(span => {
      // Find the corresponding original text
      const spanText = span.textContent;
      let originalText = null;
      
      // Look for original text in our tracking maps
      this.originalTexts.forEach((original, rangeId) => {
        if (rangeId.startsWith('iframe-selection-') && 
            this.translatedTexts.get(rangeId) === spanText) {
          originalText = original;
        }
      });
      
      if (originalText) {
        // Replace with original text
        const textNode = document.createTextNode(originalText);
        span.parentNode.replaceChild(textNode, span);
      } else {
        // Fallback: just remove the span wrapper
        const textNode = document.createTextNode(span.textContent);
        span.parentNode.replaceChild(textNode, span);
      }
    });
  }

  getNodeId(node) {
    // Create unique ID for each text node, not just parent
    if (!node.yraNodeId) {
      node.yraNodeId = 'yra-text-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }
    return node.yraNodeId;
  }

  getAriaNodeId(element, attribute) {
    if (!element.dataset.yraId) {
      element.dataset.yraId = 'yra-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }
    return `aria-${element.dataset.yraId}-${attribute}`;
  }

  isScriptOrStyle(node) {
    return node && (node.tagName === 'SCRIPT' || node.tagName === 'STYLE');
  }

  isHidden(node) {
    if (!node || !node.style) return false;
    const style = window.getComputedStyle(node);
    return style.display === 'none' || style.visibility === 'hidden';
  }

  addLangAttributeToElement(element, language) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    
    // Don't add lang to certain elements that shouldn't have it
    const skipElements = ['SCRIPT', 'STYLE', 'META', 'HEAD', 'HTML'];
    if (skipElements.includes(element.tagName)) return;
    
    // Store original lang attribute for restoration
    if (!element.dataset.yraOriginalLang) {
      element.dataset.yraOriginalLang = element.getAttribute('lang') || '';
    }
    
    // Set the language attribute
    element.setAttribute('lang', language);
  }

  async translateIframes(sourceLanguage, targetLanguage, addLangAttributes) {
    const iframes = document.querySelectorAll('iframe');
    console.log(`Found ${iframes.length} iframes to translate`);
    
    if (iframes.length === 0) return;
    
    let successfulIframes = 0;
    let failedIframes = 0;
    
    for (const iframe of iframes) {
      try {
        // Check if iframe is accessible
        const iframeSrc = iframe.src || 'about:blank';
        const isExternal = this.isExternalIframe(iframe);
        
        console.log(`Attempting to translate iframe: ${iframeSrc} (external: ${isExternal})`);
        
        // Send translation message to iframe via postMessage
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage({
            type: 'YRA_TRANSLATE_IFRAME',
            sourceLanguage,
            targetLanguage,
            addLangAttributes
          }, '*');
          
          // Set up a timeout to detect if iframe translation fails
          setTimeout(() => {
            // This timeout helps detect unresponsive iframes
            if (!this.iframeResponses) this.iframeResponses = new Set();
            if (!this.iframeResponses.has(iframe)) {
              failedIframes++;
              if (isExternal) {
                console.warn(`External iframe may not support translation due to permission policies: ${iframeSrc}`);
              }
            }
          }, 3000);
          
        }
      } catch (error) {
        failedIframes++;
        console.log('Could not communicate with iframe:', error.message);
        
        // Provide specific guidance for permission policy errors
        if (error.message.includes('permission') || error.message.includes('policy')) {
          console.warn('Iframe blocked due to permission policy. This iframe cannot be translated.');
        }
      }
    }
    
    // Provide user feedback about iframe translation
    if (failedIframes > 0) {
      setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'iframeTranslationWarning',
          message: `Some content in ${failedIframes} iframe(s) could not be translated due to security restrictions.`
        });
      }, 4000);
    }
  }

  isExternalIframe(iframe) {
    try {
      const iframeSrc = iframe.src;
      if (!iframeSrc || iframeSrc === 'about:blank') return false;
      
      const currentOrigin = window.location.origin;
      const iframeUrl = new URL(iframeSrc, window.location.href);
      const iframeOrigin = iframeUrl.origin;
      
      return currentOrigin !== iframeOrigin;
    } catch (error) {
      return true; // Assume external if we can't determine
    }
  }

  async restoreIframes() {
    const iframes = document.querySelectorAll('iframe');
    console.log(`Found ${iframes.length} iframes to restore`);
    
    for (const iframe of iframes) {
      try {
        // Send restore message to iframe via postMessage
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage({
            type: 'YRA_RESTORE_IFRAME'
          }, '*');
        }
      } catch (error) {
        console.log('Could not communicate with iframe (cross-origin):', error.message);
      }
    }
  }

  async handleIframeTextTranslationRequest(data, source) {
    // Parent handles individual text translation request from iframe
    const { requestId, text, sourceLanguage, targetLanguage } = data;
    
    try {
      console.log('PARENT: Translating text for iframe:', `"${text}"`);
      
      // Ensure we have a translator for this language pair
      const languagePair = `${sourceLanguage}-${targetLanguage}`;
      console.log(`PARENT: iframe translation request for ${languagePair}, current translator is for ${this.currentLanguagePair}`);
      
      // TEMPORARY FIX: Always create a new translator for iframe requests to avoid Chrome API caching issues
      if (!this.currentTranslator || this.currentLanguagePair !== languagePair) {
        console.log('PARENT: Creating new translator for iframe translation');
        
        // Destroy existing translator if it exists
        if (this.currentTranslator && typeof this.currentTranslator.destroy === 'function') {
          console.log('PARENT: Destroying previous translator');
          this.currentTranslator.destroy();
        }
        
        this.currentTranslator = await this.createTranslator(sourceLanguage, targetLanguage);
        this.currentLanguagePair = languagePair;
        console.log('PARENT: Created translator for iframe text translation:', languagePair);
      } else {
        console.log('PARENT: Using existing translator for iframe translation');
        // TEMPORARY: Force recreate even if language pair matches to test Chrome API behavior
        console.log('PARENT: TESTING - Force recreating translator to test Chrome API caching');
        if (this.currentTranslator && typeof this.currentTranslator.destroy === 'function') {
          this.currentTranslator.destroy();
        }
        this.currentTranslator = await this.createTranslator(sourceLanguage, targetLanguage);
        console.log('PARENT: Force-recreated translator for testing');
      }
      
      // Use the parent's translation capabilities  
      console.log('PARENT: About to translate with current translator for language pair:', this.currentLanguagePair);
      console.log('PARENT: Translator object exists:', !!this.currentTranslator);
      
      // Test the translator to make sure it's working for the right language
      if (text === 'Hello') {
        console.log('PARENT: Testing translator with "Hello" to verify language pair...');
      }
      
      const translatedText = await this.currentTranslator.translate(text);
      
      console.log('PARENT: Translation result:', `"${text}" -> "${translatedText}"`);
      console.log('PARENT: Sending translation back to iframe:', `"${translatedText}"`);
      
      // Send response back to iframe
      source.postMessage({
        type: 'YRA_IFRAME_TEXT_TRANSLATION_RESPONSE',
        requestId: requestId,
        translatedText: translatedText,
        success: true
      }, '*');
      
    } catch (error) {
      console.error('PARENT: Text translation failed:', error);
      
      // Handle language model download errors
      if (this.isLanguageDownloadError(error)) {
        this.handleLanguageDownloadNeeded(sourceLanguage, targetLanguage, error);
      }
      
      // Send error response back to iframe
      source.postMessage({
        type: 'YRA_IFRAME_TEXT_TRANSLATION_RESPONSE',
        requestId: requestId,
        error: this.getLanguageErrorMessage(error, sourceLanguage, targetLanguage),
        success: false
      }, '*');
    }
  }

  isLanguageDownloadError(error) {
    return error.message.includes('user gesture') && 
           (error.message.includes('downloading') || error.message.includes('downloadable'));
  }

  getLanguageErrorMessage(error, sourceLanguage, targetLanguage) {
    if (error.message.includes('user gesture') && error.message.includes('downloading')) {
      return `Language model for ${targetLanguage} is downloading. Please wait and try again.`;
    } else if (error.message.includes('user gesture') && error.message.includes('downloadable')) {
      return `Language model for ${targetLanguage} needs to be downloaded.`;
    } else if (error.message.includes('language pair')) {
      return `Translation from ${sourceLanguage} to ${targetLanguage} is not supported.`;
    }
    return error.message;
  }

  handleLanguageDownloadNeeded(sourceLanguage, targetLanguage, error) {
    // Notify popup to offer language download
    chrome.runtime.sendMessage({
      action: 'languageDownloadNeeded',
      sourceLanguage,
      targetLanguage,
      error: error.message
    });
  }

  async downloadLanguageModel(sourceLanguage, targetLanguage) {
    try {
      console.log(`Attempting to download language model for ${sourceLanguage} -> ${targetLanguage}`);
      
      // Notify popup that download is starting
      chrome.runtime.sendMessage({
        action: 'languageDownloadStarted',
        sourceLanguage,
        targetLanguage
      });
      
      // Start progress simulation
      this.simulateDownloadProgress(sourceLanguage, targetLanguage);
      
      // Create a translator which will trigger download if needed
      const translator = await this.createTranslator(sourceLanguage, targetLanguage);
      
      // Update progress to 80%
      chrome.runtime.sendMessage({
        action: 'languageDownloadProgress',
        progress: 80,
        sourceLanguage,
        targetLanguage
      });
      
      // Test the translator with a simple phrase to ensure it's working
      await translator.translate('Hello');
      
      // Update progress to 100%
      chrome.runtime.sendMessage({
        action: 'languageDownloadProgress',
        progress: 100,
        sourceLanguage,
        targetLanguage
      });
      
      // If successful, store the translator
      this.currentTranslator = translator;
      this.currentLanguagePair = `${sourceLanguage}-${targetLanguage}`;
      
      console.log(`Language model download successful for ${sourceLanguage} -> ${targetLanguage}`);
      
      // Notify popup of successful download
      setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'languageDownloadSuccess',
          sourceLanguage,
          targetLanguage
        });
      }, 500); // Small delay to show 100% progress
      
      return true;
      
    } catch (error) {
      console.error('Language model download failed:', error);
      
      // Notify popup of download failure
      chrome.runtime.sendMessage({
        action: 'languageDownloadFailed',
        sourceLanguage,
        targetLanguage,
        error: error.message
      });
      
      return false;
    }
  }

  simulateDownloadProgress(sourceLanguage, targetLanguage) {
    // Simulate download progress since Chrome doesn't provide real progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 15 + 5; // Random progress between 5-20%
      if (progress >= 75) {
        clearInterval(interval);
        return; // Stop at 75%, actual download completion will set it to 80-100%
      }
      
      chrome.runtime.sendMessage({
        action: 'languageDownloadProgress',
        progress: Math.min(progress, 75),
        sourceLanguage,
        targetLanguage
      });
    }, 200); // Update every 200ms
  }

  handleIframeTextTranslationResponse(data) {
    // Iframe handles translation response from parent
    const { requestId, translatedText, success, error } = data;
    
    if (!this.pendingIframeTranslations) {
      console.warn('IFRAME: Received translation response but no pending translations map');
      return;
    }
    
    const pendingRequest = this.pendingIframeTranslations.get(requestId);
    if (!pendingRequest) {
      console.warn('IFRAME: Received translation response for unknown request ID:', requestId);
      return;
    }
    
    // Remove from pending
    this.pendingIframeTranslations.delete(requestId);
    
    if (success) {
      console.log('IFRAME: Received successful translation from parent:', `"${translatedText}"`);
      pendingRequest.resolve(translatedText);
    } else {
      console.error('IFRAME: Received translation error from parent:', error);
      pendingRequest.reject(new Error(error || 'Translation failed'));
    }
  }

  async translateIframeSelectionUsingNormalMethod(sourceLanguage, targetLanguage, addLangAttributes) {
    // Iframe uses same structure-preserving logic as parent page
    console.log('IFRAME: Using structure-preserving selection translation');
    
    const selection = window.getSelection();
    if (!selection || selection.toString().trim().length === 0) {
      console.log('IFRAME: No selection found');
      return;
    }
    
    // Clear any previous translation state
    this.iframeTranslator = null;
    this.currentTranslator = null;
    
    // Store settings for use during translation
    this.addLangAttributes = addLangAttributes;
    this.sourceLanguage = sourceLanguage;
    this.targetLanguage = targetLanguage;
    console.log('IFRAME: Selection - stored language settings - source:', this.sourceLanguage, 'target:', this.targetLanguage);
    
    // Set up iframe translation mode with parent communication
    // Use arrow functions to capture current instance variables, not closure variables
    this.iframeTranslator = {
      translate: async (text) => {
        console.log('IFRAME: Selection translator using languages:', this.sourceLanguage, '->', this.targetLanguage);
        return await this.requestTranslationFromParent(text, this.sourceLanguage, this.targetLanguage);
      }
    };
    
    // Override the current translator for iframe mode
    this.currentTranslator = this.iframeTranslator;
    
    // Set up for iframe translation tracking
    this.pendingIframeTranslations = new Map();
    this.completedIframeTranslations = 0;
    this.totalIframeTranslations = 0;
    
    // Get text nodes within the selection using the same approach as parent page
    const textNodes = this.getTextNodesInSelection(selection);
    console.log('IFRAME: Found', textNodes.length, 'text nodes in selection');
    
    if (textNodes.length === 0) {
      console.log('IFRAME: No text nodes found in selection');
      return;
    }
    
    // Use the same translateNodes method as parent page for structure preservation
    await this.translateNodes(textNodes);
    
    console.log('IFRAME: Structure-preserving selection translation completed');
  }

  getTextNodesInSelection(selection) {
    // Get text nodes within the selection range
    const textNodes = [];
    if (selection.rangeCount === 0) return textNodes;
    
    const range = selection.getRangeAt(0);
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Only include nodes that intersect with the selection
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (this.isScriptOrStyle(node.parentNode)) return NodeFilter.FILTER_REJECT;
          if (this.isHidden(node.parentNode)) return NodeFilter.FILTER_REJECT;
          
          // Check if this text node intersects with the selection range
          const nodeRange = document.createRange();
          nodeRange.selectNode(node);
          
          if (range.intersectsNode(node)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );
    
    let currentNode;
    while (currentNode = walker.nextNode()) {
      textNodes.push(currentNode);
    }
    
    return textNodes;
  }

  async translatePageAndIframes(sourceLanguage, targetLanguage, addLangAttributes) {
    // Parent coordinates translation: first itself, then iframes
    console.log('PARENT: Starting coordinated translation of page and iframes');
    
    try {
      // First translate the parent page (this may trigger language model download)
      await this.translatePage(sourceLanguage, targetLanguage, addLangAttributes);
      
      // After parent translation is complete, translate iframes
      console.log('PARENT: Parent translation complete, starting iframe translation');
      this.translateIframes(sourceLanguage, targetLanguage, addLangAttributes);
      
    } catch (error) {
      console.error('PARENT: Coordinated translation failed:', error);
      
      // Handle language model download errors at the coordination level
      if (this.isLanguageDownloadError(error)) {
        this.handleLanguageDownloadNeeded(sourceLanguage, targetLanguage, error);
      } else {
        chrome.runtime.sendMessage({
          action: 'translationError',
          error: this.getLanguageErrorMessage(error, sourceLanguage, targetLanguage)
        });
      }
    }
  }

  async waitForParentReadyThenTranslate(sourceLanguage, targetLanguage, addLangAttributes) {
    // Iframe waits for parent to be ready before starting translation
    console.log('IFRAME: Waiting for parent to be ready for translation');
    
    const maxWaitTime = 10000; // 10 seconds max wait
    const checkInterval = 500; // Check every 500ms
    let waitTime = 0;
    
    const checkParentReady = () => {
      return new Promise((resolve) => {
        // Test if parent can handle translation requests
        const testRequest = {
          requestId: 'test-' + Date.now(),
          text: 'test',
          sourceLanguage,
          targetLanguage
        };
        
        // Set up listener for response
        const handleTestResponse = (event) => {
          if (event.data.type === 'YRA_IFRAME_TEXT_TRANSLATION_RESPONSE' && 
              event.data.requestId === testRequest.requestId) {
            window.removeEventListener('message', handleTestResponse);
            
            // If we get any response (success or specific download error), parent is ready
            const isReady = event.data.success || 
                           !event.data.error.includes('downloading') ||
                           event.data.error.includes('downloadable');
            resolve(isReady);
          }
        };
        
        window.addEventListener('message', handleTestResponse);
        
        // Send test request to parent
        parent.postMessage({
          type: 'YRA_IFRAME_TEXT_TRANSLATION_REQUEST',
          ...testRequest
        }, '*');
        
        // Timeout after 2 seconds
        setTimeout(() => {
          window.removeEventListener('message', handleTestResponse);
          resolve(false);
        }, 2000);
      });
    };
    
    // Wait for parent to be ready
    while (waitTime < maxWaitTime) {
      const isReady = await checkParentReady();
      if (isReady) {
        console.log('IFRAME: Parent is ready, starting translation');
        await this.translateIframePageUsingParentDelegation(sourceLanguage, targetLanguage, addLangAttributes);
        return;
      }
      
      console.log('IFRAME: Parent not ready yet, waiting...');
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waitTime += checkInterval;
    }
    
    console.warn('IFRAME: Timeout waiting for parent to be ready');
    // Try translation anyway
    await this.translateIframePageUsingParentDelegation(sourceLanguage, targetLanguage, addLangAttributes);
  }

  async translateIframePageUsingParentDelegation(sourceLanguage, targetLanguage, addLangAttributes) {
    // Iframe uses same structure-preserving logic as parent page for full page translation
    console.log('IFRAME: Using structure-preserving full page translation via parent delegation');
    console.log('IFRAME: Translation parameters - from:', sourceLanguage, 'to:', targetLanguage);
    
    if (this.isTranslating) {
      console.log('IFRAME: Translation already in progress');
      return;
    }
    
    this.isTranslating = true;
    
    try {
      // Clear any previous translation state
      this.iframeTranslator = null;
      this.currentTranslator = null;
      
      // Store settings for use during translation
      this.addLangAttributes = addLangAttributes;
      this.sourceLanguage = sourceLanguage;
      this.targetLanguage = targetLanguage;
      console.log('IFRAME: Stored language settings - source:', this.sourceLanguage, 'target:', this.targetLanguage);
      
      // Set up iframe translation mode with parent communication
      // Use arrow functions to capture current instance variables, not closure variables
      this.iframeTranslator = {
        translate: async (text) => {
          console.log('IFRAME: Translator using languages:', this.sourceLanguage, '->', this.targetLanguage);
          return await this.requestTranslationFromParent(text, this.sourceLanguage, this.targetLanguage);
        }
      };
      
      // Override the current translator for iframe mode
      this.currentTranslator = this.iframeTranslator;
      
      // Set up for iframe translation tracking
      this.pendingIframeTranslations = new Map();
      this.completedIframeTranslations = 0;
      this.totalIframeTranslations = 0;
      
      // Get all text nodes in the iframe using the same approach as parent page
      const textNodes = this.getAllTextNodes();
      console.log('IFRAME: Found', textNodes.length, 'text nodes for full page translation');
      
      if (textNodes.length === 0) {
        console.log('IFRAME: No text nodes found for translation');
        return;
      }
      
      // Get ARIA nodes for accessibility translation
      const ariaNodes = this.getAllAriaNodes();
      console.log('IFRAME: Found', ariaNodes.length, 'ARIA nodes for translation');
      
      // Use the same translateNodes method as parent page for structure preservation
      await this.translateNodes(textNodes);
      
      // Translate ARIA attributes if any
      if (ariaNodes.length > 0) {
        await this.translateAriaAttributes(ariaNodes);
      }
      
      console.log('IFRAME: Structure-preserving full page translation completed');
      
    } finally {
      this.isTranslating = false;
    }
  }
}

// Create instance only if not already created
if (!window.YRATranslator) {
  window.YRATranslator = new YRATranslator();
}

} // End of else block