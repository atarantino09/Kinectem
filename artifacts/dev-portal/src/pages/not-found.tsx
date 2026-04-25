import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export default function NotFound() {
  return (
    <article className="prose-doc">
      <PageHeader
        eyebrow="404"
        title="Page not found"
        lede="The page you were looking for doesn't exist (or has moved). Here's where to go next."
      />

      <ul>
        <li>
          <Link href="/">Overview</Link> — a tour of what's in the portal.
        </li>
        <li>
          <Link href="/getting-started">Getting started</Link> — sign in and
          call your first endpoint.
        </li>
        <li>
          <Link href="/reference">API reference</Link> — every endpoint and
          schema.
        </li>
      </ul>

      <p className="text-sm">
        <Link href="/" className="inline-flex items-center gap-1.5">
          <ArrowLeft size={14} /> Back to overview
        </Link>
      </p>
    </article>
  );
}
