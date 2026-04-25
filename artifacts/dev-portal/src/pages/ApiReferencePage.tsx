import { useEffect, useState } from "react";
import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { PageHeader } from "@/components/PageHeader";

export default function ApiReferencePage() {
  const specUrl = `${import.meta.env.BASE_URL}openapi.yaml`;
  const [available, setAvailable] = useState<"loading" | "ok" | "missing">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        let res = await fetch(specUrl, { method: "HEAD" });
        // Some hosts mishandle HEAD; fall back to a real GET before giving up.
        if (!res.ok) res = await fetch(specUrl, { method: "GET" });
        if (!cancelled) setAvailable(res.ok ? "ok" : "missing");
      } catch {
        try {
          const res = await fetch(specUrl, { method: "GET" });
          if (!cancelled) setAvailable(res.ok ? "ok" : "missing");
        } catch {
          if (!cancelled) setAvailable("missing");
        }
      }
    };
    probe();
    return () => {
      cancelled = true;
    };
  }, [specUrl]);

  return (
    <div>
      <PageHeader
        eyebrow="Reference"
        title="API reference"
        lede={
          <>
            Every endpoint, every schema. Rendered live from{" "}
            <code>lib/api-spec/openapi.yaml</code> — the same spec the server
            validates against.
          </>
        }
      />

      {available === "missing" ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-fg-muted)]">
          <strong>Spec not found.</strong> Could not load{" "}
          <code>{specUrl}</code>. The portal copies the OpenAPI document into
          its <code>public/</code> directory at dev/build start. Try
          re-running the dev server or <code>pnpm --filter @workspace/dev-portal copy-spec</code>.
        </div>
      ) : (
        <div className="-mx-6 sm:-mx-10">
          <div
            className="overflow-hidden rounded-none border-y border-[var(--color-border)] bg-white"
            data-scalar-host
          >
            <ApiReferenceReact
              configuration={{
                url: specUrl,
                hideClientButton: true,
                hideDarkModeToggle: false,
                showSidebar: true,
                layout: "modern",
                theme: "default",
                metaData: {
                  title: "Kinectem API reference",
                },
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
