import { deliverCompetitionRecaps } from "@workspace/competition-recap-alerts";
import { appBaseUrl, isEmailConfiguredAsync, sendEmail } from "./email";
import { logger } from "./logger";

let running = false;
export async function sweepCompetitionRecapMail(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await deliverCompetitionRecaps({
      baseUrl: appBaseUrl(),
      send: async message => {
        // The legacy sender intentionally returns on missing credentials.
        // Durable mail must retry that condition rather than mark it sent.
        if (!(await isEmailConfiguredAsync())) throw new Error("Email is not configured");
        await sendEmail({ ...message, requireDelivery: true });
      },
    });
    if (result.sent || result.failed) logger.info(result, "Competition recap mail sweep");
  } catch (err) {
    logger.warn({ err }, "Competition recap mail sweep failed");
  } finally {
    running = false;
  }
}

export function startCompetitionRecapScheduler(): void {
  void sweepCompetitionRecapMail();
  setInterval(() => void sweepCompetitionRecapMail(), 15_000).unref();
}
