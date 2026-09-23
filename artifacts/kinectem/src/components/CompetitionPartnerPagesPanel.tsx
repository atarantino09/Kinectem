import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useWhoami } from "@/hooks/useWhoami";
import {
  ChevronDown,
  ExternalLink,
  Handshake,
  Link2,
  Search,
  Unlink,
} from "lucide-react";

export type CompetitionPartnerAdminPage = {
  id: string;
  slug: string;
  officialName: string;
  associationLabel: string;
  logoUrl: string | null;
  published: boolean;
  linked: boolean;
};

export function CompetitionPartnerPagesPanel({
  competitionId,
}: {
  competitionId: string;
}) {
  const { data: whoami } = useWhoami();
  const isPlatformAdmin =
    whoami?.realUser?.role === "admin" && whoami.isMasquerading !== true;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [unlinkPage, setUnlinkPage] =
    useState<CompetitionPartnerAdminPage | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const queryKey = ["admin", "competition-partner-pages", competitionId];

  const pages = useQuery<{ data: CompetitionPartnerAdminPage[] }>({
    queryKey,
    queryFn: () =>
      customFetch(`/api/v1/admin/competitions/${competitionId}/partner-pages`, {
        method: "GET",
      }),
    enabled: isPlatformAdmin,
  });

  const mutation = useMutation({
    mutationFn: ({
      page,
      link,
    }: {
      page: CompetitionPartnerAdminPage;
      link: boolean;
    }) =>
      customFetch(
        `/api/v1/admin/competitions/${competitionId}/partner-pages/${page.id}`,
        { method: link ? "PUT" : "DELETE" },
      ),
    onSuccess: async (_result, variables) => {
      setUnlinkPage(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey }),
        qc.invalidateQueries({ queryKey: ["competition"] }),
        qc.invalidateQueries({ queryKey: ["partner-page"] }),
        qc.invalidateQueries({ queryKey: ["admin", "partner-pages"] }),
      ]);
      toast({
        title: variables.link
          ? "Partnership connected"
          : "Partnership disconnected",
        description: variables.link
          ? `${variables.page.officialName} will appear on the public competition page when published.`
          : `${variables.page.officialName} was removed from this competition.`,
      });
    },
    onError: (error) =>
      toast({
        title: "Couldn't update the partnership",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      }),
  });

  const filtered = useMemo(() => {
    const value = search.trim().toLocaleLowerCase();
    return [...(pages.data?.data ?? [])]
      .filter(
        (page) =>
          !value ||
          `${page.officialName} ${page.associationLabel} ${page.slug}`
            .toLocaleLowerCase()
            .includes(value),
      )
      .sort(
        (a, b) =>
          Number(b.linked) - Number(a.linked) ||
          a.officialName.localeCompare(b.officialName),
      );
  }, [pages.data, search]);
  const linkedCount = (pages.data?.data ?? []).filter(
    (page) => page.linked,
  ).length;

  if (!isPlatformAdmin) return null;

  return (
    <Card data-testid="competition-partnerships-panel">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <button
            type="button"
            className="flex min-w-0 items-center gap-2"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            data-testid="btn-toggle-partnerships"
          >
            <Handshake className="h-4 w-4" />
            Partnership pages
            {linkedCount ? <Badge>{linkedCount} connected</Badge> : null}
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
        </CardTitle>
      </CardHeader>
      {open ? (
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">
              Connect published partnership directories to the public
              competition page. Unpublished pages stay connected but hidden
              from visitors.
            </p>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search partnership pages"
                aria-label="Search partnership pages"
                className="pl-9"
              />
            </div>
          </div>

          {pages.isLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading partnership pages…
            </p>
          ) : pages.isError ? (
            <p className="text-sm text-destructive" role="alert">
              Partnership pages could not be loaded.
            </p>
          ) : filtered.length ? (
            <div className="space-y-2">
              {filtered.map((page) => (
                <div
                  key={page.id}
                  className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center"
                  data-testid={`competition-partner-page-${page.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-bold">{page.officialName}</p>
                      {page.linked ? (
                        <Badge variant="secondary">Connected</Badge>
                      ) : null}
                      {!page.published ? (
                        <Badge
                          variant="outline"
                          className="border-amber-300 bg-amber-50 text-amber-800"
                        >
                          Unpublished · hidden publicly
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {page.associationLabel} · /partners/{page.slug}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      aria-label={`View ${page.officialName}`}
                    >
                      <Link href={`/partners/${page.slug}`}>
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                    {page.linked ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setUnlinkPage(page)}
                        disabled={mutation.isPending}
                      >
                        <Unlink className="mr-1.5 h-3.5 w-3.5" />
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => mutation.mutate({ page, link: true })}
                        disabled={mutation.isPending}
                      >
                        <Link2 className="mr-1.5 h-3.5 w-3.5" />
                        Connect
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No partnership pages match that search.
            </p>
          )}
        </CardContent>
      ) : null}

      <AlertDialog
        open={!!unlinkPage}
        onOpenChange={(value) => {
          if (!value) setUnlinkPage(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect this partnership?</AlertDialogTitle>
            <AlertDialogDescription>
              {unlinkPage?.officialName} and its club directory will stop
              appearing on this public competition page. The partnership page
              itself will not be changed or deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (unlinkPage) {
                  mutation.mutate({ page: unlinkPage, link: false });
                }
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}