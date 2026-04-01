# NLLB Translation API Specification

> **For:** Backend team at YRA Tech
> **Consumer:** YRA Translator Chrome Extension
> **Base URL:** `https://stage.yratech.com` (staging) / `https://yratech.com` (production)

---

## Endpoint

```
POST /api/translate/nllb
Content-Type: application/json
```

## Authentication

Uses the **existing NextAuth.js session cookie** (`next-auth.session-token`).

The Chrome extension already authenticates users via `POST /api/auth/callback/credentials` and sends cookies with `credentials: 'include'` on all requests. No additional auth mechanism is needed — just protect this endpoint with the same session middleware used by `/api/auth/session`.

If the session is missing or expired, return `401`.

---

## Request

```json
{
  "texts": [
    "Hello, how are you?",
    "Welcome to our website",
    "Click here to continue"
  ],
  "sourceLang": "eng_Latn",
  "targetLang": "fra_Latn"
}
```

| Field        | Type       | Required | Description                                      |
|-------------|------------|----------|--------------------------------------------------|
| `texts`     | `string[]` | Yes      | Array of text strings to translate                |
| `sourceLang`| `string`   | Yes      | NLLB-200 source language code (e.g., `eng_Latn`) |
| `targetLang`| `string`   | Yes      | NLLB-200 target language code (e.g., `fra_Latn`) |

### Language codes

Use NLLB-200 BCP-style codes. The full list used by the extension is in [`nllb-languages.js`](./nllb-languages.js). Examples:

| Code         | Language              |
|-------------|-----------------------|
| `eng_Latn`  | English               |
| `fra_Latn`  | French                |
| `spa_Latn`  | Spanish               |
| `deu_Latn`  | German                |
| `arb_Arab`  | Arabic (Modern Std)   |
| `zho_Hans`  | Chinese (Simplified)  |
| `jpn_Jpan`  | Japanese              |
| `hin_Deva`  | Hindi                 |
| `kor_Hang`  | Korean                |
| `rus_Cyrl`  | Russian               |

---

## Response (Success — 200)

```json
{
  "translations": [
    "Bonjour, comment allez-vous?",
    "Bienvenue sur notre site web",
    "Cliquez ici pour continuer"
  ]
}
```

| Field           | Type       | Description                                          |
|----------------|------------|------------------------------------------------------|
| `translations` | `string[]` | Translated texts, same order and length as `texts`   |

**Important:** The `translations` array **must** have the same length as the input `texts` array, with a 1:1 positional mapping.

---

## Error Responses

### 401 Unauthorized

```json
{
  "error": "Unauthorized",
  "message": "Please sign in to use cloud translation"
}
```

### 400 Bad Request

```json
{
  "error": "Bad Request",
  "message": "Missing required field: texts"
}
```

Other 400 cases:
- `texts` is empty or not an array
- `sourceLang` or `targetLang` is missing or not a valid NLLB code
- `sourceLang` equals `targetLang`

### 413 Payload Too Large

```json
{
  "error": "Payload Too Large",
  "message": "Batch size exceeds maximum of {MAX_BATCH_SIZE} texts"
}
```

### 429 Too Many Requests

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Try again in {retryAfterSeconds} seconds",
  "retryAfter": 30
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal Server Error",
  "message": "Translation failed"
}
```

---

## Example curl

```bash
# 1. Get CSRF token + session cookie
CSRF=$(curl -s -c cookies.txt https://stage.yratech.com/api/auth/csrf | jq -r '.csrfToken')

# 2. Login
curl -s -b cookies.txt -c cookies.txt \
  -X POST https://stage.yratech.com/api/auth/callback/credentials \
  -d "email=mh@yrtech.com&password=FastFood321&csrfToken=$CSRF&callbackUrl=https://stage.yratech.com/auth/signin" \
  -L

# 3. Translate
curl -s -b cookies.txt \
  -X POST https://stage.yratech.com/api/translate/nllb \
  -H "Content-Type: application/json" \
  -d '{
    "texts": ["Hello world", "How are you?"],
    "sourceLang": "eng_Latn",
    "targetLang": "fra_Latn"
  }'
```

---

## Questions for Backend Team

Please confirm or decide on these before implementation:

| Question | Suggested Default | Notes |
|----------|------------------|-------|
| **Max batch size** (number of texts per request) | 100 | The extension sends all visible text nodes on a page. Average page has 50-200 nodes. |
| **Max text length** per individual string | 5000 chars | Most text nodes are short (sentences, headings), but some may be paragraphs. |
| **Rate limit** | 10 req/min per user | Typical usage: 1-2 translation requests per page load. |
| **Timeout** | 30 seconds | For large batches. The extension will show a progress indicator. |
| **Source language auto-detect** | Support `"auto"` as `sourceLang` value? | The extension can detect page language client-side, but server-side detection would be more reliable for NLLB. |
| **Streaming** | Not required initially | Could add SSE/streaming later for large pages to show incremental progress. |

---

## How the Extension Will Use This

1. User clicks **"Translate (Cloud)"** in the popup
2. Extension extracts all visible text nodes from the page (already implemented in `content.js`)
3. Extension sends `POST /api/translate/nllb` with the batch of texts
4. Extension receives translations and replaces DOM text nodes (already implemented in `content.js`)
5. User can click **"Restore"** to revert (already implemented)

The extension already handles: text extraction, DOM replacement, progress UI, error display, and auth cookies. Once this endpoint exists, wiring it up is straightforward.
