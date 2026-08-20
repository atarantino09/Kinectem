import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, organizations, orgSubscriptions } from "@workspace/db";
import {
  LEGACY_ORG_BILLING_FLOOR_SQL,
  ROLLING_90_DAY_BILLING_SQL,
} from "../src/lib/migrations";

describe("legacy organization billing-floor migration", () => {
  it("updates only pre-cutoff trialing subscriptions below the floor", async () => {
    const [legacy, postCutoff, activeLegacy, canceledLegacy, laterLegacy] = await db
      .insert(organizations)
      .values([
        {
          name: "Legacy trialing",
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        {
          name: "Post-cutoff trialing",
          createdAt: new Date("2026-09-01T00:00:00.000Z"),
        },
        {
          name: "Legacy active",
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        {
          name: "Legacy canceled",
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        {
          name: "Legacy already later",
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ])
      .returning();

    await db.insert(orgSubscriptions).values([
      {
        organizationId: legacy!.id,
        plan: "starter",
        status: "trialing",
        billingStartsAt: new Date("2026-09-29T00:00:00.000Z"),
      },
      {
        organizationId: postCutoff!.id,
        plan: "starter",
        status: "trialing",
        // Simulates the old fixed launch date. The rolling migration should
        // convert this post-cutoff org to its own day-90 date.
        billingStartsAt: new Date("2026-11-01T00:00:00.000Z"),
      },
      {
        organizationId: activeLegacy!.id,
        plan: "starter",
        status: "active",
        billingStartsAt: new Date("2026-11-01T00:00:00.000Z"),
      },
      {
        organizationId: canceledLegacy!.id,
        plan: "starter",
        status: "canceled",
        billingStartsAt: new Date("2026-11-01T00:00:00.000Z"),
      },
      {
        organizationId: laterLegacy!.id,
        plan: "starter",
        status: "trialing",
        billingStartsAt: new Date("2026-11-15T00:00:00.000Z"),
      },
    ]);

    // Startup runs the older rolling migration before the new legacy floor.
    // Execute the real billing sequence twice to prove the combined behavior
    // is stable, not merely the final migration in isolation.
    await db.execute(sql.raw(ROLLING_90_DAY_BILLING_SQL));
    await db.execute(sql.raw(LEGACY_ORG_BILLING_FLOOR_SQL));

    const afterFirstRun = await db
      .select({
        orgId: orgSubscriptions.organizationId,
        billingStartsAt: orgSubscriptions.billingStartsAt,
        updatedAt: orgSubscriptions.updatedAt,
      })
      .from(orgSubscriptions);

    await db.execute(sql.raw(ROLLING_90_DAY_BILLING_SQL));
    await db.execute(sql.raw(LEGACY_ORG_BILLING_FLOOR_SQL));

    const rows = await db
      .select({
        orgId: orgSubscriptions.organizationId,
        billingStartsAt: orgSubscriptions.billingStartsAt,
      })
      .from(orgSubscriptions);
    const byOrg = new Map(rows.map((row) => [row.orgId, row.billingStartsAt]));

    expect(byOrg.get(legacy!.id)?.toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(byOrg.get(postCutoff!.id)?.toISOString()).toBe(
      "2026-11-30T00:00:00.000Z",
    );
    expect(byOrg.get(activeLegacy!.id)?.toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(byOrg.get(canceledLegacy!.id)?.toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(byOrg.get(laterLegacy!.id)?.toISOString()).toBe(
      "2026-11-15T00:00:00.000Z",
    );

    const firstRunByOrg = new Map(
      afterFirstRun.map((row) => [row.orgId, row.updatedAt.toISOString()]),
    );
    const secondRunByOrg = new Map(
      rows.map((row) => [row.orgId, row.billingStartsAt?.toISOString()]),
    );
    expect(secondRunByOrg.get(legacy!.id)).toBe(
      "2026-11-01T00:00:00.000Z",
    );

    const afterSecondRun = await db
      .select({
        orgId: orgSubscriptions.organizationId,
        updatedAt: orgSubscriptions.updatedAt,
      })
      .from(orgSubscriptions);
    for (const row of afterSecondRun) {
      expect(row.updatedAt.toISOString()).toBe(firstRunByOrg.get(row.orgId));
    }

    const [legacyRow] = await db
      .select()
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.organizationId, legacy!.id));
    expect(legacyRow?.status).toBe("trialing");
  });
});