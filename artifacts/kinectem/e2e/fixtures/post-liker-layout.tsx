// Test-only entry point, served by Vite during development. It mounts the actual
// renderers with controlled data; the browser spec intercepts API requests.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { PostCard } from "../../src/components/PostCard";
import { PostInteractions } from "../../src/components/PostInteractions";
import { likerPost } from "./post-liker";
import "../../src/index.css";

const params = new URLSearchParams(window.location.search);
const name = params.has("name") ? params.get("name") : "Alex Supporter";
const post = likerPost({
  recentReactorName: name,
  reactionCount: Number(params.get("count") ?? 4),
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Router base="/app">
      <main style={{ width: "100%", maxWidth: 760, margin: "auto", padding: 16, boxSizing: "border-box" }}>
        <section data-testid="card-renderer"><PostCard post={post} /></section>
        <section data-testid="detail-renderer" style={{ marginTop: 24 }}>
          <PostInteractions post={post} />
        </section>
      </main>
    </Router>
  </QueryClientProvider>,
);
