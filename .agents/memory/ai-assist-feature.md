---
name: AI Assist / provider keys
description: How AI-generated post copy and self-managed provider API keys work in Kinectem, and the authz boundary that gates them.
---

# AI Assist & provider keys

- Provider API keys (Anthropic) are **self-managed by the app**, NOT Replit-managed: an admin enters the key under the admin "AI Keys" page; it is stored **encrypted at rest** (AES-256-GCM) in the `ai_provider_keys` table (`keyCiphertext` + `keyLast4`), never returned raw. The encryption key is derived (scrypt) from `AI_KEYS_ENCRYPTION_KEY`, falling back to `SESSION_SECRET`.
  - **Why:** the user explicitly wanted to enter their own Anthropic key in-app rather than via Replit Secrets/connector.
  - **How to apply:** if rotating the derivation secret, existing ciphertext becomes undecryptable — re-enter keys. Decrypt failures should surface as a provider/`AI_REQUEST_FAILED` error, not a crash.

- **External-AI egress must be gated by `canAuthorRecapAnywhere`, not just `requireAuth`.** The `POST /ai/assist` endpoint and the composer's AI Assist button both check recap-author capability (org admin / coach / explicit author). Plain athletes/parents/minors get `403 AI_FORBIDDEN` server-side and the button is hidden client-side (`whoami.canAuthorRecap`).
  - **Why:** this is a youth/COPPA app — minors and non-authors must not be able to push content to a third-party AI provider. A code review caught that `requireAuth` alone was too permissive.
  - **How to apply:** any new endpoint that sends user content to an external AI/LLM provider must mirror this capability gate; UI hiding is best-effort only, the server check is the real boundary.

- **No runtime OpenAPI validation in api-server** — `openapi.yaml` is codegen-only. New admin/feature endpoints follow the Founding-100 precedent: hand-written zod validation + plain JSON responses + client `customFetch`, with NO `openapi.yaml` edit.
