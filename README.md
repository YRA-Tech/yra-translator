# YRA Translator

A Chrome extension that provides full-page text translation using Chrome's new Translation APIs (Chrome 138+).

## Features

- **Full-page translation**: Translates all visible text on web pages
- **Selection translation**: if you select a portion of the page, and then choose Translate Selection from the popup, it will translate only the selected portion
- **Automatic language model download**: Google's new translation API relies on locally stored language models. If you haven't downloaded the models yet, they'll be downloaded as needed when you select new target languages
- **ARIA attributes translation**: Translates accessibility attributes like `aria-label`, `title`, `alt`, etc.
- **Built-in Translation API**: Uses Chrome's native Translation API for fast, offline translation
- **Language auto-detection**: Automatically detects source language
- **Restore functionality**: Easily restore original text
- **Multiple language support**: Supports 12+ languages
- **Works with iframes**: You should be able to use this with iframed content.

## Requirements

- Chrome 138+ (Desktop only)
- At least 22 GB free storage
- GPU with 4+ GB VRAM
- Unmetered network connection (for initial model download)

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory
5. Add icons to the `icons/` directory (16x16, 32x32, 48x48, 128x128 PNG files)

## Usage

1. Navigate to any webpage
2. Click the YRA Translator extension icon
3. Select source and target languages
4. Click "Translate Page"
5. Use "Restore" to return to original text

## API Availability

The extension automatically checks if the Translation API is available. If not available, you may need to:
- Update to Chrome 138+
- Ensure hardware requirements are met
- Wait for the translation model to download

## Files Structure

- `manifest.json` - Extension configuration
- `content.js` - Main translation logic
- `injected.js` - Translation API wrapper
- `popup.html/js` - Extension popup interface
- `background.js` - Service worker for notifications
- `icons/` - Extension icons (add your own)

## Supported Languages

English, Spanish, French, German, Italian, Portuguese, Russian, Japanese, Korean, Chinese, Arabic, Hindi

