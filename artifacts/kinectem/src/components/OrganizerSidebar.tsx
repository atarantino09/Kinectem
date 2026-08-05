import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trophy,
} from "lucide-react";

// Task #745 — collapsible organizer sidebar shared by the Competitions page,
// the competition console, and the in-app hub page. Lists only the hubs and
// competitions the viewer owns or administers (from the membership-aware
// /my/* endpoints — NOT followed items). Starts as a slim rail, expands
// horizontally; on mobile the expanded panel overlays the content instead of
// squeezing it. customFetch — routes are outside the locked openapi.yaml.

export interface SidebarOrganizerRow {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  competitionCount: number;
  accessRole: "owner" | "admin";
}

export interface SidebarCompetitionRow {
  id: string;
  slug: string;
  name: string;
  type: "tournament" | "league";
  organizerId: string | null;
  accessRole: "owner" | "admin";
}

const STORAGE_KEY = "kinectem.organizerSidebar.expanded";

function readStoredExpanded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// Dialog form for creating a new hub — moved here from the old
// "Competition hub" card on the Competitions page (Task #745 cleanup).
export function NewHubDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // When provided, called with the new hub instead of navigating to its
  // page — e.g. the create-competition wizard selects it in place.
  onCreated?: (row: SidebarOrganizerRow) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: () =>
      customFetch<SidebarOrganizerRow>(`/api/v1/organizers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["my", "organizers"] });
      toast({ title: "Competition hub created" });
      onOpenChange(false);
      setName("");
      setDescription("");
      if (onCreated) {
        onCreated(row);
      } else {
        navigate(`/competitions/o/${row.slug}`);
      }
    },
    onError: (err) =>
      toast({
        title: "Couldn't create the hub",
        description:
          err instanceof Error ? err.message : "Check the details and try again.",
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && !create.isPending) create.mutate();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>New competition hub</DialogTitle>
            <DialogDescription>
              A home base for your company — group all your competitions under
              one brand with a shareable public page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="sidebar-hub-name" className="text-xs font-bold">
              Company name
            </Label>
            <Input
              id="sidebar-hub-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Apex Events Co"
              maxLength={200}
              data-testid="input-organizer-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sidebar-hub-desc" className="text-xs font-bold">
              About <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="sidebar-hub-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What your company runs and where."
              maxLength={2000}
              data-testid="input-organizer-description"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              data-testid="btn-cancel-organizer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="brand"
              disabled={!name.trim() || create.isPending}
              data-testid="btn-create-organizer"
            >
              {create.isPending ? "Creating…" : "Create hub"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HubIcon({ hub }: { hub: SidebarOrganizerRow }) {
  return hub.logoUrl ? (
    <img
      src={hub.logoUrl}
      alt=""
      className="h-6 w-6 rounded-md object-contain bg-white shrink-0"
    />
  ) : (
    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
  );
}

export function OrganizerSidebar({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(readStoredExpanded);
  const [newHubOpen, setNewHubOpen] = useState(false);
  const [location] = useLocation();

  // Auto-open the "New competition hub" dialog when we arrive with
  // `?newHub=1` (e.g. straight after a "Competition Organizer" signup).
  // Strip the param afterward so a refresh doesn't re-trigger it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("newHub") === "1") {
      setNewHubOpen(true);
      params.delete("newHub");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : ""),
      );
    }
  }, []);

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // localStorage unavailable — state still toggles for this visit.
      }
      return next;
    });
  };

  const organizersQ = useQuery<{ data: SidebarOrganizerRow[] }>({
    queryKey: ["my", "organizers"],
    queryFn: () =>
      customFetch<{ data: SidebarOrganizerRow[] }>(`/api/v1/my/organizers`, {
        method: "GET",
      }),
  });
  const competitionsQ = useQuery<{ data: SidebarCompetitionRow[] }>({
    queryKey: ["my", "competitions"],
    queryFn: () =>
      customFetch<{ data: SidebarCompetitionRow[] }>(
        `/api/v1/my/competitions`,
        { method: "GET" },
      ),
  });
  const hubs = organizersQ.data?.data ?? [];
  const comps = competitionsQ.data?.data ?? [];

  const isCurrentHub = (h: SidebarOrganizerRow) =>
    location === `/competitions/o/${h.slug}`;
  // Names link to the PUBLIC competition page; the console is reached via
  // its "Edit competition" button. Highlight the row on either page.
  const isCurrentComp = (c: SidebarCompetitionRow) =>
    location === `/competitions/c/${c.slug}` ||
    location === `/competitions/${c.id}`;

  return (
    <div className="flex gap-3 sm:gap-5">
      <aside
        className={`relative shrink-0 transition-[width] duration-200 ${
          expanded ? "w-10 md:w-60" : "w-10"
        }`}
        data-testid="organizer-sidebar"
      >
        <div className="sticky top-20">
          {expanded ? (
            <div className="absolute left-0 top-0 z-30 w-60 rounded-xl border border-border bg-background shadow-xl md:static md:shadow-none">
              <div className="flex items-center justify-between px-3 pt-3">
                <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                  Organizer
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={toggle}
                  aria-label="Collapse sidebar"
                  data-testid="btn-sidebar-collapse"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-2 space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between px-1.5">
                    <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                      Your hubs
                    </p>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setNewHubOpen(true)}
                      aria-label="New competition hub"
                      title="New competition hub"
                      data-testid="btn-new-organizer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {hubs.length === 0 ? (
                    <p className="px-1.5 py-1 text-xs text-muted-foreground">
                      No hubs yet.
                    </p>
                  ) : (
                    hubs.map((h) => (
                      <Link key={h.id} href={`/competitions/o/${h.slug}`}>
                        <span
                          className={`flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm cursor-pointer ${
                            isCurrentHub(h)
                              ? "bg-accent font-black"
                              : "hover:bg-accent/60 font-bold"
                          }`}
                          data-testid={`sidebar-hub-${h.id}`}
                        >
                          <HubIcon hub={h} />
                          <span className="min-w-0 flex-1 truncate">
                            {h.name}
                          </span>
                          {h.accessRole === "admin" ? (
                            <Badge
                              variant="secondary"
                              className="shrink-0 text-[9px] px-1 py-0"
                            >
                              Admin
                            </Badge>
                          ) : null}
                        </span>
                      </Link>
                    ))
                  )}
                </div>
                <div className="space-y-1">
                  <p className="px-1.5 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                    Your competitions
                  </p>
                  {comps.length === 0 ? (
                    <p className="px-1.5 py-1 text-xs text-muted-foreground">
                      No competitions yet.
                    </p>
                  ) : (
                    comps.map((c) => (
                      <Link key={c.id} href={`/competitions/c/${c.slug}`}>
                        <span
                          className={`flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm cursor-pointer ${
                            isCurrentComp(c)
                              ? "bg-accent font-black"
                              : "hover:bg-accent/60 font-bold"
                          }`}
                          data-testid={`sidebar-competition-${c.id}`}
                        >
                          <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">
                            {c.name}
                          </span>
                          {c.accessRole === "admin" ? (
                            <Badge
                              variant="secondary"
                              className="shrink-0 text-[9px] px-1 py-0"
                            >
                              Admin
                            </Badge>
                          ) : null}
                        </span>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex w-10 flex-col items-center gap-1 rounded-xl border border-border bg-background py-2">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={toggle}
                aria-label="Expand sidebar"
                data-testid="btn-sidebar-expand"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
              {hubs.length > 0 || comps.length > 0 ? (
                <div className="my-1 h-px w-6 bg-border" />
              ) : null}
              {hubs.map((h) => (
                <Link key={h.id} href={`/competitions/o/${h.slug}`}>
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg cursor-pointer ${
                      isCurrentHub(h) ? "bg-accent" : "hover:bg-accent/60"
                    }`}
                    title={h.name}
                    data-testid={`sidebar-rail-hub-${h.id}`}
                  >
                    <HubIcon hub={h} />
                  </span>
                </Link>
              ))}
              {comps.map((c) => (
                <Link key={c.id} href={`/competitions/c/${c.slug}`}>
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg cursor-pointer ${
                      isCurrentComp(c) ? "bg-accent" : "hover:bg-accent/60"
                    }`}
                    title={c.name}
                    data-testid={`sidebar-rail-competition-${c.id}`}
                  >
                    <Trophy className="h-4 w-4 text-muted-foreground" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
      <NewHubDialog open={newHubOpen} onOpenChange={setNewHubOpen} />
    </div>
  );
}
