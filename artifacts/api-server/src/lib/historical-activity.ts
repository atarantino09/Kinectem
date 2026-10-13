import { sql } from "drizzle-orm";

// These are saved record facts, not reconstructed click events. Never select
// bodies, captions, invitation credentials, RSVP notes, or email contents.
// All identifiers/expressions below are developer-owned constants, never input.
const records = [
  ["users", "account_record_created", "id", "id", "created_at", "user", "id", "Account created; this person may not have created it themselves."],
  ["users", "latest_sign_in_recorded", "id", "id", "last_sign_in_at", "user", "id", "Most recent saved sign-in only; not a complete login history."],
  ["articles", "article_record_created", "id", "author_id", "created_at", "article", "id", "Saved article creation (recap or practice plan); not edit history."],
  ["articles", "article_publication_recorded", "id", "author_id", "published_at", "article", "id", "Saved publication date; author is associated with the record, not necessarily the publishing actor."],
  ["org_posts", "org_post_record_created", "id", "author_id", "created_at", "org_post", "id", "Saved organization post creation."],
  ["org_posts", "org_post_publication_recorded", "id", "author_id", "published_at", "org_post", "id", "Saved publication date, not a full publication history."],
  ["highlights", "highlight_record_created", "id", "uploader_id", "created_at", "highlight", "id", "Saved highlight upload record."],
  ["highlights", "highlight_approval_recorded", "id", "approved_by_user_id", "approved_at", "highlight", "id", "Saved highlight approval."],
  ["post_comments", "comment_record_created", "id", "author_id", "created_at", "comment", "id", "Retained comment record; text is not included."],
  ["post_reactions", "reaction_record_created", "post_kind::text || ':' || post_ref_id::text || ':' || user_id::text", "user_id", "created_at", "post", "post_ref_id", "Retained reaction only; removed reactions are unavailable."],
  ["post_shares", "share_record_created", "id", "sharer_user_id", "created_at", "post", "post_ref_id", "Saved in-app share, not proof of external delivery."],
  ["organization_followers", "organization_follow_record_created", "organization_id::text || ':' || user_id::text", "user_id", "created_at", "organization", "organization_id", "Retained follow connection; may have been added automatically."],
  ["team_followers", "team_follow_record_created", "team_id::text || ':' || user_id::text", "user_id", "created_at", "team", "team_id", "Retained follow connection; may have been added automatically."],
  ["user_followers", "user_follow_record_created", "following_user_id::text || ':' || follower_user_id::text", "follower_user_id", "created_at", "user", "following_user_id", "Retained follow request/connection; creation does not imply approval."],
  ["roster_entries", "roster_record_created", "id", "user_id", "created_at", "team", "team_id", "Person on the roster record; not necessarily its creator. This is not an acceptance date."],
  ["roster_invites", "team_invitation_record_created", "id", "invited_by_id", "created_at", "team", "team_id", "Invitation created; does not prove delivery or acceptance."],
  ["organization_invites", "organization_invitation_record_created", "id", "invited_by_id", "created_at", "organization", "organization_id", "Invitation created; does not prove email delivery."],
  ["organization_invites", "organization_invitation_acceptance_recorded", "id", "resolved_user_id", "accepted_at", "organization", "organization_id", "Saved invitation acceptance date."],
  ["organization_join_requests", "organization_access_request_created", "id", "user_id", "created_at", "organization", "organization_id", "Saved access request."],
  ["organization_join_requests", "organization_access_decision_recorded", "id", "decided_by_id", "decided_at", "organization", "organization_id", "Saved decision date; not a complete decision history."],
  ["organization_claim_requests", "organization_claim_request_created", "id", "requested_by_user_id", "created_at", "organization", "organization_id", "Saved ownership claim request, not proof of ownership."],
  ["organization_claim_requests", "organization_claim_decision_recorded", "id", "decided_by_user_id", "decided_at", "organization", "organization_id", "Saved claim decision date."],
  ["tournament_participants", "competition_team_claim_recorded", "id", "claimed_by_user_id", "claimed_at", "competition", "tournament_id", "Saved competition team claim."],
  ["album_photos", "album_upload_record_created", "id", "uploader_user_id", "created_at", "post", "post_ref_id", "Retained album photo/video upload record."],
  ["schedule_event_rsvps", "latest_rsvp_recorded", "id", "responded_by_user_id", "responded_at", "schedule_event", "event_id", "Latest saved RSVP only; previous responses are unavailable."],
] as const;

export const historicalActivity = sql.join(records.map(
  ([table, action, id, actor, time, targetType, targetId, note]) => sql`
    SELECT ${action} || ':' || (${sql.raw(id)})::text AS id,
      ${sql.raw(actor)} AS actor_id, ${action}::text AS action_type,
      ${targetType}::text AS target_type, ${sql.raw(targetId)}::text AS target_id,
      json_build_object('note', ${note}::text)::text AS metadata,
      ${sql.raw(time)}${time === "responded_at" ? sql`` : sql` AT TIME ZONE 'UTC'`} AS created_at
    FROM ${sql.identifier(table)} WHERE ${sql.raw(time)} IS NOT NULL
  `,
), sql` UNION ALL `);
