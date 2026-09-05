# API Design (OpenAI-compatible)

## Auth

`Authorization: Bearer ig_sk_<prefix>_<secret>`. 401 `invalid_api_key` on miss. Key mgmt routes require `keys:write` scope.

## Endpoints

### POST /v1/chat/completions

Request:
```json
{ "model": "auto", "messages": [{"role":"user","content":"Explain Kubernetes"}], "stream": true, "max_tokens": 512, "temperature": 0.7 }
```

Non-stream response: `{ "id": "chatcmpl-...", "object": "chat.completion", "model": "...", "choices": [{"message": {"role":"assistant","content":"..."}, "finish_reason":"stop", "index":0}], "usage": {"prompt_tokens":N,"completion_tokens":M,"total_tokens":T} }`

Stream: `Content-Type: text/event-stream`, frames `data: {"id":...,"choices":[{"delta":{"content":"..."},"index":0}]}` … `data: [DONE]`.

Errors (OpenAI shape): `{ "error": { "message": "...", "type": "invalid_request_error|authentication_error|rate_limit_error|provider_error", "code": "..." } }` with 400/401/429/502.

Headers: `x-infergate-provider`, `x-infergate-retry`, `x-request-id`.

### GET /v1/models

`{ "object":"list", "data": [{"id":"gpt-4o-mini","object":"model","owned_by":"openai"}] }`

### POST /v1/keys/:id/rotate

Creates successor key, 24h dual-accept grace. Requires `keys:write`.

## Validation

Zod strict: `model` required string, `messages` min 1 with valid roles, `max_tokens` 1..128k, `temperature` 0..2. Unknown models → 400 `model_not_found` unless `auto`.
