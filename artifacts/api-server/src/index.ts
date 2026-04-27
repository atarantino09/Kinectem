import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";
import { runStartupMigrations } from "./lib/migrations";

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

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

start();
