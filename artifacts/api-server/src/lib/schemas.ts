import { z } from "zod";

export const HealthCheckResponse = z.object({ ok: z.boolean() });

export const LoginBody = z.object({
  userId: z.string().uuid(),
});

export const SignupBody = z.object({
  name: z.string().min(1),
  role: z.enum(["athlete", "coach", "admin", "parent"]),
  email: z.string().email().optional().nullable(),
  sport: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  grade: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  dateOfBirth: z.coerce.date().optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
});

export const CreateOrganizationBody = z.object({
  name: z.string().min(1),
  sport: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
});

export const CreateTeamBody = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  season: z.string().optional().nullable(),
  sport: z.string().optional().nullable(),
  level: z.string().optional().nullable(),
});

export const AddRosterEntryBody = z.object({
  userId: z.string().uuid(),
  role: z.enum(["player", "coach"]),
  position: z.string().optional().nullable(),
  jerseyNumber: z.number().int().optional().nullable(),
});

export const CreateArticleBody = z.object({
  teamId: z.string().uuid(),
  title: z.string().min(1),
  summary: z.string().optional().nullable(),
  body: z.string().optional().default(""),
  coverImageUrl: z.string().url().optional().nullable(),
  opponentName: z.string().optional().nullable(),
  teamScore: z.number().int().optional().nullable(),
  opponentScore: z.number().int().optional().nullable(),
  gameDate: z.coerce.date().optional().nullable(),
  status: z.enum(["draft", "published"]).optional().default("published"),
});

export const CreateHighlightBody = z.object({
  teamId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  videoUrl: z.string().url().optional().default(""),
  thumbnailUrl: z.string().url().optional().nullable(),
  durationSeconds: z.number().int().optional().nullable(),
  articleId: z.string().uuid().optional().nullable(),
});

export const CreateTeamInviteBody = z.object({
  teamId: z.string().uuid(),
  invitedEmail: z.string().email(),
  invitedName: z.string().optional().nullable(),
  role: z.enum(["player", "coach"]),
  position: z.string().optional().nullable(),
  jerseyNumber: z.number().int().optional().nullable(),
  grade: z.string().optional().nullable(),
});

export const AcceptInviteBody = z.object({
  // For new users, may carry signup info; for logged-in users, empty
  name: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(["athlete", "coach", "admin", "parent"]).optional(),
  dateOfBirth: z.coerce.date().optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
});
