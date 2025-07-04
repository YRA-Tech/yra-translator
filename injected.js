// Prevent multiple injections
if (typeof window.TranslatorAPI !== 'undefined') {
  console.log('TranslatorAPI already exists, skipping initialization');
} else {

class TranslatorAPI {
  constructor() {
    this.translators = new Map();
    this.setupMessageListener();
  }

  setupMessageListener() {
    window.addEventListener('message', async (event) => {
      if (event.source !== window) return;

      switch (event.data.type) {
        case 'CHECK_TRANSLATOR_API':
          console.log('Injected script received CHECK_TRANSLATOR_API message');
          this.checkAPIAvailability(event.data.id);
          break;
        case 'CREATE_TRANSLATOR':
          await this.createTranslator(event.data);
          break;
        case 'TRANSLATE_TEXT':
          await this.translateText(event.data);
          break;
        case 'DESTROY_TRANSLATOR':
          this.destroyTranslator(event.data.translatorId);
          break;
      }
    });
  }

  checkAPIAvailability(id) {
    const available = 'Translator' in window;
    console.log('Injected script checking API availability:', available);
    window.postMessage({
      type: 'TRANSLATOR_API_RESPONSE',
      id,
      available
    }, '*');
  }

  async createTranslator(data) {
    const { id, sourceLanguage, targetLanguage } = data;
    
    try {
      if (!('Translator' in window)) {
        throw new Error('Translator API not available');
      }

      const translator = await window.Translator.create({
        sourceLanguage,
        targetLanguage
      });

      this.translators.set(id, translator);

      window.postMessage({
        type: 'TRANSLATOR_CREATED',
        id,
        success: true
      }, '*');

    } catch (error) {
      window.postMessage({
        type: 'TRANSLATOR_CREATED',
        id,
        success: false,
        error: error.message
      }, '*');
    }
  }

  async translateText(data) {
    const { id, translatorId, text } = data;
    
    try {
      const translator = this.translators.get(translatorId);
      if (!translator) {
        throw new Error('Translator not found');
      }

      console.log(`Translating with API: "${text}"`);
      const translatedText = await translator.translate(text);
      console.log(`API returned: "${translatedText}"`);

      // Basic sanity check - if translation looks suspicious, log it
      if (translatedText && text.length > 10 && translatedText.length < 20 && 
          translatedText.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
        console.error('Suspicious translation detected - may be API issue:', {
          input: text,
          output: translatedText
        });
      }

      window.postMessage({
        type: 'TEXT_TRANSLATED',
        id,
        success: true,
        translatedText
      }, '*');

    } catch (error) {
      window.postMessage({
        type: 'TEXT_TRANSLATED',
        id,
        success: false,
        error: error.message
      }, '*');
    }
  }

  destroyTranslator(translatorId) {
    const translator = this.translators.get(translatorId);
    if (translator) {
      translator.destroy();
      this.translators.delete(translatorId);
    }
  }
}

// Create instance only if not already created
if (!window.TranslatorAPI) {
  window.TranslatorAPI = new TranslatorAPI();
}

} // End of else block