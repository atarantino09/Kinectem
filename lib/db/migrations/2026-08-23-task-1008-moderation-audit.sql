ALTER TYPE "admin_action_type" ADD VALUE IF NOT EXISTS 'moderation_remove';
ALTER TYPE "admin_target_type" ADD VALUE IF NOT EXISTS 'follower';
ALTER TYPE "admin_target_type" ADD VALUE IF NOT EXISTS 'roster_entry';