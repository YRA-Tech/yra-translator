# NLLB Translation API — Async Batched Contract

> **Consumer:** YRA Translator Chrome Extension
> **Provider:** yra-monitor (`/api/translate`) → pool worker (yra-translation-service)
> **Base URL:** `https://stage.yratech.com` (staging) / `https://yratech.com` (production)

This documents the **implemented** flow. Translation is **asynchronous and
batched**: the extension submits all of a page's text in one job, then polls
for the result. There is no synchronous endpoint.

---

## Flow overview

```
Extension                         yra-monitor                 pool worker (yra-translation-service)
   │                                  │                                  │
   ├─ POST /api/translate ───────────▶│  create `translate` job          │
   │   {texts[], source_language,…}   │  status=pending                  │
   │◀─ 202 {job_id} ──────────────────┤                                  │
   │                                  │◀── POST /api/pool-worker/claim ───┤  job_types:["translate"]
   │                                  │    job_payload ──────────────────▶│  translate each text
   │                                  │◀── POST /api/jobs/{id}/complete ──┤  {translated_texts[]}
   ├─ GET /api/jobs/{job_id} ────────▶│  status, result_payload          │
   │◀─ {status:"completed",           │                                  │
   │     result_payload:{translated_texts[]}}                            │
```

---

## 1. Submit — `POST /api/translate`

**Auth:** NextAuth session cookie (`credentials: 'include'`). `401` if missing/expired.

### Request

```json
{
  "texts": ["Hello, how are you?", "Welcome", "Click here"],
  "source_language": "eng_Latn",
  "target_language": "fra_Latn",
  "model": "nllb-200-distilled-600M"
}
```

| Field             | Type       | Required | Notes                                                        |
|-------------------|------------|----------|--------------------------------------------------------------|
| `texts`           | `string[]` | Yes      | Non-empty. Max **200** per request (`413` if exceeded).      |
| `source_language` | `string`   | Yes      | NLLB code (`eng_Latn`) — see [`nllb-languages.js`](./nllb-languages.js). |
| `target_language` | `string`   | Yes      | NLLB code. Must differ from source (`400` otherwise).        |
| `model`           | `string`   | No       | Backend id; defaults to the service's `DEFAULT_TRANSLATION_MODEL` (NLLB-200). |

> The extension deduplicates strings before sending and chunks to ≤200 per job,
> so a page becomes a handful of jobs rather than one per text node.

### Response — `202 Accepted`

```json
{ "job_id": "uuid", "status": "pending", "message": "Translation job queued" }
```

---

## 2. Poll — `GET /api/jobs/{job_id}`

**Auth:** NextAuth session cookie. Returns `403` if the job isn't the caller's.

### Response — completed

```json
{
  "job_id": "uuid",
  "job_type": "translate",
  "status": "completed",
  "result_payload": {
    "translated_texts": ["Bonjour, comment allez-vous?", "Bienvenue", "Cliquez ici"],
    "model_used": "nllb-200-distilled-600M"
  },
  "error_message": null
}
```

- `status` is one of `pending` | `running` | `completed` | `failed`.
- **`result_payload.translated_texts` is positional 1:1 with the request `texts`** and has the same length.
- On `failed`, read `error_message`.

The extension polls with exponential backoff (500 ms → 3 s) up to a 120 s timeout per job.

---

## Error responses

| Status | When |
|--------|------|
| `400`  | `texts` missing/empty/not an array, non-string items, missing langs, or `source_language === target_language` |
| `401`  | No/expired session |
| `403`  | Polling a job that belongs to another user |
| `413`  | `texts` length exceeds the max batch size (200) |
| `500`  | Job creation failed |

Error body shape: `{ "error": "<message>" }`.

---

## Notes for future work

- **Synchronous endpoint:** not implemented and not planned for now. If added
  later it would be a separate route (e.g. `POST /api/translate/sync`) and
  likely limited to cloud API backends (Azure/DeepL/DeepSeek) that return fast.
- **Server batch limit** lives in `yra-monitor/app/api/translate/route.ts`
  (`MAX_BATCH_SIZE`). Keep the extension's `MAX_BATCH` in `content.js` ≤ that.
