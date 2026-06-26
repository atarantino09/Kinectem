import { Switch, Route, Router as WouterRouter } from "wouter";
import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import { PageLoader } from "@/components/PageLoader";

// Route components are lazy-loaded so each page ships as its own chunk and
// the first visit only downloads the code needed for the current route.
// The Layout shell stays eager so navigation keeps the chrome on screen.
const NotFound = lazy(() => import("@/pages/not-found"));
const FeedPage = lazy(() => import("@/pages/FeedPage"));
const OrganizationsListPage = lazy(() => import("@/pages/OrganizationsListPage"));
const MyOrgsPage = lazy(() => import("@/pages/MyOrgsPage"));
const OrganizationPage = lazy(() => import("@/pages/OrganizationPage"));
const MyTeamsPage = lazy(() => import("@/pages/MyTeamsPage"));
const TeamPage = lazy(() => import("@/pages/TeamPage"));
const UserProfilePage = lazy(() => import("@/pages/UserProfilePage"));
const PostPage = lazy(() => import("@/pages/PostPage"));
const NewPostPage = lazy(() => import("@/pages/NewPostPage"));
const SearchPage = lazy(() => import("@/pages/SearchPage"));
const MessagesPage = lazy(() => import("@/pages/MessagesPage"));
const PendingTagsPage = lazy(() => import("@/pages/PendingTagsPage"));
const DraftsPage = lazy(() => import("@/pages/DraftsPage"));
const MyTagsPage = lazy(() => import("@/pages/MyTagsPage"));
const GuardianPage = lazy(() => import("@/pages/GuardianPage"));
const FollowRequestsPage = lazy(() => import("@/pages/FollowRequestsPage"));
const ChildConversationPage = lazy(() => import("@/pages/ChildConversationPage"));
const InviteAcceptPage = lazy(() => import("@/pages/InviteAcceptPage"));
const OrgInviteAcceptPage = lazy(() => import("@/pages/OrgInviteAcceptPage"));
const ClaimOrgPage = lazy(() => import("@/pages/ClaimOrgPage"));
const TournamentPage = lazy(() => import("@/pages/TournamentPage"));
const TournamentSignupPage = lazy(() => import("@/pages/TournamentSignupPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));
const GuardianConfirmPage = lazy(() => import("@/pages/GuardianConfirmPage"));
const GuardianConsentPage = lazy(() => import("@/pages/GuardianConsentPage"));
const GuardianConsentFinalizePage = lazy(
  () => import("@/pages/GuardianConsentFinalizePage"),
);
const GuardianRevokePage = lazy(() => import("@/pages/GuardianRevokePage"));
const PrivacyPolicyPage = lazy(() => import("@/pages/PrivacyPolicyPage"));
const CoppaNoticePage = lazy(() => import("@/pages/CoppaNoticePage"));
const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"));
const AdminUsers = lazy(() => import("@/pages/admin/AdminUsers"));
const AdminModeration = lazy(() => import("@/pages/admin/AdminModeration"));
const AdminActivity = lazy(() => import("@/pages/admin/AdminActivity"));
const AdminFounding100 = lazy(() => import("@/pages/admin/AdminFounding100"));
const AdminOrgClaimLinks = lazy(
  () => import("@/pages/admin/AdminOrgClaimLinks"),
);
const AdminAiKeys = lazy(() => import("@/pages/admin/AdminAiKeys"));
const AdminPromoCodes = lazy(() => import("@/pages/admin/AdminPromoCodes"));
const AdminSchedule = lazy(() => import("@/pages/admin/AdminSchedule"));
const AdminTournaments = lazy(() => import("@/pages/admin/AdminTournaments"));
const AdminAnnouncements = lazy(
  () => import("@/pages/admin/AdminAnnouncements"),
);
const AdminOrganizations = lazy(
  () => import("@/pages/admin/AdminOrganizations"),
);
const OrgSubscribePage = lazy(() => import("@/pages/OrgSubscribePage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
    <Switch>
      {/* Fullscreen routes (no layout) */}
      <Route path="/login" component={LoginPage} />
      <Route path="/reset-password/:token" component={ResetPasswordPage} />
      <Route path="/guardian-confirm/:token" component={GuardianConfirmPage} />
      {/* Task #359 — COPPA email-plus parental-consent flow. The order
          here matters: wouter matches the more-specific /finalize route
          before falling through to the bare consent route. */}
      <Route
        path="/guardian-consent/:token/finalize"
        component={GuardianConsentFinalizePage}
      />
      <Route path="/guardian-consent/:token" component={GuardianConsentPage} />
      <Route path="/guardian-revoke/:token" component={GuardianRevokePage} />
      <Route path="/privacy-policy" component={PrivacyPolicyPage} />
      <Route path="/coppa-notice" component={CoppaNoticePage} />
      <Route path="/invites/:token" component={InviteAcceptPage} />
      <Route path="/org-invites/:token" component={OrgInviteAcceptPage} />
      <Route path="/claim/:token" component={ClaimOrgPage} />
      <Route path="/t/:slug/signup" component={TournamentSignupPage} />
      <Route path="/t/:slug" component={TournamentPage} />
      <Route path="/posts/new" component={NewPostPage} />

      {/* Layout routes */}
      <Route>
        <Layout>
          <Suspense fallback={<PageLoader />}>
          <Switch>
            <Route path="/" component={FeedPage} />
            <Route path="/search" component={SearchPage} />
            <Route path="/messages/:conversationId" component={MessagesPage} />
            <Route path="/messages" component={MessagesPage} />
            <Route path="/tags/pending" component={PendingTagsPage} />
            <Route path="/drafts" component={DraftsPage} />
            <Route path="/me/tags" component={MyTagsPage} />
            <Route path="/follow-requests" component={FollowRequestsPage} />
            <Route
              path="/family/:childId/messages/:conversationId"
              component={ChildConversationPage}
            />
            <Route path="/family" component={GuardianPage} />
            <Route path="/guardian" component={GuardianPage} />
            {/* Static "/organizations/mine" must precede the
                "/organizations/:orgId" dynamic route so wouter matches the
                more-specific path first. Same pattern for "/teams" vs
                "/teams/:teamId". */}
            <Route path="/organizations/mine" component={MyOrgsPage} />
            <Route path="/organizations" component={OrganizationsListPage} />
            <Route
              path="/organizations/:orgId/subscribe"
              component={OrgSubscribePage}
            />
            <Route path="/organizations/:orgId" component={OrganizationPage} />
            <Route path="/teams" component={MyTeamsPage} />
            <Route path="/teams/:teamId" component={TeamPage} />
            <Route path="/users/:userId" component={UserProfilePage} />
            <Route path="/posts/:postId" component={PostPage} />
            <Route path="/admin" component={AdminDashboard} />
            <Route path="/admin/users" component={AdminUsers} />
            <Route path="/admin/moderation" component={AdminModeration} />
            <Route path="/admin/activity" component={AdminActivity} />
            <Route path="/admin/founding-100" component={AdminFounding100} />
            <Route path="/admin/org-claim-links" component={AdminOrgClaimLinks} />
            <Route path="/admin/ai-keys" component={AdminAiKeys} />
            <Route path="/admin/promo-codes" component={AdminPromoCodes} />
            <Route path="/admin/schedule" component={AdminSchedule} />
            <Route path="/admin/tournaments" component={AdminTournaments} />
            <Route path="/admin/announcements" component={AdminAnnouncements} />
            <Route path="/admin/organizations" component={AdminOrganizations} />
            <Route component={NotFound} />
          </Switch>
          </Suspense>
        </Layout>
      </Route>
    </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
