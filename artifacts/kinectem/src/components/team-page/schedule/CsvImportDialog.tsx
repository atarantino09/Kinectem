import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle2, Upload } from "lucide-react";
import {
  importSchedule,
  scheduleQueryKey,
  IMPORT_CSV_HEADER,
  type ImportPreview,
  type ImportResult,
} from "./scheduleApi";

const SAMPLE = `${IMPORT_CSV_HEADER}
game,2026-09-12,10:00,11:30,Eagles,home,Central Park Field 2,123 Park Ave,Bring water
practice,2026-09-14,17:00,18:30,,,Main Gym,,`;

function isPreview(r: ImportPreview | ImportResult): r is ImportPreview {
  return (r as ImportPreview).rows !== undefined;
}

// Coach/admin bulk import. Paste CSV → Preview (server dry-run with per-row
// errors) → Import (server creates all rows, all-or-nothing).
export function CsvImportDialog({
  teamId,
  open,
  onOpenChange,
}: {
  teamId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const reset = () => {
    setCsv("");
    setPreview(null);
  };

  const previewMut = useMutation({
    mutationFn: () => importSchedule(teamId, csv, false),
    onSuccess: (r) => {
      if (isPreview(r)) setPreview(r);
    },
    onError: (err) =>
      toast({
        title: "Couldn't read that CSV",
        description: err instanceof Error ? err.message : "Check the format and try again.",
        variant: "destructive",
      }),
  });

  const importMut = useMutation({
    mutationFn: () => importSchedule(teamId, csv, true),
    onSuccess: (r) => {
      const count = isPreview(r) ? r.validCount : r.createdCount;
      qc.invalidateQueries({ queryKey: scheduleQueryKey(teamId) });
      toast({ title: `Imported ${count} event${count === 1 ? "" : "s"}` });
      reset();
      onOpenChange(false);
    },
    onError: (err) =>
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      }),
  });

  const canImport =
    !!preview && preview.errorCount === 0 && preview.validCount > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl rounded-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tight">
            Import schedule from CSV
          </DialogTitle>
          <DialogDescription>
            Paste rows with this header. Times are in your local timezone. Use{" "}
            <code className="text-xs">event_type</code> of practice, game,
            scrimmage, or tournament.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              CSV data
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full font-bold text-muted-foreground"
              onClick={() => {
                setCsv(SAMPLE);
                setPreview(null);
              }}
              data-testid="btn-csv-sample"
            >
              Insert sample
            </Button>
          </div>
          <textarea
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
            }}
            rows={8}
            spellCheck={false}
            placeholder={IMPORT_CSV_HEADER}
            className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs"
            data-testid="input-csv"
          />

          {preview && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-sm font-bold">
                <span className="flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  {preview.validCount} ready
                </span>
                {preview.errorCount > 0 && (
                  <span className="flex items-center gap-1.5 text-red-700">
                    <AlertCircle className="h-4 w-4" />
                    {preview.errorCount} with errors
                  </span>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="text-muted-foreground">
                      <th className="px-2 py-1.5 font-black">#</th>
                      <th className="px-2 py-1.5 font-black">Type</th>
                      <th className="px-2 py-1.5 font-black">Date</th>
                      <th className="px-2 py-1.5 font-black">Time</th>
                      <th className="px-2 py-1.5 font-black">Opponent</th>
                      <th className="px-2 py-1.5 font-black">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr
                        key={r.line}
                        className={`border-t border-border ${r.error ? "bg-red-50" : ""}`}
                        data-testid={`row-import-${r.line}`}
                      >
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {r.line}
                        </td>
                        <td className="px-2 py-1.5">{r.eventType}</td>
                        <td className="px-2 py-1.5">{r.date}</td>
                        <td className="px-2 py-1.5">
                          {r.startTime}
                          {r.endTime ? `–${r.endTime}` : ""}
                        </td>
                        <td className="px-2 py-1.5 truncate max-w-[8rem]">
                          {r.opponent}
                        </td>
                        <td className="px-2 py-1.5">
                          {r.error ? (
                            <span className="text-red-700">{r.error}</span>
                          ) : (
                            <span className="text-emerald-700">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button
            variant="outline"
            className="font-bold rounded-full"
            onClick={() => previewMut.mutate()}
            disabled={!csv.trim() || previewMut.isPending}
            data-testid="btn-csv-preview"
          >
            {previewMut.isPending ? "Checking…" : "Preview"}
          </Button>
          <Button
            variant="brand"
            onClick={() => importMut.mutate()}
            disabled={!canImport || importMut.isPending}
            data-testid="btn-csv-import"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            {importMut.isPending
              ? "Importing…"
              : preview
                ? `Import ${preview.validCount} event${preview.validCount === 1 ? "" : "s"}`
                : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
