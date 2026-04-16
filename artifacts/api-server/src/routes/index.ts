import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import organizationsRouter from "./organizations";
import teamsRouter from "./teams";
import articlesRouter from "./articles";
import highlightsRouter from "./highlights";
import feedRouter from "./feed";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(organizationsRouter);
router.use(teamsRouter);
router.use(articlesRouter);
router.use(highlightsRouter);
router.use(feedRouter);

export default router;
