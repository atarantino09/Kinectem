---
name: AI Assist / provider keys
description: How AI-generated post copy and self-managed provider API keys work in Kinectem, and the authz boundary that gates them.
---

# AI Assist & provider keys

- Provider API keys (Anthropic) are **self-managed by the app**, NOT Replit-managed: an admin enters the key under the admin "AI Assist" tab (route slug `/admin/ai-keys` unchanged); it is stored **encrypted at rest** (AES-256-GCM) in the `ai_provider_keys` table (`keyCiphertext` + `keyLast4`), never returned raw. The encryption key is derived (scrypt) from `AI_KEYS_ENCRYPTION_KEY`, falling back to `SESSION_SECRET`.
  - **Why:** the user explicitly wanted to enter their own Anthropic key in-app rather than via Replit Secrets/connector.
  - **How to apply:** if rotating the derivation secret, existing ciphertext becomes undecryptable — re-enter keys. Decrypt failures should surface as a provider/`AI_REQUEST_FAILED` error, not a crash.

- **External-AI egress must be gated by `canAuthorRecapAnywhere`, not just `requireAuth`.** The `POST /ai/assist` endpoint and the composer's AI Assist button both check recap-author capability (org admin / coach / explicit author). Plain athletes/parents/minors get `403 AI_FORBIDDEN` server-side and the button is hidden client-side (`whoami.canAuthorRecap`).
  - **Why:** this is a youth/COPPA app — minors and non-authors must not be able to push content to a third-party AI provider. A code review caught that `requireAuth` alone was too permissive.
  - **How to apply:** any new endpoint that sends user content to an external AI/LLM provider must mirror this capability gate; UI hiding is best-effort only, the server check is the real boundary.

- **Pin the Anthropic model to a dated release, never a `-latest` alias.** `DEFAULT_ANTHROPIC_MODEL` lives in `src/lib/ai.ts`.
  - **Why:** the `claude-3-5-sonnet-latest` alias stopped being served and returned `404 not_found_error: model`, which surfaced to users as `502 AI_REQUEST_FAILED`. Dated releases (e.g. `claude-sonnet-4-5-20250929`) are stable.
  - **How to apply:** when bumping the default model or accepting an admin override, verify the id against the live models list before trusting it.

- **Admin picks the model from a live dropdown, not free text.** `GET /admin/ai-providers/:provider/models` calls the Anthropic SDK `client.models.list` (admin-only, requires a saved key, same rate limiter) so the dropdown shows real, current model ids.
  - **Why:** typing a model id risks pinning a stale/aliased id that 404s (see the `-latest` lesson above); the live list always reflects what the key can actually call.
  - **How to apply:** the frontend always keeps the saved model selectable even if the list fails to load; keep that fallback so a fetch error never silently wipes the admin's pinned model.

- **Admin "context & personality" tunes the AI voice.** Optional nullable `ai_provider_keys.system_context` is prepended to the system prompt of every generation; admins can have the AI draft this field itself via admin-only `POST /admin/ai-providers/:provider/assist-context` (requires a saved key, same per-user rate limiter as `/ai/assist`).
  - **Why:** orgs wanted generated copy to carry their own voice/values without code changes.
  - **How to apply:** any new generation path must prepend `systemContext` too, or it will silently ignore the admin's tuning.

- **No runtime OpenAPI validation in api-server** — `openapi.yaml` is codegen-only. New admin/feature endpoints follow the Founding-100 precedent: hand-written zod validation + plain JSON responses + client `customFetch`, with NO `openapi.yaml` edit.

- **The Claude engine is reused for the org recap newsletter, not just single posts.** A `generateNewsletterText()` lives alongside `generatePostText()` in `lib/ai.ts` (same `getAnthropicConfig()` + `systemContext` prepend + dated-model rules). Its org-scoped endpoints (`GET/POST /organizations/:orgId/newsletter/{recaps,generate}`) live in `routes/organizations.ts`, NOT `routes/ai.ts`, because they need org data + `canManageOrganization`.
  - **Why:** newsletter is org-owner/admin-scoped and reads the org's published recaps; co-locating with other org routes was cleaner than ai.ts.
  - **How to apply:** the generate endpoint still mirrors the COPPA egress gate (`canAuthorRecapAnywhere` in addition to `canManageOrganization`) — keep that double gate on any org-scoped AI egress. Recaps are date-filtered on `coalesce(game_date, published_at, created_at)` so recaps with a null game date still appear by publish date.
