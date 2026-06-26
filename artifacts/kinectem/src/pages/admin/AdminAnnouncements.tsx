import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Megaphone } from "lucide-react";

type Level = "info" | "warning" | "success";

type Announcement = {
  id: string;
  title: string;
  body: string;
  level: Level;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const LEVEL_LABEL: Record<Level, string> = {
  info: "Info",
  warning: "Warning",
  success: "Success",
};

const LEVEL_VARIANT: Record<Level, "default" | "secondary" | "destructive"> = {
  info: "secondary",
  warning: "destructive",
  success: "default",
};

export default function AdminAnnouncements() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ data: Announcement[] }>({
    queryKey: ["admin", "announcements"],
    queryFn: () =>
      customFetch<{ data: Announcement[] }>(`/api/v1/admin/announcements`, {
        method: "GET",
      }),
  });

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["admin", "announcements"] });

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [level, setLevel] = useState<Level>("info");
  const [creating, setCreating] = useState(false);

  const resetForm = () => {
    setTitle("");
    setBody("");
    setLevel("info");
  };

  const create = async () => {
    if (!title.trim() || !body.trim()) {
      toast({
        title: "Enter a title and a message.",
        variant: "destructive",
      });
      return;
    }
    setCreating(true);
    try {
      await customFetch(`/api/v1/admin/announcements`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          level,
        }),
      });
      toast({ title: "Announcement published." });
      resetForm();
      setCreateOpen(false);
      refresh();
    } catch (err) {
      toast({
        title: "Couldn't publish announcement",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (row: Announcement) => {
    try {
      await customFetch(`/api/v1/admin/announcements/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !row.active }),
      });
      refresh();
    } catch (err) {
      toast({
        title: "Couldn't update announcement",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const rows = data?.data ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Announcements
            </h1>
            <p className="text-sm text-muted-foreground">
              Show a banner to every signed-in user. Deactivate to hide it.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="new-announcement">
            <Plus className="mr-2 h-4 w-4" />
            New announcement
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4 text-primary" />
              All announcements
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No announcements yet.
              </p>
            ) : (
              <div className="divide-y">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
                    data-testid={`announcement-${row.id}`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{row.title}</span>
                        <Badge
                          variant={LEVEL_VARIANT[row.level]}
                          className="text-xs"
                        >
                          {LEVEL_LABEL[row.level]}
                        </Badge>
                        {row.active ? (
                          <Badge variant="default" className="text-xs">
                            Live
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            Hidden
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {row.body}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => toggleActive(row)}
                      data-testid={`toggle-announcement-${row.id}`}
                    >
                      {row.active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New announcement</DialogTitle>
            <DialogDescription>
              This banner appears to every signed-in user until you deactivate it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ann-title">Title</Label>
              <Input
                id="ann-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Scheduled maintenance"
                data-testid="announcement-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ann-body">Message</Label>
              <Textarea
                id="ann-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="We'll be down briefly on Sunday at 2am ET."
                data-testid="announcement-body"
              />
            </div>
            <div className="space-y-2">
              <Label>Level</Label>
              <Select
                value={level}
                onValueChange={(v) => setLevel(v as Level)}
              >
                <SelectTrigger data-testid="announcement-level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={create} disabled={creating} data-testid="publish-announcement">
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
