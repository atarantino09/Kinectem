import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  Mail,
  Monitor,
  Smartphone,
} from "lucide-react";
import { renderBrandedEmailHtml } from "@workspace/email-template";
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

type PreviewViewport = "desktop" | "mobile";

const PREVIEW_INVITE = {
  inviterName: "Coach Mike Davis",
  teamName: "Varsity Football",
  roleLabel: "Coach",
} as const;

function previewBaseUrl(): string {
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  return `${window.location.origin}${basePath}`;
}

export default function AdminEmailPreview() {
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");

  const emailHtml = useMemo(() => {
    const baseUrl = previewBaseUrl();
    const inviteLink = `${baseUrl}/invites/preview-coach-invite`;
    const subject = staffInviteSubject(PREVIEW_INVITE.teamName);

    return renderBrandedEmailHtml({
      subject,
      contextLabel: PREVIEW_INVITE.teamName,
      bodyHtml: buildStaffInviteHtml({
        ...PREVIEW_INVITE,
        link: inviteLink,
      }),
      baseUrl,
    });
  }, []);

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
                Staff invitation
              </span>
            </div>
            <h1 className="text-2xl font-black tracking-tight">
              Coach invite email
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              This is the branded email a coach sees when invited to join a
              team. It uses the same copy and HTML renderer as the live
              invitation delivery, with representative preview data.
            </p>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/admin/email">
              <ArrowLeft className="h-4 w-4" />
              Email settings
            </Link>
          </Button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="border-b bg-muted/20">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Mail className="h-5 w-5 text-primary" />
                    Inbox view
                  </CardTitle>
                  <CardDescription>
                    Inspect the email at common desktop and mobile widths.
                  </CardDescription>
                </div>
                <div
                  className="flex w-fit items-center rounded-lg border bg-background p-1"
                  aria-label="Preview width"
                  role="group"
                >
                  <Button
                    type="button"
                    size="sm"
                    variant={viewport === "desktop" ? "default" : "ghost"}
                    onClick={() => setViewport("desktop")}
                    data-testid="button-preview-desktop"
                  >
                    <Monitor className="h-4 w-4" />
                    Desktop
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={viewport === "mobile" ? "default" : "ghost"}
                    onClick={() => setViewport("mobile")}
                    data-testid="button-preview-mobile"
                  >
                    <Smartphone className="h-4 w-4" />
                    Mobile
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="bg-slate-100/80 p-3 sm:p-6">
              <div
                className="overflow-auto rounded-2xl border border-slate-200 bg-slate-200/70 p-2 shadow-inner sm:p-5"
                data-testid="email-preview-stage"
                data-viewport={viewport}
              >
                <div
                  className={`mx-auto overflow-hidden rounded-xl bg-white shadow-xl transition-[width] duration-200 ${
                    isMobile
                      ? "w-[375px] max-w-full"
                      : "w-full max-w-[600px]"
                  }`}
                >
                  <iframe
                    title="Coach invitation email preview"
                    srcDoc={emailHtml}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    className="block h-[760px] w-full border-0 bg-white"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Preview details</CardTitle>
              <CardDescription>
                Representative values used for this read-only preview.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
                  Invited as
                </div>
                <div className="mt-1 font-bold">{PREVIEW_INVITE.roleLabel}</div>
              </div>
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
                  Team
                </div>
                <div className="mt-1 font-bold">{PREVIEW_INVITE.teamName}</div>
              </div>
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
                  From
                </div>
                <div className="mt-1 font-bold">{PREVIEW_INVITE.inviterName}</div>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Preview only. No invite is created and no email is sent.
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}