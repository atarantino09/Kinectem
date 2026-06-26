import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useWhoami } from "@/hooks/useWhoami";
import { X, Info, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Level = "info" | "warning" | "success";

type ActiveAnnouncement = {
  id: string;
  title: string;
  body: string;
  level: Level;
};

const DISMISS_PREFIX = "kinectem.announcement.dismissed.";

const LEVEL_STYLES: Record<Level, string> = {
  info: "bg-blue-600 text-white",
  warning: "bg-amber-500 text-white",
  success: "bg-emerald-600 text-white",
};

const LEVEL_ICON: Record<Level, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle2,
};

export function AnnouncementBanner() {
  const { data: whoami } = useWhoami();
  const authed = !!whoami?.authenticated;
  // Scope dismissals by the acting user so a shared browser doesn't hide a
  // banner for the next person who signs in.
  const userId = whoami?.realUser?.id ?? null;

  const { data } = useQuery<{ data: ActiveAnnouncement[] }>({
    queryKey: ["announcements", "active"],
    queryFn: () =>
      customFetch<{ data: ActiveAnnouncement[] }>(
        `/api/v1/announcements/active`,
        { method: "GET" },
      ),
    enabled: authed,
    staleTime: 60_000,
  });

  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof window === "undefined" || !userId) {
      setDismissed({});
      return;
    }
    const prefix = `${DISMISS_PREFIX}${userId}.`;
    const seen: Record<string, boolean> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(prefix)) {
        seen[k.slice(prefix.length)] = true;
      }
    }
    setDismissed(seen);
  }, [userId]);

  if (!authed || !userId) return null;

  const visible = (data?.data ?? []).filter((a) => !dismissed[a.id]);
  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    try {
      window.localStorage.setItem(`${DISMISS_PREFIX}${userId}.${id}`, "1");
    } catch {
      // ignore storage failures (private mode, quota) — banner just reappears.
    }
    setDismissed((prev) => ({ ...prev, [id]: true }));
  };

  return (
    <div data-testid="announcement-banner">
      {visible.map((a) => {
        const Icon = LEVEL_ICON[a.level];
        return (
          <div
            key={a.id}
            className={cn(
              "flex items-start gap-3 px-4 py-2.5 text-sm",
              LEVEL_STYLES[a.level],
            )}
            data-testid={`announcement-banner-${a.id}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="font-semibold">{a.title}</span>
              {a.body && <span className="ml-2 opacity-90">{a.body}</span>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              className="shrink-0 rounded p-0.5 opacity-80 hover:opacity-100"
              aria-label="Dismiss announcement"
              data-testid={`dismiss-announcement-${a.id}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
