import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  users,
  organizations,
  teams,
  articles,
  highlights,
  articleAuthors,
  teamFollowers,
  organizationFollowers,
  takedownRequests,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";

const createdOrgIds: string[] = [];
const createdTeamIds: string[] = [];
const createdArticleIds: string[] = [];
const createdHighlightIds: string[] = [];
const createdUserIds: string[] = [];
const createdTakedownIds: string[] = [];
let viewerRestore:
  | {
      id: string;
      sport: string | null;
      city: string | null;
      state: string | null;
      teamFollowIds: string[];
      orgFollowIds: string[];
    }
  | undefined;
let sequence = 0;

const unique = (label: string) => `explore-${label}-${Date.now()}-${++sequence}`;

async function makeOrg(input: {
  name: string;
  sport: string;
  city: string;
  state: string;
}) {
  const [org] = await db.insert(organizations).values(input).returning();
  createdOrgIds.push(org.id);
  return org;
}

async function makeTeam(
  orgId: string,
  name: string,
  sport: string,
) {
  const [team] = await db.insert(teams).values({
    organizationId: orgId,
    name,
    sport,
  }).returning();
  createdTeamIds.push(team.id);
  return team;
}

async function makeArticle(
  teamId: string,
  authorId: string,
  title: string,
  options: {
    status?: "published" | "draft";
    hiddenAt?: Date | null;
  } = {},
) {
  const [article] = await db.insert(articles).values({
    teamId,
    authorId,
    title,
    body: "Explore reel test fixture",
    articleKind: "recap",
    status: options.status ?? "published",
    hiddenAt: options.hiddenAt ?? null,
  }).returning();
  createdArticleIds.push(article.id);
  return article;
}

async function makeHighlight(
  teamId: string,
  uploaderId: string,
  title: string,
  approvalStatus: "approved" | "pending",
) {
  const [highlight] = await db.insert(highlights).values({
    teamId,
    uploaderId,
    title,
    videoUrl: "https://example.test/explore-fixture.mp4",
    approvalStatus,
  }).returning();
  createdHighlightIds.push(highlight.id);
  return highlight;
}

afterEach(async () => {
  if (createdTakedownIds.length) {
    await db.delete(takedownRequests)
      .where(inArray(takedownRequests.id, createdTakedownIds.splice(0)));
  }
  if (createdArticleIds.length) {
    await db.delete(articleAuthors)
      .where(inArray(articleAuthors.articleId, createdArticleIds));
    await db.delete(articles)
      .where(inArray(articles.id, createdArticleIds.splice(0)));
  }
  if (createdHighlightIds.length) {
    await db.delete(highlights)
      .where(inArray(highlights.id, createdHighlightIds.splice(0)));
  }
  if (viewerRestore) {
    const restore = viewerRestore;
    await db.delete(teamFollowers).where(eq(teamFollowers.userId, restore.id));
    await db.delete(organizationFollowers)
      .where(eq(organizationFollowers.userId, restore.id));
    if (restore.teamFollowIds.length) {
      await db.insert(teamFollowers).values(
        restore.teamFollowIds.map((teamId) => ({ userId: restore.id, teamId })),
      ).onConflictDoNothing();
    }
    if (restore.orgFollowIds.length) {
      await db.insert(organizationFollowers).values(
        restore.orgFollowIds.map((organizationId) => ({
          userId: restore.id,
          organizationId,
        })),
      ).onConflictDoNothing();
    }
    await db.update(users).set({
      sport: restore.sport,
      city: restore.city,
      state: restore.state,
    }).where(eq(users.id, restore.id));
    viewerRestore = undefined;
  }
  if (createdTeamIds.length) {
    await db.delete(teamFollowers)
      .where(inArray(teamFollowers.teamId, createdTeamIds));
    await db.delete(teams).where(inArray(teams.id, createdTeamIds.splice(0)));
  }
  if (createdOrgIds.length) {
    await db.delete(organizationFollowers)
      .where(inArray(organizationFollowers.organizationId, createdOrgIds));
    await db.delete(organizations)
      .where(inArray(organizations.id, createdOrgIds.splice(0)));
  }
  if (createdUserIds.length) {
    await db.delete(users).where(inArray(users.id, createdUserIds.splice(0)));
  }
});

describe("GET /api/v1/posts/explore", () => {
  it("requires authentication and rejects malformed pagination inputs", async () => {
    const res = await request(app).get("/api/v1/posts/explore");
    expect(res.status).toBe(401);

    const { agent } = await loginAs("sam@kinectem.demo");
    expect((await agent.get("/api/v1/posts/explore?limit=0")).status).toBe(400);
    expect((await agent.get("/api/v1/posts/explore?limit=51")).status).toBe(400);
    expect((await agent.get("/api/v1/posts/explore?limit=abc")).status).toBe(400);
    expect((await agent.get("/api/v1/posts/explore?cursor=not-a-cursor")).status).toBe(400);
  });

  it("ranks two-signal matches and excludes followed, own, hidden, pending, private, and takedown content", async () => {
    const { agent, user: viewer } = await loginAs("morgan@kinectem.demo");
    const [viewerRow] = await db.select().from(users).where(eq(users.id, viewer.id));
    const [oldTeamFollows, oldOrgFollows] = await Promise.all([
      db.select({ teamId: teamFollowers.teamId }).from(teamFollowers)
        .where(eq(teamFollowers.userId, viewer.id)),
      db.select({ orgId: organizationFollowers.organizationId })
        .from(organizationFollowers).where(eq(organizationFollowers.userId, viewer.id)),
    ]);
    viewerRestore = {
      id: viewer.id,
      sport: viewerRow.sport,
      city: viewerRow.city,
      state: viewerRow.state,
      teamFollowIds: oldTeamFollows.map((r) => r.teamId),
      orgFollowIds: oldOrgFollows.map((r) => r.orgId),
    };

    const signalSport = unique("sport");
    const signalCity = unique("city");
    const signalState = `X${sequence % 9}Z`;
    await db.update(users).set({
      sport: signalSport,
      city: signalCity,
      state: signalState,
    }).where(eq(users.id, viewer.id));
    await db.delete(teamFollowers).where(eq(teamFollowers.userId, viewer.id));
    await db.delete(organizationFollowers)
      .where(eq(organizationFollowers.userId, viewer.id));

    const publicAuthor = "sam@kinectem.demo";
    const [author] = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, publicAuthor)).limit(1);
    if (!author) throw new Error("Expected public fixture author");

    const bothOrg = await makeOrg({
      name: unique("both-org"),
      sport: signalSport,
      city: signalCity,
      state: signalState,
    });
    const sportOrg = await makeOrg({
      name: unique("sport-org"),
      sport: signalSport,
      city: unique("other-city"),
      state: "YY",
    });
    const locationOrg = await makeOrg({
      name: unique("location-org"),
      sport: unique("other-sport"),
      city: signalCity,
      state: signalState,
    });
    const followedOrg = await makeOrg({
      name: unique("followed-org"),
      sport: signalSport,
      city: signalCity,
      state: signalState,
    });
    const bothTeam = await makeTeam(bothOrg.id, unique("both-team"), signalSport);
    const sportTeam = await makeTeam(sportOrg.id, unique("sport-team"), signalSport);
    const locationTeam = await makeTeam(locationOrg.id, unique("location-team"), unique("different-sport"));
    const followedTeam = await makeTeam(bothOrg.id, unique("followed-team"), signalSport);
    const followedOrgTeam = await makeTeam(followedOrg.id, unique("followed-org-team"), signalSport);

    const bothArticle = await makeArticle(bothTeam.id, author.id, unique("both-recap"));
    const sportArticle = await makeArticle(sportTeam.id, author.id, unique("sport-recap"));
    const locationArticle = await makeArticle(locationTeam.id, author.id, unique("location-recap"));
    const followedTeamArticle = await makeArticle(
      followedTeam.id, author.id, unique("followed-team-recap"),
    );
    const followedOrgArticle = await makeArticle(
      followedOrgTeam.id, author.id, unique("followed-org-recap"),
    );
    const ownArticle = await makeArticle(bothTeam.id, viewer.id, unique("own-recap"));
    const hiddenArticle = await makeArticle(
      bothTeam.id, author.id, unique("hidden-recap"), { hiddenAt: new Date() },
    );
    const draftArticle = await makeArticle(
      bothTeam.id, author.id, unique("draft-recap"), { status: "draft" },
    );

    const [privateAuthor] = await db.insert(users).values({
      name: unique("private-author"),
      email: `${unique("private")}@example.test`,
      role: "fan",
      profileVisibility: "followers",
    }).returning();
    createdUserIds.push(privateAuthor.id);
    const privateArticle = await makeArticle(
      bothTeam.id, privateAuthor.id, unique("private-recap"),
    );
    const pendingTakedownArticle = await makeArticle(
      bothTeam.id, author.id, unique("takedown-recap"),
    );
    const [takedown] = await db.insert(takedownRequests).values({
      childUserId: viewer.id,
      postKind: "article",
      postRefId: pendingTakedownArticle.id,
      status: "pending",
    }).returning();
    createdTakedownIds.push(takedown.id);

    const approvedHighlight = await makeHighlight(
      bothTeam.id, author.id, unique("approved-highlight"), "approved",
    );
    const ownHighlight = await makeHighlight(
      bothTeam.id, viewer.id, unique("own-highlight"), "approved",
    );
    const pendingHighlight = await makeHighlight(
      bothTeam.id, author.id, unique("pending-highlight"), "pending",
    );
    const hiddenHighlight = await makeHighlight(
      bothTeam.id, author.id, unique("hidden-highlight"), "approved",
    );
    await db.update(highlights).set({ hiddenAt: new Date() })
      .where(eq(highlights.id, hiddenHighlight.id));

    await db.insert(teamFollowers).values({ userId: viewer.id, teamId: followedTeam.id });
    await db.insert(organizationFollowers).values({
      userId: viewer.id,
      organizationId: followedOrg.id,
    });

    const first = await agent.get("/api/v1/posts/explore?limit=2");
    expect(first.status, first.text).toBe(200);
    const firstIds = first.body.data.map((item: { post: { id: string } }) => item.post.id);
    expect(firstIds.length).toBe(2);
    expect(first.body.pagination.hasMore).toBe(true);
    const allItems = [...first.body.data];
    let cursor = first.body.pagination.nextCursor as string | null;
    for (let pageNo = 0; cursor && pageNo < 10; pageNo += 1) {
      const next = await agent.get(
        `/api/v1/posts/explore?limit=2&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(next.status, next.text).toBe(200);
      allItems.push(...next.body.data);
      cursor = next.body.pagination.nextCursor;
    }
    expect(cursor).toBeNull();
    const ids = allItems.map((item: { post: { id: string } }) => item.post.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(`article-${bothArticle.id}`);
    expect(ids).toContain(`article-${sportArticle.id}`);
    expect(ids).toContain(`article-${locationArticle.id}`);
    expect(ids).toContain(`highlight-${approvedHighlight.id}`);
    expect(ids.indexOf(`article-${bothArticle.id}`))
      .toBeLessThan(ids.indexOf(`article-${sportArticle.id}`));
    expect(ids.indexOf(`article-${bothArticle.id}`))
      .toBeLessThan(ids.indexOf(`article-${locationArticle.id}`));

    for (const excluded of [
      followedTeamArticle,
      followedOrgArticle,
      ownArticle,
      hiddenArticle,
      draftArticle,
      privateArticle,
      pendingTakedownArticle,
    ]) {
      expect(ids).not.toContain(`article-${excluded.id}`);
    }
    expect(ids).not.toContain(`highlight-${pendingHighlight.id}`);
    expect(ids).not.toContain(`highlight-${hiddenHighlight.id}`);
    expect(ids).not.toContain(`highlight-${ownHighlight.id}`);

    // Drop every source of Explore personalization and confirm the explicit
    // no-signal response rather than relying on an empty seeded result.
    await db.update(users).set({ sport: null, city: null, state: null })
      .where(eq(users.id, viewer.id));
    await db.delete(teamFollowers).where(eq(teamFollowers.userId, viewer.id));
    await db.delete(organizationFollowers)
      .where(eq(organizationFollowers.userId, viewer.id));
    const noSignals = await agent.get("/api/v1/posts/explore");
    expect(noSignals.status).toBe(200);
    expect(noSignals.body).toEqual({
      data: [],
      pagination: { hasMore: false, nextCursor: null },
      reason: "add_sport_or_location",
    });
  });
});