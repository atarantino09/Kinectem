import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import NotFound from "@/pages/not-found";
import FeedPage from "@/pages/FeedPage";
import OrganizationsListPage from "@/pages/OrganizationsListPage";
import OrganizationPage from "@/pages/OrganizationPage";
import TeamPage from "@/pages/TeamPage";
import UserProfilePage from "@/pages/UserProfilePage";
import PostPage from "@/pages/PostPage";
import NewPostPage from "@/pages/NewPostPage";
import SearchPage from "@/pages/SearchPage";
import MessagesPage from "@/pages/MessagesPage";
import PendingTagsPage from "@/pages/PendingTagsPage";
import DraftsPage from "@/pages/DraftsPage";
import MyTagsPage from "@/pages/MyTagsPage";
import LoginPage from "@/pages/LoginPage";

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
            <Route path="/organizations" component={OrganizationsListPage} />
            <Route path="/organizations/:orgId" component={OrganizationPage} />
            <Route path="/teams/:teamId" component={TeamPage} />
            <Route path="/users/:userId" component={UserProfilePage} />
            <Route path="/posts/:postId" component={PostPage} />
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
