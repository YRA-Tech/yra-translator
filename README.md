# YRA Translator

A Chrome extension for full-page text translation. It offers **two translation
modes**:

1. **On-device** — Chrome's built-in Translation APIs (Chrome 138+). Fast,
   offline, no account; ~12 common languages.
2. **Cloud (NLLB-200)** — translates via the YRA translation service for
   **200+ languages**. Requires signing in with a YRA account.

## Features

- **Full-page translation**: Translates all visible text on web pages
- **Selection translation**: select part of the page, then choose Translate Selection from the popup to translate only that portion
- **Two engines**: on-device (Chrome Translator API) or cloud (YRA NLLB-200)
- **Automatic language model download** (on-device mode): Chrome's translation API relies on locally stored language models, downloaded as needed when you pick new target languages
- **ARIA attributes translation**: Translates accessibility attributes like `aria-label`, `title`, `alt`, etc.
- **Language auto-detection**: Automatically detects source language
- **Restore functionality**: Easily restore original text
- **Works with iframes**: usable with iframed content

## Translation modes

### On-device (Chrome Translator API)

Default mode. Runs entirely in the browser using Chrome's native translation
models — no account, works offline once models are downloaded. Limited to the
languages Chrome supports (~12). Requires the hardware below.

### Cloud (NLLB-200)

Sign in via the popup to unlock cloud translation. The extension sends the
page's text to the YRA translation service (Meta's NLLB-200, 200+ languages)
and applies the results. Requirements are just a YRA account and a network
connection — no local GPU or model storage needed.

**How it works (async + batched):** the extension collects and deduplicates the
page's visible strings, submits them in batches to `POST /api/translate`, and
polls `GET /api/jobs/{id}` for the result. See
[`NLLB_API_SPEC.md`](./NLLB_API_SPEC.md) for the full contract. The 200+
language list lives in [`nllb-languages.js`](./nllb-languages.js).

## Requirements

**On-device mode:**
- Chrome 138+ (Desktop only)
- At least 22 GB free storage
- GPU with 4+ GB VRAM
- Unmetered network connection (for initial model download)

**Cloud mode:**
- A YRA account (sign in via the popup)
- Network connection

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory
5. Add icons to the `icons/` directory (16x16, 32x32, 48x48, 128x128 PNG files)

## Usage

**On-device:**
1. Navigate to any webpage
2. Click the YRA Translator extension icon
3. Select source and target languages
4. Click "Translate Page"
5. Use "Restore" to return to original text

**Cloud (NLLB):**
1. Click the extension icon and **sign in** with your YRA account
2. Pick a target language in the NLLB section
3. Click **"Translate (Cloud)"**
4. Use "Restore" to return to original text

## API Availability

For on-device mode, the extension checks whether the Chrome Translation API is
available. If not, you may need to update to Chrome 138+, ensure hardware
requirements are met, or wait for the translation model to download. Cloud mode
does not require the Chrome Translation API.

## Files Structure

- `manifest.json` - Extension configuration
- `content.js` - Main translation logic (on-device + NLLB cloud)
- `injected.js` - Chrome Translation API wrapper
- `popup.html/js` - Extension popup interface (incl. sign-in + NLLB section)
- `auth.js` - YRA account sign-in (NextAuth session)
- `nllb-languages.js` - NLLB-200 language list (200+ languages)
- `NLLB_API_SPEC.md` - Cloud translation API contract
- `background.js` - Service worker for notifications
- `icons/` - Extension icons

## Supported Languages

- **On-device:** English, Spanish, French, German, Italian, Portuguese, Russian, Japanese, Korean, Chinese, Arabic, Hindi
- **Cloud (NLLB-200):** 200+ languages — see [`nllb-languages.js`](./nllb-languages.js)
