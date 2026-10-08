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
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setKind("csv");
    setText("");
    const problem = csvFileProblem(f);
    setFileError(problem);
    if (problem) return;
    setReadingFile(true);
    try {
      const contents = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Couldn't read this file. Please choose it again."));
        reader.readAsText(f);
      });
      setText(contents);
    } catch {
      setFileError("Couldn't read this file. Please choose it again.");
    } finally {
      setReadingFile(false);
    }
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
        <CardTitle className="text-base">1. Add tournament or league results</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Results source">
          {(["url", "csv", "paste"] as const).map((k) => (
            <Button
              key={k}
              type="button"
              size="sm"
              role="tab"
              aria-selected={kind === k}
              disabled={m.isPending || readingFile}
              variant={kind === k ? "brand" : "outline"}
              className="rounded-full font-bold capitalize"
              onClick={() => {
                setKind(k);
                if (k === "csv") fileInput.current?.click();
              }}
              data-testid={`tab-import-${k}`}
            >
              {k === "url" ? "Results URL" : k === "csv" ? "CSV results" : "Paste results"}
            </Button>
          ))}
        </div>
        {kind === "url" ? (
          <div className="space-y-1.5">
            <label htmlFor={`results-url-${cid}`} className="text-sm font-bold">Results page URL</label>
            <Input
              id={`results-url-${cid}`}
              value={url}
              disabled={m.isPending || readingFile}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste the tournament or league results URL"
              data-testid="input-import-url"
            />
          </div>
        ) : (
          <textarea
            value={text}
            aria-label={kind === "csv" ? "Results CSV text" : "Pasted results"}
            disabled={m.isPending || readingFile}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={kind === "csv" ? CSV_EXAMPLE : "Paste results from any page"}
            className="w-full rounded-lg border border-border bg-background p-3 text-sm font-mono"
            data-testid="input-import-text"
          />
        )}
          <div className="space-y-1.5 rounded-lg border border-border p-3 text-xs">
            <label htmlFor={`results-file-${cid}`} className="block text-sm font-bold">Or upload results (.csv)</label>
            <p className="text-muted-foreground" data-testid="text-csv-example">
              Header: <code>Bracket,Home Team,Away Team,Home Score,Away Score</code>. Upload a .csv (500 KB max) or
              use the CSV results tab to paste CSV text.
            </p>
            <input
              ref={fileInput}
              type="file"
              id={`results-file-${cid}`}
              disabled={m.isPending || readingFile}
              className="block w-full min-w-0"
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
        <Button
          variant="brand"
          disabled={!ok || m.isPending || readingFile}
          onClick={() => m.mutate()}
          data-testid="btn-run-import"
        >
          {m.isPending ? "Reading results…" : "Read results"}
        </Button>
      </CardContent>
    </Card>
  );
}
