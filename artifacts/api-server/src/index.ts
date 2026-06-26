import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";
import { runStartupMigrations } from "./lib/migrations";
import { startConsentScheduler } from "./lib/consent-scheduler";
import { startGameRecapReminderScheduler } from "./lib/game-recap-reminder-scheduler";
import { startScheduleReminderScheduler } from "./lib/schedule-reminder-scheduler";
import { auditSecretStrength } from "./lib/secret-audit";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  // Code review S8 / S9 — surface weak/missing secrets at boot (non-fatal).
  auditSecretStrength();

  // Task #190 — Run idempotent SQL migrations *before* seeding so the
  // schema is in its current shape before any seed query touches the
  // affected tables.
  try {
    await runStartupMigrations();
  } catch (err) {
    logger.error({ err }, "Startup migrations failed (non-fatal)");
  }
  try {
    await seedIfEmpty();
  } catch (err) {
    logger.error({ err }, "Failed to seed database");
  }

  // Task #359 — durable email-plus follow-up scheduler. Picks up any
  // pending_followup rows whose in-process timer was lost across a
  // restart and delivers the second email.
  try {
    startConsentScheduler();
  } catch (err) {
    logger.error({ err }, "Failed to start consent scheduler (non-fatal)");
  }

  // Durable "write your game recap" reminder sweep — nudges recap-writing
  // staff a couple hours after a game starts if no recap is linked yet.
  try {
    startGameRecapReminderScheduler();
  } catch (err) {
    logger.error(
      { err },
      "Failed to start game-recap reminder scheduler (non-fatal)",
    );
  }

  // Phase 2 — durable "event starts in ~24h" reminder sweep.
  try {
    startScheduleReminderScheduler();
  } catch (err) {
    logger.error(
      { err },
      "Failed to start schedule reminder scheduler (non-fatal)",
    );
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

start();
