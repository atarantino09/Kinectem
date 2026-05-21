import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import NotFound from "@/pages/not-found";
import FeedPage from "@/pages/FeedPage";
import OrganizationsListPage from "@/pages/OrganizationsListPage";
import MyOrgsPage from "@/pages/MyOrgsPage";
import OrganizationPage from "@/pages/OrganizationPage";
import MyTeamsPage from "@/pages/MyTeamsPage";
import TeamPage from "@/pages/TeamPage";
import UserProfilePage from "@/pages/UserProfilePage";
import PostPage from "@/pages/PostPage";
import NewPostPage from "@/pages/NewPostPage";
import SearchPage from "@/pages/SearchPage";
import MessagesPage from "@/pages/MessagesPage";
import PendingTagsPage from "@/pages/PendingTagsPage";
import DraftsPage from "@/pages/DraftsPage";
import MyTagsPage from "@/pages/MyTagsPage";
import GuardianPage from "@/pages/GuardianPage";
import FollowRequestsPage from "@/pages/FollowRequestsPage";
import ChildConversationPage from "@/pages/ChildConversationPage";
import InviteAcceptPage from "@/pages/InviteAcceptPage";
import OrgInviteAcceptPage from "@/pages/OrgInviteAcceptPage";
import LoginPage from "@/pages/LoginPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import GuardianConfirmPage from "@/pages/GuardianConfirmPage";
import GuardianConsentPage from "@/pages/GuardianConsentPage";
import GuardianConsentFinalizePage from "@/pages/GuardianConsentFinalizePage";
import GuardianRevokePage from "@/pages/GuardianRevokePage";
import PrivacyPolicyPage from "@/pages/PrivacyPolicyPage";
import CoppaNoticePage from "@/pages/CoppaNoticePage";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminModeration from "@/pages/admin/AdminModeration";
import AdminActivity from "@/pages/admin/AdminActivity";
import AdminFounding100 from "@/pages/admin/AdminFounding100";

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
      <Route path="/posts/new" component={NewPostPage} />

      {/* Layout routes */}
      <Route>
        <Layout>
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
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
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
