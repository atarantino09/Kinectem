export type CoachInviteAssignment = {
  teamId: string;
  teamName: string;
  email: string;
  stagedId?: string;
  resultIndex?: number;
};

export type CoachInviteEmailGroup = {
  email: string;
  assignments: CoachInviteAssignment[];
};

// Keep all bulk/staged entry points on the same normalization rule. Groups are
// intentionally request-session-local: a later bulk action must never merge
// with a prior email (and therefore never resurrect its token).
export function groupCoachInviteAssignments(
  assignments: CoachInviteAssignment[],
): CoachInviteEmailGroup[] {
  const byEmail = new Map<string, CoachInviteAssignment[]>();
  const seen = new Set<string>();
  for (const assignment of assignments) {
    const email = assignment.email.trim().toLowerCase();
    if (!email) continue;
    const key = `${assignment.teamId}:${email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = byEmail.get(email) ?? [];
    group.push({ ...assignment, email });
    byEmail.set(email, group);
  }
  return Array.from(byEmail, ([email, grouped]) => ({
    email,
    assignments: grouped,
  }));
}

export function stagedIdsForSuccessfulCoachInvite(
  assignments: CoachInviteAssignment[],
): string[] {
  return Array.from(
    new Set(
      assignments.flatMap((assignment) =>
        assignment.stagedId ? [assignment.stagedId] : [],
      ),
    ),
  );
}