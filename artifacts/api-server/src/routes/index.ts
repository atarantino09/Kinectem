import { Router } from "express";
import adminRouter from "./admin";
import authRouter from "./auth";
import consentRouter from "./consent";
import currentUserRouter from "./current-user";
import usersRouter from "./users";
import organizationsRouter from "./organizations";
import organizationInvitesRouter from "./organization-invites";
import followsRouter from "./follows";
import followRequestsRouter from "./follow-requests";
import teamsRouter from "./teams";
import parentInboxRouter from "./parent-inbox";
import postsRouter from "./posts";
import draftsRouter from "./drafts";
import notificationsRouter from "./notifications";
import messagesRouter from "./messages";
import assetsRouter from "./assets";
import albumRouter from "./album";
import tagsStubRouter from "./tags-stub";
import tagsRouter from "./tags";
import guardiansRouter from "./guardians";
import guardiansCoppaRouter from "./guardians-coppa";
import childConversationsRouter from "./child-conversations";
import searchRouter from "./search";
import reportsRouter from "./reports";
import masqueradeRouter from "./masquerade";
import foundingSignupsRouter from "./founding-signups";

const router: Router = Router();

// /admin/* — admin-only operations (gated inside the router by requireAdmin)
router.use("/admin", adminRouter);

// All other domain routers register absolute paths (e.g. "/users/...")
// and therefore mount on the same root. Order does not matter for
// correctness because the original spec.ts had no overlapping paths
// across sections; we preserve that by mounting every domain at "/".
router.use(authRouter);
router.use(consentRouter);
router.use(currentUserRouter);
router.use(usersRouter);
router.use(organizationsRouter);
router.use(organizationInvitesRouter);
router.use(followsRouter);
router.use(followRequestsRouter);
router.use(teamsRouter);
router.use(parentInboxRouter);
router.use(postsRouter);
router.use(draftsRouter);
router.use(notificationsRouter);
router.use(messagesRouter);
router.use(assetsRouter);
router.use(albumRouter);
router.use(tagsStubRouter);
router.use(tagsRouter);
router.use(guardiansRouter);
router.use(guardiansCoppaRouter);
router.use(childConversationsRouter);
router.use(searchRouter);
router.use(reportsRouter);
router.use(masqueradeRouter);
router.use(foundingSignupsRouter);

export default router;
