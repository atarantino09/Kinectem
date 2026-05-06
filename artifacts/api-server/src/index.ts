import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";
import { runStartupMigrations } from "./lib/migrations";
import { startConsentScheduler } from "./lib/consent-scheduler";

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

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

start();
