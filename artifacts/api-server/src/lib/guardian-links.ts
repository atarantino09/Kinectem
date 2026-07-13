// Task #755 — multi-guardian helpers.
//
// `guardian_links` is the source of truth for the parent↔child graph.
// `users.parentId` is a dual-written MIRROR of the primary ACTIVE link's
// guardian (the locked `coppa.ts` reads it). Every write path that changes
// link status or primary-ness MUST call `syncParentIdMirror` afterwards so
// the two can never drift.

import { db, users, guardianLinks } from "@workspace/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { notifyGuardianOfPendingItem } from "./coppa";

type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

// All ACTIVE guardian user ids for one child (primary first).
export async function getActiveGuardianIds(
  childId: string,
  dbx: DbOrTx = db,
): Promise<string[]> {
  const rows = await dbx
    .select({ guardianId: guardianLinks.guardianId, isPrimary: guardianLinks.isPrimary })
    .from(guardianLinks)
    .where(and(eq(guardianLinks.childId, childId), eq(guardianLinks.status, "active")))
    .orderBy(sql`${guardianLinks.isPrimary} DESC`, guardianLinks.createdAt);
  return rows
    .map((r) => r.guardianId)
    .filter((g): g is string => !!g);
}

// Batched: childId -> active guardian ids (primary first).
export async function getActiveGuardianIdsForChildren(
  childIds: ReadonlyArray<string>,
  dbx: DbOrTx = db,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const unique = Array.from(new Set(childIds));
  if (unique.length === 0) return map;
  const rows = await dbx
    .select({
      childId: guardianLinks.childId,
      guardianId: guardianLinks.guardianId,
    })
    .from(guardianLinks)
    .where(
      and(
        inArray(guardianLinks.childId, unique),
        eq(guardianLinks.status, "active"),
      ),
    )
    .orderBy(sql`${guardianLinks.isPrimary} DESC`, guardianLinks.createdAt);
  for (const r of rows) {
    if (!r.guardianId) continue;
    const list = map.get(r.childId) ?? [];
    list.push(r.guardianId);
    map.set(r.childId, list);
  }
  return map;
}

export async function isActiveGuardian(
  guardianUserId: string,
  childId: string,
  dbx: DbOrTx = db,
): Promise<boolean> {
  const [row] = await dbx
    .select({ id: guardianLinks.id })
    .from(guardianLinks)
    .where(
      and(
        eq(guardianLinks.childId, childId),
        eq(guardianLinks.guardianId, guardianUserId),
        eq(guardianLinks.status, "active"),
      ),
    )
    .limit(1);
  return !!row;
}

// All child ids for which the user is an ACTIVE guardian.
export async function getActiveChildIds(
  guardianUserId: string,
  dbx: DbOrTx = db,
): Promise<string[]> {
  const rows = await dbx
    .select({ childId: guardianLinks.childId })
    .from(guardianLinks)
    .where(
      and(
        eq(guardianLinks.guardianId, guardianUserId),
        eq(guardianLinks.status, "active"),
      ),
    );
  return rows.map((r) => r.childId);
}

// Of `childIds`, return the subset the viewer actively guards. Batched
// replacement for the old `eq(users.parentId, viewer.id)` filter.
export async function filterChildrenOfGuardian(
  guardianUserId: string,
  childIds: ReadonlyArray<string>,
  dbx: DbOrTx = db,
): Promise<Set<string>> {
  const unique = Array.from(new Set(childIds));
  if (unique.length === 0) return new Set();
  const rows = await dbx
    .select({ childId: guardianLinks.childId })
    .from(guardianLinks)
    .where(
      and(
        eq(guardianLinks.guardianId, guardianUserId),
        eq(guardianLinks.status, "active"),
        inArray(guardianLinks.childId, unique),
      ),
    );
  return new Set(rows.map((r) => r.childId));
}

// Fan-out wrapper over the LOCKED `coppa.ts` `notifyGuardianOfPendingItem`,
// which takes a single guardian. Notifies ALL active guardians of a child.
export async function notifyAllGuardiansOfPendingItem(args: {
  childUserId: string;
  kind: "follow" | "dm" | "comment" | "tag";
  message: string;
}): Promise<void> {
  const guardianIds = await getActiveGuardianIds(args.childUserId);
  for (const guardianUserId of guardianIds) {
    await notifyGuardianOfPendingItem({
      guardianUserId,
      childUserId: args.childUserId,
      kind: args.kind,
      message: args.message,
    });
  }
}

// Guardian-aware shim over the LOCKED `coppa.ts` `filterOutMinors`, which
// only honors the single `parentId` mirror (primary guardian). This patches
// `parentId` to the viewer's id on rows the viewer actively guards, so a
// non-primary guardian keeps seeing their child in list/search surfaces.
// The patched value is only used for the filter comparison and never
// serialized back to clients (callers select the fields they emit).
export async function patchParentIdForViewer<
  T extends { id?: string | null; isMinor?: boolean | null; parentId?: string | null },
>(rows: T[], viewerId: string | null, dbx: DbOrTx = db): Promise<T[]> {
  if (!viewerId) return rows;
  const minorIds = rows
    .filter((r) => r.isMinor && r.id && r.parentId !== viewerId)
    .map((r) => r.id as string);
  if (minorIds.length === 0) return rows;
  const guarded = await filterChildrenOfGuardian(viewerId, minorIds, dbx);
  if (guarded.size === 0) return rows;
  return rows.map((r) =>
    r.id && guarded.has(r.id) ? { ...r, parentId: viewerId } : r,
  );
}

// Re-derive `users.parentId` from the links table: primary active guardian
// wins; if none, fall back to any active guardian (oldest first); else null.
// Also self-heals the isPrimary flag when a child has active guardians but
// no primary (e.g. after the primary was revoked).
export async function syncParentIdMirror(
  childId: string,
  dbx: DbOrTx = db,
): Promise<void> {
  const rows = await dbx
    .select({
      id: guardianLinks.id,
      guardianId: guardianLinks.guardianId,
      isPrimary: guardianLinks.isPrimary,
    })
    .from(guardianLinks)
    .where(and(eq(guardianLinks.childId, childId), eq(guardianLinks.status, "active")))
    .orderBy(sql`${guardianLinks.isPrimary} DESC`, guardianLinks.createdAt);
  const withGuardian = rows.filter((r): r is typeof r & { guardianId: string } => !!r.guardianId);
  const primary = withGuardian.find((r) => r.isPrimary) ?? withGuardian[0] ?? null;

  if (primary && !primary.isPrimary) {
    // Promote the oldest active guardian to primary so the invariant
    // "every guarded child has exactly one primary" holds.
    await dbx
      .update(guardianLinks)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(guardianLinks.id, primary.id));
  }
  // Defensive: clear stray primary flags on non-selected active links.
  if (primary) {
    await dbx
      .update(guardianLinks)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(guardianLinks.childId, childId),
          eq(guardianLinks.status, "active"),
          eq(guardianLinks.isPrimary, true),
          ne(guardianLinks.id, primary.id),
        ),
      );
  }

  await dbx
    .update(users)
    .set({ parentId: primary?.guardianId ?? null })
    .where(eq(users.id, childId));
}

// Ensure an ACTIVE link exists for (child, guardian). Used by the legacy
// single-parent write paths (guardian-confirm, consent, admin edit, legacy
// POST /users/me/children) so parentId writes keep the links table in sync.
// Marks the link primary when the child has no active primary yet.
export async function ensureActiveGuardianLink(args: {
  childId: string;
  guardianId: string;
  relationshipType?: "parent" | "legal_guardian";
  consentMethod?: string;
  dbx?: DbOrTx;
}): Promise<void> {
  const dbx = args.dbx ?? db;
  const [existing] = await dbx
    .select({ id: guardianLinks.id, status: guardianLinks.status })
    .from(guardianLinks)
    .where(
      and(
        eq(guardianLinks.childId, args.childId),
        eq(guardianLinks.guardianId, args.guardianId),
        ne(guardianLinks.status, "revoked"),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.status !== "active") {
      await dbx
        .update(guardianLinks)
        .set({
          status: "active",
          consentGrantedAt: new Date(),
          consentMethod: args.consentMethod ?? "legacy_link",
          updatedAt: new Date(),
        })
        .where(eq(guardianLinks.id, existing.id));
    }
  } else {
    await dbx.insert(guardianLinks).values({
      childId: args.childId,
      guardianId: args.guardianId,
      relationshipType: args.relationshipType ?? "parent",
      status: "active",
      consentGrantedAt: new Date(),
      consentMethod: args.consentMethod ?? "legacy_link",
    });
  }
  await syncParentIdMirror(args.childId, dbx);
}
