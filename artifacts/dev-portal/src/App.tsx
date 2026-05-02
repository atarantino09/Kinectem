import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import OverviewPage from "@/pages/OverviewPage";
import GettingStartedPage from "@/pages/GettingStartedPage";
import AuthenticationPage from "@/pages/AuthenticationPage";
import ConventionsPage from "@/pages/ConventionsPage";
import CodeSamplesPage from "@/pages/CodeSamplesPage";
import ChangelogPage from "@/pages/ChangelogPage";
import ApiKeysPage from "@/pages/ApiKeysPage";
import NotFound from "@/pages/not-found";

// Scalar pulls in a large render bundle — keep it off the critical path.
const ApiReferencePage = lazy(() => import("@/pages/ApiReferencePage"));

function ReferenceFallback() {
  return (
    <div className="py-24 text-center text-sm text-[var(--color-fg-subtle)]">
      Loading API reference…
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={OverviewPage} />
      <Route path="/getting-started" component={GettingStartedPage} />
      <Route path="/authentication" component={AuthenticationPage} />
      <Route path="/conventions" component={ConventionsPage} />
      <Route path="/reference">
        <Suspense fallback={<ReferenceFallback />}>
          <ApiReferencePage />
        </Suspense>
      </Route>
      <Route path="/code-samples" component={CodeSamplesPage} />
      <Route path="/api-keys" component={ApiKeysPage} />
      <Route path="/changelog" component={ChangelogPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={base}>
        <Layout>
          <Router />
        </Layout>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
