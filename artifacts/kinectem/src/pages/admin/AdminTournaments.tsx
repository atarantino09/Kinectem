import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Trophy,
  Upload,
  ExternalLink,
  CalendarDays,
  MapPin,
  CheckCircle2,
} from "lucide-react";

// Task #628 follow-up — OPERATOR (platform-admin) screen to create tournaments
// and upload the match-slot schedule CSV. Talks to the admin-gated endpoints
// (POST /tournaments, GET /admin/tournaments, POST /tournaments/:id/import) via
// customFetch — these routes are intentionally not in the locked openapi.yaml.

interface TournamentRow {
  id: string;
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  location: string | null;
  matchCount: number;
  participantCount: number;
  createdAt: string;
}

interface ImportResult {
  ok: boolean;
  tournamentId: string;
  matchesUpserted: number;
  participantCount: number;
}

const CSV_HEADER =
  "match #,date,start time,age,gender,division,bracket,venue,venue state,field,home team,home score,away team,away score";

const SAMPLE = `${CSV_HEADER}
1,2026-07-11,09:00,U12,boys,Gold,A,Riverside Park,CA,Field 2,Thunder FC,2,Lightning SC,1
2,2026-07-11,10:30,U12,boys,Gold,A,Riverside Park,CA,Field 2,Strikers,,Comets,`;

function fmtDate(d: string): string {
  // d is YYYY-MM-DD; render without timezone shifting.
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CreateTournamentCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: () =>
      customFetch<TournamentRow>(`/api/v1/tournaments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          startDate,
          endDate,
          location: location.trim() || null,
          description: description.trim() || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "tournaments"] });
      setName("");
      setStartDate("");
      setEndDate("");
      setLocation("");
      setDescription("");
      toast({ title: "Tournament created" });
    },
    onError: (err) =>
      toast({
        title: "Couldn't create the tournament",
        description:
          err instanceof Error ? err.message : "Check the details and try again.",
        variant: "destructive",
      }),
  });

  const canSubmit =
    name.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDate) &&
    endDate >= startDate;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="w-4 h-4" />
          Create a tournament
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="t-name" className="text-xs font-bold">
              Tournament name
            </Label>
            <Input
              id="t-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Summer Classic 2026"
              maxLength={200}
              data-testid="input-tournament-name"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="t-start" className="text-xs font-bold">
                Start date
              </Label>
              <Input
                id="t-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-tournament-start"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-end" className="text-xs font-bold">
                End date
              </Label>
              <Input
                id="t-end"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="input-tournament-end"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-location" className="text-xs font-bold">
              Location <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="t-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Riverside Sports Complex"
              maxLength={200}
              data-testid="input-tournament-location"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-desc" className="text-xs font-bold">
              Description{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <textarea
              id="t-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Anything coaches should know about this tournament."
              className="w-full rounded-lg border border-border bg-background p-3 text-sm"
              data-testid="input-tournament-description"
            />
          </div>
          {endDate && startDate && endDate < startDate && (
            <p className="text-xs font-bold text-red-700">
              End date must be on or after the start date.
            </p>
          )}
          <Button
            type="submit"
            variant="brand"
            disabled={!canSubmit || create.isPending}
            data-testid="btn-create-tournament"
          >
            {create.isPending ? "Creating…" : "Create tournament"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function UploadScheduleDialog({
  tournament,
  open,
  onOpenChange,
}: {
  tournament: TournamentRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [csv, setCsv] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const importMut = useMutation({
    mutationFn: () =>
      customFetch<ImportResult>(
        `/api/v1/tournaments/${tournament.id}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv }),
        },
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["admin", "tournaments"] });
      toast({
        title: "Schedule uploaded",
        description: `${r.matchesUpserted} matches · ${r.participantCount} teams.`,
      });
      setCsv("");
      onOpenChange(false);
    },
    onError: (err) =>
      toast({
        title: "Upload failed",
        description:
          err instanceof Error ? err.message : "Check the CSV format and try again.",
        variant: "destructive",
      }),
  });

  const onFile = async (file: File) => {
    const text = await file.text();
    setCsv(text);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setCsv("");
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl rounded-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tight">
            Upload schedule
          </DialogTitle>
          <DialogDescription>
            {tournament.name} — paste the match-slot CSV or choose a file.
            Re-uploading is safe: existing matches update in place. Required
            columns:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <code className="block rounded-md bg-muted p-2 text-[11px] leading-relaxed break-words">
            {CSV_HEADER}
          </code>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              CSV data
            </span>
            <div className="flex items-center gap-1">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
                data-testid="input-csv-file"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-full font-bold text-muted-foreground"
                onClick={() => fileRef.current?.click()}
                data-testid="btn-csv-choose-file"
              >
                Choose file
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-full font-bold text-muted-foreground"
                onClick={() => setCsv(SAMPLE)}
                data-testid="btn-csv-sample"
              >
                Insert sample
              </Button>
            </div>
          </div>

          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={CSV_HEADER}
            className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs"
            data-testid="input-csv"
          />
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button
            variant="outline"
            className="font-bold rounded-full"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={() => importMut.mutate()}
            disabled={!csv.trim() || importMut.isPending}
            data-testid="btn-upload-schedule"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            {importMut.isPending ? "Uploading…" : "Upload schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TournamentCard({ t }: { t: TournamentRow }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  return (
    <Card data-testid={`card-tournament-${t.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-black tracking-tight truncate">{t.name}</h3>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3.5 h-3.5" />
                {fmtDate(t.startDate)} – {fmtDate(t.endDate)}
              </span>
              {t.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {t.location}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {t.matchCount > 0 ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {t.matchCount} matches · {t.participantCount} teams
              </Badge>
            ) : (
              <Badge variant="outline">No schedule yet</Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="brand"
            onClick={() => setUploadOpen(true)}
            data-testid={`btn-upload-${t.id}`}
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            {t.matchCount > 0 ? "Replace schedule" : "Upload schedule"}
          </Button>
          <a
            href={`/app/t/${t.slug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              size="sm"
              variant="outline"
              className="font-bold rounded-full"
              data-testid={`btn-view-${t.id}`}
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              View public page
            </Button>
          </a>
        </div>
      </CardContent>
      <UploadScheduleDialog
        tournament={t}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
      />
    </Card>
  );
}

export default function AdminTournaments() {
  const { data, isLoading, isError, refetch } = useQuery<{
    data: TournamentRow[];
  }>({
    queryKey: ["admin", "tournaments"],
    queryFn: () =>
      customFetch<{ data: TournamentRow[] }>(`/api/v1/admin/tournaments`, {
        method: "GET",
      }),
  });

  const tournaments = data?.data ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tournaments</h1>
          <p className="text-sm text-muted-foreground">
            Create a tournament and upload its match schedule. Outside coaches
            sign up and claim slots from the public page.
          </p>
        </div>

        <CreateTournamentCard />

        <div className="space-y-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
            All tournaments
          </h2>
          {isLoading ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                Loading tournaments…
              </CardContent>
            </Card>
          ) : isError ? (
            <Card className="border-destructive/40">
              <CardContent className="p-8 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  Couldn't load tournaments.
                </p>
                <Button
                  variant="outline"
                  className="font-bold rounded-full"
                  onClick={() => refetch()}
                  data-testid="btn-retry-tournaments"
                >
                  Try again
                </Button>
              </CardContent>
            </Card>
          ) : tournaments.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No tournaments yet. Create your first one above.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {tournaments.map((t) => (
                <TournamentCard key={t.id} t={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
