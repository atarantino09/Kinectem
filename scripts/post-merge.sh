#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Apply this narrow development schema change without a broad push that can
# prompt on unrelated tables. Publish remains the production migration path.
pnpm --filter @workspace/api-server exec tsx scripts/sync-achievement-settings-dev.ts --development
# The API service runs its registered, idempotent migrations on startup.
# Workflow reconciliation restarts it after this script. A forced Drizzle push
# can prompt to truncate populated tables despite --force and then exit 0
# without applying the change when stdin is closed.
# Idempotent backstop: NULL out any users.avatar_url rows whose data: URL
# is corrupt or oversized. The serializer guard (safeAvatarUrl) catches the
# oversized case at egress, but cleaning the source table prevents the
# corrupt-but-tiny case (which the egress guard cannot detect) from
# resurfacing after a merge that re-seeds data.
pnpm --filter @workspace/api-server exec tsx scripts/cleanup-bad-avatars.ts
