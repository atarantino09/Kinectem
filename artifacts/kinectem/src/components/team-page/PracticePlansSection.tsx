import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ClipboardList, Sparkles, Lock, Pencil, Loader2, Plus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { customFetch } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { useListPracticePlans, useCreatePracticePlan, useUpdatePracticePlan, PracticePlan } from "@/hooks/use-practice-plans";
import { Skeleton } from "@/components/ui/skeleton";

const planSchema = z.object({
  title: z.string().min(1, "A title is required"),
  body: z.string().min(1, "Practice details are required"),
});

type PlanValues = z.infer<typeof planSchema>;

export function PracticePlansSection({
  teamId,
  canManage,
  canView,
  createRequestToken = 0,
}: {
  teamId: string;
  canManage: boolean;
  canView: boolean;
  createRequestToken?: number;
}) {
  const { data: plans, isLoading, isError, refetch } = useListPracticePlans(teamId, canView);
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    if (!canManage || createRequestToken === 0) return;
    setIsComposing(true);
    requestAnimationFrame(() => {
      document.getElementById("practice-plans")?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [canManage, createRequestToken]);

  if (!canView) return null;

  return (
    <section id="practice-plans" className="space-y-4 scroll-mt-24" data-testid="practice-plans-section">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5" />
          <h2 className="text-xl font-black tracking-tight">Practice Plans</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
            <Lock className="h-3 w-3" />
            Team only
          </span>
        </div>
        {canManage && !isComposing && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setIsComposing(true)}
            data-testid="btn-new-practice-plan"
            className="w-full sm:w-auto"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            New Practice Plan
          </Button>
        )}
      </div>

      {canManage && isComposing && (
        <PracticePlanComposer 
          teamId={teamId} 
          onCancel={() => setIsComposing(false)} 
          onSuccess={() => setIsComposing(false)}
        />
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : isError ? (
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="p-6 text-center text-sm text-destructive">
            <p>Could not load practice plans.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : plans?.length === 0 && !isComposing ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center">
            <ClipboardList className="w-8 h-8 mb-2 opacity-50" />
            <p>No practice plans yet.</p>
            {canManage && (
              <p className="mt-1">
                Create an internal update for coaches, organization admins,
                players, and parents.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {plans?.map((plan) => (
            <PracticePlanCard 
              key={plan.id} 
              plan={plan} 
              teamId={teamId} 
              canManage={canManage} 
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PracticePlanComposer({
  teamId,
  plan,
  onCancel,
  onSuccess,
}: {
  teamId: string;
  plan?: PracticePlan;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const form = useForm<PlanValues>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      title: plan?.title ?? "",
      body: plan?.body ?? "",
    },
  });

  const createPlan = useCreatePracticePlan();
  const updatePlan = useUpdatePracticePlan();
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  const isSaving = createPlan.isPending || updatePlan.isPending;

  const onSubmit = async (values: PlanValues, status: "draft" | "published") => {
    try {
      if (plan) {
        await updatePlan.mutateAsync({
          teamId,
          planId: plan.id,
          data: { ...values, status },
        });
        toast({ title: status === "published" ? "Plan published internally" : "Draft updated" });
      } else {
        await createPlan.mutateAsync({
          teamId,
          data: { ...values, status },
        });
        toast({ title: status === "published" ? "Plan published internally" : "Plan saved as draft" });
      }
      onSuccess();
    } catch {
      toast({ title: "Failed to save practice plan", variant: "destructive" });
    }
  };

  const generateWithAi = async () => {
    const currentBody = form.getValues("body");
    const currentTitle = form.getValues("title");
    
    if (!currentBody.trim()) {
      toast({ title: "Add some notes first", description: "Jot down a few drills or topics for the AI to expand on." });
      return;
    }

    setIsAiGenerating(true);
    try {
      const result = await customFetch<{ text: string }>("/api/v1/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "draft",
          postType: "long",
          notes: currentBody,
          title: currentTitle,
          teamId,
          practicePlan: true,
        }),
      });
      form.setValue("body", result.text, { shouldValidate: true });
      toast({ title: "AI draft generated", description: "Review and edit before saving." });
    } catch {
      toast({ title: "AI Assist couldn't draft this plan", variant: "destructive" });
    } finally {
      setIsAiGenerating(false);
    }
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="p-4 pb-0">
        <div className="flex items-center gap-2 text-sm font-bold text-primary" data-testid="practice-plan-privacy-copy">
          <Lock className="w-4 h-4" />
          Private team update
        </div>
        <p className="text-xs text-muted-foreground">
          Only this team's coaches, organization admins, players, and parents
          can see it. Followers, fans, and the public cannot.
        </p>
      </CardHeader>
      <CardContent className="p-4">
        <Form {...form}>
          <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input 
                      placeholder="e.g. Tuesday Evening - Defensive Rotations" 
                      className="font-semibold bg-background"
                      disabled={isSaving || isAiGenerating}
                      data-testid="practice-plan-title"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea 
                      placeholder="Outline your drills, time blocks, required equipment, and coaching focus..."
                      className="min-h-[140px] resize-y bg-background"
                      disabled={isSaving || isAiGenerating}
                      data-testid="practice-plan-body"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <Button 
                type="button" 
                variant="outline" 
                size="sm"
                className="ai-assist-shine sm:mr-auto"
                disabled={isSaving || isAiGenerating || !form.watch("body").trim()}
                onClick={generateWithAi}
                data-testid="practice-plan-ai-assist"
              >
                {isAiGenerating ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-1.5 text-primary" />
                )}
                Expand with AI
              </Button>
              <div className="flex gap-2">
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm"
                  onClick={onCancel}
                  disabled={isSaving || isAiGenerating}
                  className="flex-1 sm:flex-none"
                  data-testid="practice-plan-cancel"
                >
                  Cancel
                </Button>
                <Button 
                  type="button" 
                  variant="secondary" 
                  size="sm"
                  onClick={() => form.handleSubmit((v) => onSubmit(v, "draft"))()}
                  disabled={isSaving || isAiGenerating}
                  className="flex-1 sm:flex-none"
                  data-testid="practice-plan-save-draft"
                >
                  Save Draft
                </Button>
                <Button 
                  type="button" 
                  variant="brand" 
                  size="sm"
                  onClick={() => form.handleSubmit((v) => onSubmit(v, "published"))()}
                  disabled={isSaving || isAiGenerating}
                  className="flex-1 sm:flex-none"
                  data-testid="practice-plan-submit"
                >
                  Publish Internally
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function PracticePlanCard({
  plan,
  teamId,
  canManage,
}: {
  plan: PracticePlan;
  teamId: string;
  canManage: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <PracticePlanComposer 
        teamId={teamId}
        plan={plan}
        onCancel={() => setIsEditing(false)}
        onSuccess={() => setIsEditing(false)}
      />
    );
  }

  const isDraft = plan.status === "draft";

  return (
    <Card className={isDraft ? "border-amber-200 bg-amber-50/30" : "bg-card"}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-lg leading-tight flex items-center gap-2">
              {plan.title}
              {isDraft && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                  <Clock className="w-3 h-3" />
                  Draft
                </span>
              )}
            </h3>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Lock className="w-3 h-3" /> Internal
              </span>
              <span>•</span>
              <span>
                By {plan.author?.displayName || "Staff"} on {new Date(plan.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground hover:text-foreground"
              onClick={() => setIsEditing(true)}
              data-testid={`btn-edit-practice-plan-${plan.id}`}
            >
              <Pencil className="w-4 h-4" />
              <span className="sr-only">Edit</span>
            </Button>
          )}
        </div>
        
        <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap text-foreground/90">
          {plan.body}
        </div>
      </CardContent>
    </Card>
  );
}
