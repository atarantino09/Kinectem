#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push-force
# Idempotent backstop: NULL out any users.avatar_url rows whose data: URL
# is corrupt or oversized. The serializer guard (safeAvatarUrl) catches the
# oversized case at egress, but cleaning the source table prevents the
# corrupt-but-tiny case (which the egress guard cannot detect) from
# resurfacing after a merge that re-seeds data.
pnpm --filter @workspace/api-server exec tsx scripts/cleanup-bad-avatars.ts
