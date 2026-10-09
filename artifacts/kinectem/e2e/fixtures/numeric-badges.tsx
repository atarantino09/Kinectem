// Test-only entry point: real controls, controlled data, no writes to the DB.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import "../../src/index.css";
import { Layout } from "../../src/components/Layout";
import { PostCard } from "../../src/components/PostCard";
import MessagesPage from "../../src/pages/MessagesPage";
import { SignUpForm } from "../../src/components/login-page/SignUpForm";
import { NumericBadge } from "../../src/components/ui/numeric-badge";
import { Badge } from "../../src/components/ui/badge";
import { likerPost } from "./post-liker";

const params = new URLSearchParams(window.location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Router base="/app">
      <Layout>
        <section className="flex flex-wrap items-center gap-3 mb-5" data-testid="numeric-samples">
          {[1, 8, 12, "9+", "99+", 12345].map((count) => (
            <NumericBadge key={count} size={14} className="bg-primary text-primary-foreground text-[9px] font-bold" data-testid={`sample-${count}`}>{count}</NumericBadge>
          ))}
          <Badge data-testid="status-control" variant="secondary">Pending approval</Badge>
        </section>
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 8, 12, 100].map((count) => (
            <PostCard key={count} post={{ ...likerPost({ id: `article-count-${count}` }), albumPhotoCount: count }} />
          ))}
        </div>
        <section className="mt-6" data-testid="message-counts"><MessagesPage /></section>
        <section className="mt-6 max-w-lg rounded-xl bg-card p-4" data-testid="signup-counts">
          <SignUpForm returnTo={null} onSwitchSignin={() => {}} onError={() => {}} onPending={() => {}} />
        </section>
      </Layout>
    </Router>
  </QueryClientProvider>,
);
