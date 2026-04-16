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
import ArticlePage from "@/pages/ArticlePage";
import HighlightPage from "@/pages/HighlightPage";
import NewArticlePage from "@/pages/NewArticlePage";
import NewHighlightPage from "@/pages/NewHighlightPage";

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
      {/* Fullscreen creators (no layout) */}
      <Route path="/articles/new" component={NewArticlePage} />
      <Route path="/highlights/new" component={NewHighlightPage} />

      {/* Layout routes */}
      <Route>
        <Layout>
          <Switch>
            <Route path="/" component={FeedPage} />
            <Route path="/organizations" component={OrganizationsListPage} />
            <Route path="/organizations/:orgId" component={OrganizationPage} />
            <Route path="/teams/:teamId" component={TeamPage} />
            <Route path="/users/:userId" component={UserProfilePage} />
            <Route path="/articles/:articleId" component={ArticlePage} />
            <Route path="/highlights/:highlightId" component={HighlightPage} />
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
