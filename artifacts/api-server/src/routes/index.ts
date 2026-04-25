import { Router } from "express";
import specRouter from "./spec";
import adminRouter from "./admin";

const router: Router = Router();
router.use("/admin", adminRouter);
router.use(specRouter);

export default router;
