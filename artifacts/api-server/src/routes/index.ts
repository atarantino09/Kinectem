import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import organizationsRouter from "./organizations";
import teamsRouter from "./teams";
import articlesRouter from "./articles";
import highlightsRouter from "./highlights";
import feedRouter from "./feed";
import tagsRouter from "./tags";
import invitesRouter from "./invites";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(organizationsRouter);
router.use(teamsRouter);
router.use(articlesRouter);
router.use(highlightsRouter);
router.use(feedRouter);
router.use(tagsRouter);
router.use(invitesRouter);
router.use(notificationsRouter);

export default router;
