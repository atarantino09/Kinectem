import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useCreatePost,
  useListUserOrganizations,
  type CreatePostRequest,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, FileText, Play } from "lucide-react";
import { STUB_USER_ID } from "@/lib/me";
import { useToast } from "@/hooks/use-toast";

export default function NewPostPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialType =
    params.get("type") === "short" ? "short" : "long";
  const { toast } = useToast();

  const [postType, setPostType] = useState<"short" | "long">(initialType);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [orgId, setOrgId] = useState<string>("");

  const { data: myOrgs } = useListUserOrganizations(STUB_USER_ID);
  const createPost = useCreatePost();

  const isShort = postType === "short";
  const heading = isShort ? "New Highlight" : "New Game Recap";
  const Icon = isShort ? Play : FileText;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !description.trim()) {
      toast({
        title: "Add a title or description",
        variant: "destructive",
      });
      return;
    }
    const payload: CreatePostRequest = {
      postType,
      title: title.trim() || undefined,
      description: description.trim() || undefined,
      body: !isShort && body.trim() ? body.trim() : undefined,
      organizationId: orgId || undefined,
    };
    try {
      const result = await createPost.mutateAsync({ data: payload });
      toast({ title: "Posted!" });
      setLocation(`/posts/${result.id}`);
    } catch {
      toast({ title: "Failed to post", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/")}
            className="font-bold"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Cancel
          </Button>
          <div className="flex items-center gap-2 text-sm font-bold">
            <Icon className="w-4 h-4" />
            {heading}
          </div>
          <Button
            type="submit"
            form="new-post-form"
            disabled={createPost.isPending}
            className="font-bold rounded-full"
          >
            {createPost.isPending ? "Posting…" : "Post"}
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <Card className="rounded-xl border border-border shadow-sm">
          <CardContent className="p-6">
            <form id="new-post-form" onSubmit={onSubmit} className="space-y-5">
              <div>
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                  Post Type
                </Label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPostType("long")}
                    className={`px-4 py-3 rounded-lg border-2 text-sm font-bold flex items-center justify-center gap-2 ${
                      postType === "long"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    <FileText className="w-4 h-4" /> Game Recap
                  </button>
                  <button
                    type="button"
                    onClick={() => setPostType("short")}
                    className={`px-4 py-3 rounded-lg border-2 text-sm font-bold flex items-center justify-center gap-2 ${
                      postType === "short"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    <Play className="w-4 h-4" /> Highlight
                  </button>
                </div>
              </div>

              <div>
                <Label htmlFor="title" className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                  Title
                </Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    isShort
                      ? "Game-winning save vs. Crosstown"
                      : "Comeback win in OT"
                  }
                  className="mt-2 text-lg font-bold"
                  maxLength={200}
                />
              </div>

              <div>
                <Label htmlFor="description" className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                  Description
                </Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short summary..."
                  className="mt-2"
                  rows={3}
                />
              </div>

              {!isShort && (
                <div>
                  <Label htmlFor="body" className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                    Recap
                  </Label>
                  <Textarea
                    id="body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Tell the story of the game..."
                    className="mt-2 min-h-[260px]"
                  />
                </div>
              )}

              {myOrgs && myOrgs.data.length > 0 && (
                <div>
                  <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                    Post On Behalf Of
                  </Label>
                  <Select value={orgId} onValueChange={setOrgId}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="My profile" />
                    </SelectTrigger>
                    <SelectContent>
                      {myOrgs.data.map((org) => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
