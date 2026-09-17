import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  Eye,
  Mail,
  Monitor,
  Moon,
  ShieldCheck,
  Smartphone,
  Sun,
  UserPlus,
} from "lucide-react";
import {
  emailButton,
  emailCallout,
  emailChecklist,
  emailKeyValue,
  emailStatusCallout,
  emailSummary,
  renderBrandedEmailHtml,
} from "@workspace/email-template";
import {
  buildStaffInviteHtml,
  staffInviteSubject,
} from "@workspace/invite-copy";
import { AdminLayout } from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type PreviewViewport = "desktop" | "mobile";
type PreviewTheme = "light" | "dark";
type TemplateId =
  | "coach_invite"
  | "partner_claim"
  | "owner_approval"
  | "schedule_change";

const TEMPLATES: Record<
  TemplateId,
  {
    label: string;
    description: string;
    icon: React.ElementType;
    details: { label: string; value: string }[];
    getHtml: (baseUrl: string) => string;
  }
> = {
  coach_invite: {
    label: "Coach invitation",
    description: "Sent to new staff members.",
    icon: UserPlus,
    details: [
      { label: "Invited as", value: "Coach" },
      { label: "Team", value: "Varsity Football" },
      { label: "From", value: "Coach Mike Davis" },
    ],
    getHtml: (baseUrl) => {
      const inviteLink = `${baseUrl}/invites/preview-coach-invite`;
      const subject = staffInviteSubject("Varsity Football");
      return renderBrandedEmailHtml({
        subject,
        contextLabel: "Varsity Football",
        bodyHtml: buildStaffInviteHtml({
          inviterName: "Coach Mike Davis",
          teamName: "Varsity Football",
          roleLabel: "Coach",
          link: inviteLink,
        }),
        baseUrl,
      });
    },
  },
  partner_claim: {
    label: "Partner claim",
    description: "Operator review for a club claim.",
    icon: Building2,
    details: [
      { label: "Organization", value: "West Point" },
      { label: "Requester", value: "Andrew Tarantino" },
      { label: "Partner page", value: "Eastern NY Youth Soccer" },
    ],
    getHtml: (baseUrl) => {
      const bodyHtml = `
${emailSummary("A partner-page visitor is requesting ownership of the West Point club page.")}
${emailKeyValue([
  { label: "Organization", value: "West Point" },
  { label: "Submitted name", value: "West Point" },
  { label: "Requester", value: "Andrew Tarantino" },
  { label: "Title", value: "President" },
  { label: "Account email", value: "atarantino@kinectem.com" },
  { label: "Partner page", value: "Eastern NY Youth Soccer (enysoccer)" },
  { label: "Submitted", value: "September 17, 2026 at 6:53 PM" },
])}
${emailStatusCallout("info", "Verify the requester is authorized to represent this club before approving ownership.")}
${emailButton({ href: `${baseUrl}/admin/moderation?tab=org-claims`, label: "Review claim request" })}
`;
      return renderBrandedEmailHtml({
        subject: "Partner club claim request: West Point",
        contextLabel: "West Point",
        bodyHtml,
        baseUrl,
      });
    },
  },
  owner_approval: {
    label: "Owner approval",
    description: "Request to claim team ownership.",
    icon: ShieldCheck,
    details: [
      { label: "Requester", value: "David Chen" },
      { label: "Team", value: "U14 Lightning" },
      { label: "Requested role", value: "Owner" },
    ],
    getHtml: (baseUrl) => {
      const bodyHtml = `
${emailSummary("David Chen is requesting ownership access to the U14 Lightning team page.")}
<p style="margin: 0 0 16px;">As the current administrator of this team, you need to approve or deny this request. Granting ownership will allow David to manage the roster, update the schedule, and assign coaches.</p>
${emailKeyValue([
  { label: "Requester", value: "David Chen" },
  { label: "Current role", value: "Parent" },
  { label: "Requested role", value: "Owner" },
])}
${emailCallout(`<strong>Note:</strong> Ownership should only be granted to verified coaches or club staff.`)}
${emailButton({ href: `${baseUrl}/team/approve-preview`, label: "Review Request" })}
`;
      return renderBrandedEmailHtml({
        subject: "Ownership Request: U14 Lightning",
        contextLabel: "Action Required",
        bodyHtml,
        baseUrl,
      });
    },
  },
  schedule_change: {
    label: "Schedule change",
    description: "Alert for updated game details.",
    icon: CalendarClock,
    details: [
      { label: "Team", value: "U14 Lightning" },
      { label: "Opponent", value: "Wildcats" },
    ],
    getHtml: (baseUrl) => {
      const bodyHtml = `
${emailSummary("The upcoming game against the Wildcats has been rescheduled.")}
${emailStatusCallout("warning", "The time and location for this weekend's match have changed due to weather conditions.")}
${emailKeyValue([
  { label: "Old Time", value: "Saturday, 10:00 AM at North Park" },
  { label: "New Time", value: "Sunday, 2:00 PM at South High School Turf" },
  { label: "Opponent", value: "Wildcats" },
])}
<p style="margin: 0 0 16px;">Please arrive 30 minutes early for warmups. Make sure your player brings both home and away jerseys.</p>
${emailChecklist(["Arrive 30 minutes early", "Bring home and away jerseys", "Check the updated field location"], "Before the game")}
${emailButton({ href: `${baseUrl}/schedule/preview`, label: "View Updated Schedule" })}
`;
      return renderBrandedEmailHtml({
        subject: "Schedule Update: Wildcats Game",
        contextLabel: "U14 Lightning",
        bodyHtml,
        baseUrl,
      });
    },
  },
};

function previewBaseUrl(): string {
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  return `${window.location.origin}${basePath}`;
}

export default function AdminEmailPreview() {
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");
  const [theme, setTheme] = useState<PreviewTheme>("light");
  const [template, setTemplate] = useState<TemplateId>("coach_invite");

  const activeTemplate = TEMPLATES[template];

  const emailHtml = useMemo(() => {
    const baseUrl = previewBaseUrl();
    const rawHtml = activeTemplate.getHtml(baseUrl);

    if (theme === "dark") {
      // Force the responsive dark-mode media query to apply universally for the preview stage
      return rawHtml.replace(
        "@media (prefers-color-scheme: dark)",
        "@media all",
      );
    }
    return rawHtml;
  }, [activeTemplate, theme]);

  const isMobile = viewport === "mobile";

  return (
    <AdminLayout>
      <div className="space-y-6" data-testid="admin-email-preview">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1.5 rounded-full">
                <Eye className="h-3 w-3" />
                Preview only
              </Badge>
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Email Gallery
              </span>
            </div>
            <h1 className="text-2xl font-black tracking-tight">
              Email template preview
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Review our transactional emails before families and operators
              receive them. Check how they adapt to mobile screens and dark mode
              interfaces.
            </p>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/admin/email">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Templates</CardTitle>
                <CardDescription>Select a representative email</CardDescription>
              </CardHeader>
              <CardContent className="p-2">
                <div className="flex flex-col space-y-1">
                  {(Object.keys(TEMPLATES) as TemplateId[]).map((id) => {
                    const tpl = TEMPLATES[id];
                    const Icon = tpl.icon;
                    const isSelected = template === id;
                    return (
                      <button
                        key={id}
                        onClick={() => setTemplate(id)}
                        data-testid={`button-template-${id}`}
                        className={cn(
                          "flex items-start gap-3 rounded-md p-3 text-left transition-all",
                          isSelected
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon
                          className={cn(
                            "mt-0.5 h-4 w-4 shrink-0",
                            isSelected
                              ? "text-primary"
                              : "text-muted-foreground",
                          )}
                        />
                        <div>
                          <div className="font-semibold text-sm">
                            {tpl.label}
                          </div>
                          <div className="mt-0.5 text-[11px] leading-snug opacity-80">
                            {tpl.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Preview details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {activeTemplate.details.map((detail, idx) => (
                  <div key={idx}>
                    <div className="text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
                      {detail.label}
                    </div>
                    <div className="mt-1 text-sm font-medium">
                      {detail.value}
                    </div>
                  </div>
                ))}
                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/50 dark:text-blue-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Preview only. No real data is modified and no email is sent.
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="flex min-w-0 flex-col overflow-hidden">
            <CardHeader className="border-b bg-muted/20 pb-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Mail className="h-5 w-5 text-primary" />
                    Preview stage
                  </CardTitle>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div
                    className="flex w-fit items-center rounded-lg border bg-background p-1 shadow-sm"
                    role="group"
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant={viewport === "desktop" ? "default" : "ghost"}
                      onClick={() => setViewport("desktop")}
                      data-testid="button-preview-desktop"
                      className="h-7 px-3 text-xs"
                    >
                      <Monitor className="mr-1.5 h-3.5 w-3.5" />
                      Desktop
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={viewport === "mobile" ? "default" : "ghost"}
                      onClick={() => setViewport("mobile")}
                      data-testid="button-preview-mobile"
                      className="h-7 px-3 text-xs"
                    >
                      <Smartphone className="mr-1.5 h-3.5 w-3.5" />
                      Mobile
                    </Button>
                  </div>

                  <div
                    className="flex w-fit items-center rounded-lg border bg-background p-1 shadow-sm"
                    role="group"
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant={theme === "light" ? "default" : "ghost"}
                      onClick={() => setTheme("light")}
                      data-testid="button-preview-light"
                      className="h-7 px-3 text-xs"
                    >
                      <Sun className="mr-1.5 h-3.5 w-3.5" />
                      Light
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={theme === "dark" ? "default" : "ghost"}
                      onClick={() => setTheme("dark")}
                      data-testid="button-preview-dark"
                      className="h-7 px-3 text-xs"
                    >
                      <Moon className="mr-1.5 h-3.5 w-3.5" />
                      Dark
                    </Button>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent
              className={cn(
                "flex-1 p-3 transition-colors duration-300 sm:p-6",
                theme === "dark" ? "bg-slate-900" : "bg-slate-100/80",
              )}
            >
              <div
                className={cn(
                  "h-full min-h-[780px] overflow-auto rounded-2xl border p-2 shadow-inner transition-colors duration-300 sm:p-5",
                  theme === "dark"
                    ? "border-slate-800 bg-slate-800/50"
                    : "border-slate-200 bg-slate-200/70",
                )}
                data-testid="email-preview-stage"
                data-viewport={viewport}
                data-theme={theme}
              >
                <div
                  className={cn(
                    "mx-auto overflow-hidden rounded-xl shadow-xl transition-all duration-300 ease-in-out",
                    isMobile ? "w-[375px] max-w-full" : "w-full max-w-[600px]",
                    theme === "dark" ? "bg-[#0f172a]" : "bg-white",
                  )}
                >
                  <iframe
                    title={`${activeTemplate.label} preview`}
                    srcDoc={emailHtml}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    className={cn(
                      "block h-[760px] w-full border-0 transition-colors duration-300",
                      theme === "dark" ? "bg-[#0f172a]" : "bg-white",
                    )}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
