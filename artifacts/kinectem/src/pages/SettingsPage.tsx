import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Bell, Users, CalendarClock, Sparkles, PauseCircle } from "lucide-react";

// Task #633 — user-facing Settings page. Today it hosts only the
// Notifications section (per-type email toggles + a master pause). It is
// structured so a future Privacy section (Task #14) can slot in as another
// <section> without reworking this shell.

// Wire shape from GET/PUT /api/v1/notifications/preferences
// (serializePreferences in the api-server). Keys are the toggleable email
// categories plus the master `pauseAll`.
interface NotificationPrefs {
  socialFollow: boolean;
  socialComment: boolean;
  socialReaction: boolean;
  socialTag: boolean;
  teamRecap: boolean;
  teamRoster: boolean;
  teamBroadcast: boolean;
  reminderSchedule: boolean;
  reminderGameRecap: boolean;
  digestWeekly: boolean;
  motivational: boolean;
  pauseAll: boolean;
}

type PrefKey = keyof NotificationPrefs;

const PREFS_QUERY_KEY = ["notification-preferences"] as const;

interface ToggleDef {
  key: Exclude<PrefKey, "pauseAll">;
  label: string;
  description: string;
}

interface ToggleGroup {
  title: string;
  icon: typeof Bell;
  toggles: ToggleDef[];
}

const GROUPS: ToggleGroup[] = [
  {
    title: "Social",
    icon: Bell,
    toggles: [
      {
        key: "socialFollow",
        label: "New followers",
        description: "When someone follows you or requests to.",
      },
      {
        key: "socialComment",
        label: "Comments",
        description: "When someone comments on your posts.",
      },
      {
        key: "socialReaction",
        label: "Likes & reactions",
        description: "When someone reacts to your posts.",
      },
      {
        key: "socialTag",
        label: "Tags & mentions",
        description: "When you're tagged in a recap, highlight, or photo.",
      },
    ],
  },
  {
    title: "Team updates",
    icon: Users,
    toggles: [
      {
        key: "teamRecap",
        label: "New recaps & posts",
        description: "When a team you follow posts a recap or highlight.",
      },
      {
        key: "teamRoster",
        label: "Roster changes",
        description: "When you're added to a team or your role changes.",
      },
      {
        key: "teamBroadcast",
        label: "Announcements",
        description: "Announcements from your organizations and teams.",
      },
    ],
  },
  {
    title: "Reminders",
    icon: CalendarClock,
    toggles: [
      {
        key: "reminderSchedule",
        label: "Schedule reminders",
        description: "Upcoming games and schedule changes.",
      },
      {
        key: "reminderGameRecap",
        label: "Game-recap nudges",
        description: "A reminder to write up a recap after a game.",
      },
    ],
  },
  {
    title: "Digests & updates",
    icon: Sparkles,
    toggles: [
      {
        key: "digestWeekly",
        label: "Weekly digest",
        description: "A weekly summary of activity from teams you follow.",
      },
      {
        key: "motivational",
        label: "Tips & encouragement",
        description: "Occasional welcome, milestone, and 'we miss you' emails.",
      },
    ],
  },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<NotificationPrefs>({
    queryKey: PREFS_QUERY_KEY,
    queryFn: () =>
      customFetch<NotificationPrefs>("/api/v1/notifications/preferences", {
        method: "GET",
      }),
    staleTime: 30_000,
  });

  // Persist a single key. Optimistically updates the cached prefs, reverts on
  // failure. Every gated email also carries a no-login unsubscribe link, so
  // this page and those links manipulate the same underlying preferences.
  //
  // All cache writes touch only this one key (functional updates) so two
  // rapid toggles on different switches don't clobber each other — a failed
  // request reverts just its own key and leaves any concurrent change intact.
  const save = async (key: PrefKey, value: boolean) => {
    const before = qc.getQueryData<NotificationPrefs>(PREFS_QUERY_KEY);
    const prevValue = before?.[key];
    qc.setQueryData<NotificationPrefs>(PREFS_QUERY_KEY, (cur) =>
      cur ? { ...cur, [key]: value } : cur,
    );
    try {
      const updated = await customFetch<NotificationPrefs>(
        "/api/v1/notifications/preferences",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        },
      );
      // Trust the server's value for just this key; keep other concurrent edits.
      qc.setQueryData<NotificationPrefs>(PREFS_QUERY_KEY, (cur) =>
        cur ? { ...cur, [key]: updated[key] } : updated,
      );
    } catch {
      if (prevValue !== undefined) {
        qc.setQueryData<NotificationPrefs>(PREFS_QUERY_KEY, (cur) =>
          cur ? { ...cur, [key]: prevValue } : cur,
        );
      }
      toast({
        title: "Couldn't update notification settings",
        variant: "destructive",
      });
    }
  };

  const paused = data?.pauseAll === true;

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your email notifications.
        </p>
      </div>

      <section className="space-y-4" data-testid="section-notifications">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <h2 className="font-black tracking-tight">Email notifications</h2>
        </div>

        {isLoading || !data ? (
          <div className="space-y-3">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : (
          <>
            {/* Master pause */}
            <Card className="rounded-xl border-border">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <PauseCircle className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">
                      Pause all non-essential emails
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Turns off every email below at once. Essential account
                      emails (security, password reset, guardian consent) are
                      always sent.
                    </p>
                  </div>
                  <Switch
                    checked={paused}
                    onCheckedChange={(v) => save("pauseAll", v)}
                    data-testid="switch-pause-all"
                  />
                </div>
              </CardContent>
            </Card>

            {GROUPS.map((group) => {
              const Icon = group.icon;
              return (
                <Card
                  key={group.title}
                  className={`rounded-xl border-border transition-opacity ${
                    paused ? "opacity-60" : ""
                  }`}
                >
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      <h3 className="font-bold text-sm">{group.title}</h3>
                    </div>
                    <div className="space-y-2">
                      {group.toggles.map((t) => (
                        <div
                          key={t.key}
                          className="flex items-start gap-3 p-3 rounded-lg border border-border"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm">{t.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {t.description}
                            </p>
                          </div>
                          <Switch
                            checked={data[t.key] === true}
                            disabled={paused}
                            onCheckedChange={(v) => save(t.key, v)}
                            data-testid={`switch-${t.key}`}
                          />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            <p className="text-xs text-muted-foreground">
              You'll always see these as in-app notifications regardless of your
              email settings.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
