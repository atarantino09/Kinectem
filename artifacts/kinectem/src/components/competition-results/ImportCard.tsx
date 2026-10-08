import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { CSV_EXAMPLE, api, csvFileProblem, uuid, useInvalidateResults, type Snapshot } from "@/lib/competition-results";
import { errMsg } from "./ResultsUiHelpers";

export function ImportCard({ cid, onImported }: { cid: string; onImported: (s: Snapshot) => void }) {
  const [kind, setKind] = useState<"url" | "csv" | "paste">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const clientId = useRef(uuid());
  const [fileError, setFileError] = useState<string | null>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const problem = csvFileProblem(f);
    setFileError(problem);
    if (problem) return;
    setText(await f.text());
  };
  const invalidate = useInvalidateResults(cid);
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () =>
      api.importResults(cid, {
        kind,
        clientId: clientId.current,
        ...(kind === "url" ? { url: url.trim() } : { text }),
      }),
    onSuccess: (s) => {
      clientId.current = uuid();
      invalidate();
      onImported(s);
    },
    onError: (e) => toast({ title: "Import failed", description: errMsg(e), variant: "destructive" }),
  });
  const ok = kind === "url" ? /^https?:\/\//i.test(url.trim()) : text.trim().length > 0;
  return (
    <Card data-testid="card-results-import">
      <CardHeader>
        <CardTitle className="text-base">1. Import results</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2" role="tablist">
          {(["url", "csv", "paste"] as const).map((k) => (
            <Button
              key={k}
              type="button"
              size="sm"
              role="tab"
              aria-selected={kind === k}
              variant={kind === k ? "brand" : "outline"}
              className="rounded-full font-bold capitalize"
              onClick={() => setKind(k)}
              data-testid={`tab-import-${k}`}
            >
              {k === "url" ? "Results URL" : k === "csv" ? "CSV text" : "Paste"}
            </Button>
          ))}
        </div>
        {kind === "url" ? (
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://results.example.com/tournament"
            data-testid="input-import-url"
          />
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={kind === "csv" ? CSV_EXAMPLE : "Paste results from any page"}
            className="w-full rounded-lg border border-border bg-background p-3 text-sm font-mono"
            data-testid="input-import-text"
          />
        )}
        {kind === "csv" ? (
          <div className="space-y-1 text-xs">
            <p className="text-muted-foreground" data-testid="text-csv-example">
              Header: <code>Bracket,Home Team,Away Team,Home Score,Away Score</code>. Upload a .csv (500 KB max) or
              paste the text above.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onFile(e.target.files?.[0])}
              data-testid="input-import-file"
            />
            {fileError ? (
              <p className="font-bold text-destructive" data-testid="text-file-error">
                {fileError}
              </p>
            ) : null}
          </div>
        ) : null}
        <Button
          variant="brand"
          disabled={!ok || m.isPending}
          onClick={() => m.mutate()}
          data-testid="btn-run-import"
        >
          {m.isPending ? "Reading results…" : "Read results"}
        </Button>
      </CardContent>
    </Card>
  );
}
