import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import docsRouter from "./routes/docs";
import foundingAdminPageRouter from "./routes/founding-admin-page";
import { logger } from "./lib/logger";
import { loadSession } from "./lib/auth";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(loadSession);

app.get("/api/healthz", (_req, res) => {
  res.json({ ok: true });
});
app.use("/api", docsRouter);
app.use("/api", foundingAdminPageRouter);
app.use("/api/v1", router);

export default app;
