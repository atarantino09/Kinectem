import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Eye,
  Bell,
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
  emailSection,
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
  | "org_claim_approved"
  | "schedule_change"
  | "guardian_consent"
  | "billing_trial"
  | "weekly_digest"
  | "activity_notification";

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
  org_claim_approved: {
    label: "Organization claim approved",
    description: "Approved ownership and launch steps.",
    icon: ShieldCheck,
    details: [
      { label: "Organization", value: "West Point" },
      { label: "Outcome", value: "Ownership approved" },
      { label: "Next step", value: "Finish organization setup" },
    ],
    getHtml: (baseUrl) => {
      const bodyHtml = `
${emailSection("Ownership approved", emailStatusCallout("success", "Your claim is approved. You now have owner access."))}
${emailSection("What ownership enables", `<p style="margin:0;">Update the organization page, add teams, invite coaches, and bring players and parents into the right rosters.</p>`)}
${emailSection("Finish your setup", `<p style="margin:0 0 18px;">Start with the recommended launch order. Your checklist and page tour will remain available if you return later.</p>${emailButton({ href: `${baseUrl}/organizations/west-point?ownerSetup=1`, label: "Finish setting up West Point" })}${emailChecklist(["Review and share the pre-invite message with your club.", "Bulk add coaches across your teams.", "Add players and parents through Roster outreach using each team's secure invitation."])}`)}
`;
      return renderBrandedEmailHtml({
        subject: "You're now the owner of West Point on Kinectem",
        contextLabel: "West Point",
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
  guardian_consent: {
    label: "Guardian consent",
    description: "Consent request for a young athlete.",
    icon: ShieldCheck,
    details: [
      { label: "Guardian", value: "Jordan Lee" },
      { label: "Athlete", value: "Maya Lee" },
      { label: "Team", value: "U14 Lightning" },
    ],
    getHtml: (baseUrl) => {
      const bodyHtml = `
${emailSection({
  eyebrow: "Guardian action",
  title: "Confirm Maya's participation",
  bodyHtml: `<p style="margin: 0;">Jordan, please review and confirm the consent details for Maya Lee before the U14 Lightning season begins.</p>`,
})}
${emailKeyValue([
  { label: "Athlete", value: "Maya Lee" },
  { label: "Team", value: "U14 Lightning" },
  { label: "Requested by", value: "Coach Mike Davis" },
  { label: "Due", value: "September 22, 2026" },
])}
${emailStatusCallout("info", "You can review or withdraw consent from your family settings at any time.")}
${emailButton({ href: `${baseUrl}/consent/preview`, label: "Review consent" })}
`;
      return renderBrandedEmailHtml({
        subject: "Guardian consent requested for Maya Lee",
        contextLabel: "U14 Lightning",
        bodyHtml,
        baseUrl,
      });
    },
  },
  billing_trial: {
    label: "Trial ending",
    description: "Billing reminder for an organization.",
    icon: CreditCard,
    details: [
      { label: "Organization", value: "West Point" },
      { label: "Plan", value: "Club Pro" },
      { label: "Trial ends", value: "October 1, 2026" },
    ],
    getHtml: (baseUrl) => {
      const bodyHtml = `
${emailSection({
  eyebrow: "Billing reminder",
  title: "Your Club Pro trial ends soon",
  bodyHtml: `<p style="margin: 0;">Your West Point trial ends on October 1. Keep team pages, schedules, and family communication in one place by choosing a plan before then.</p>`,
})}
${emailKeyValue([
  { label: "Organization", value: "West Point" },
  { label: "Current plan", value: "Club Pro trial" },
  { label: "Trial ends", value: "October 1, 2026" },
])}
${emailButton({ href: `${baseUrl}/settings/billing`, label: "Review billing" })}
`;
      return renderBrandedEmailHtml({
        subject: "Your West Point trial ends October 1",
        contextLabel: "West Point",
        bodyHtml,
        baseUrl,
      });
    },
  },
  weekly_digest: {
    label: "Weekly digest",
    description: "A concise summary for families and staff.",
    icon: BarChart3,
    details: [
      { label: "Recipient", value: "Jordan Lee" },
      { label: "Team", value: "U14 Lightning" },
      { label: "Period", value: "September 12–18, 2026" },
    ],
    getHtml: (baseUrl) => {
      const bodyHtml = `
${emailSection({
  eyebrow: "Weekly digest",
  title: "Your U14 Lightning week",
  bodyHtml: `<p style="margin: 0;">Here is the latest activity from your team, ready for a quick scan.</p>`,
})}
${emailKeyValue([
  { label: "Upcoming", value: "2 events" },
  { label: "Team updates", value: "3 new posts" },
  { label: "Attendance", value: "Maya marked available" },
])}
${emailSection({
  title: "Next up",
  bodyHtml: `<p style="margin: 0;">Saturday practice at North Park, 10:00 AM</p>`,
})}
${emailButton({ href: `${baseUrl}/team/preview`, label: "Open team activity" })}
`;
      return renderBrandedEmailHtml({
        subject: "Your U14 Lightning weekly digest",
        contextLabel: "U14 Lightning",
        bodyHtml,
        baseUrl,
      });
    },
  },
  activity_notification: {
    label: "Activity notification",
    description: "Short alert for a new team update.",
    icon: Bell,
    details: [
      { label: "Recipient", value: "Jordan Lee" },
      { label: "Posted by", value: "Coach Mike Davis" },
      { label: "Team", value: "U14 Lightning" },
    ],
    getHtml: (baseUrl) => {
      const bodyHtml = `
${emailSection({
  eyebrow: "New team update",
  title: "Practice starts 30 minutes later",
  bodyHtml: `<p style="margin: 0;">Coach Mike Davis posted an update for U14 Lightning. Practice now begins at 6:30 PM today at North Park.</p>`,
})}
${emailButton({ href: `${baseUrl}/team/preview`, label: "View update" })}
`;
      return renderBrandedEmailHtml({
        subject: "New update from U14 Lightning",
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
