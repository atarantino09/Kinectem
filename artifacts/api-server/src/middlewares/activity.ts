import type { RequestHandler } from "express";
import { db, userActivityLog } from "@workspace/db";
import { logger } from "../lib/logger";

/** Successful authenticated mutations, not page loads or background polling.
 * No body, URL parameters, query strings, IPs, messages, or credentials are stored.
 * Detailed transactional admin auditing remains a separate source.
 */
export const recordActivity: RequestHandler = (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const resource = /^\/api\/v1\/([a-z][a-z-]*)\b/.exec(req.path)?.[1];
  if (!resource) return next();
  res.once("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const actor = req.realUser ?? res.locals.activityActor ?? req.sessionUser;
    if (!actor?.id || typeof req.route?.path !== "string") return;
    const route = req.route.path;
    const verb = req.method === "DELETE" ? "delete" : req.method === "POST" ? "create" : "update";
    const segments = route.split("/").filter((part: string) => part && !part.startsWith(":"));
    const operation = segments.at(-1);
    const namedActions = ["follow", "like", "publish", "accept", "decline", "approve", "reject", "join", "leave", "hide", "unhide", "share"];
    const action = operation && namedActions.includes(operation)
      ? `${req.method === "DELETE" && ["follow", "like"].includes(operation) ? `un${operation}` : operation}_${segments.slice(0, -1).join("_")}`
      : `${verb}_${segments.join("_") || resource}`;
    const actionType = resource === "auth"
      ? (({ "/auth/login": "sign_in", "/auth/token": "sign_in", "/auth/logout": "sign_out", "/auth/signup": "sign_up" } as Record<string, string>)[route] ?? `account_${verb}`)
      : action.replaceAll("-", "_");
    void db.insert(userActivityLog).values({
      actorId: actor.id,
      actorType: actor.role === "admin" ? "admin" : "user",
      effectiveUserId: req.isMasquerading ? req.sessionUser?.id : null,
      actionType,
      resource,
      route,
    }).catch((err) => logger.error({ err, actionType }, "Failed to record user activity"));
  });
  next();
};
