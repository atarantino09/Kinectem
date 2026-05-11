import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/UserAvatar";
import { UserPlus, CheckCircle2, ArrowRight, Plus } from "lucide-react";

export interface AddedChild {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
}

export interface LinkedChildOption {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
}

interface ChildSetupCardProps {
  children: AddedChild[];
  linkedChildren: LinkedChildOption[];
  /**
   * True once the parent's linked-children list has been fetched at least
   * once. Needed because the fetch is async and an initial empty
   * `linkedChildren` array would otherwise look identical to "this parent
   * has no kids" and incorrectly default to the create-new form.
   */
  linkedChildrenLoaded: boolean;
  /** Set of child ids already on this team's roster (any status). */
  alreadyOnTeam: Set<string>;
  firstName: string;
  lastName: string;
  saving: boolean;
  /** Id of the linked child currently being added, if any. */
  addingChildId: string | null;
  onFirstNameChange: (v: string) => void;
  onLastNameChange: (v: string) => void;
  onAddExistingChild: (childId: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onFinish: () => void;
}

export function ChildSetupCard({
  children,
  linkedChildren,
  linkedChildrenLoaded,
  alreadyOnTeam,
  firstName,
  lastName,
  saving,
  addingChildId,
  onFirstNameChange,
  onLastNameChange,
  onAddExistingChild,
  onSubmit,
  onFinish,
}: ChildSetupCardProps) {
  const hasLinkedChildren = linkedChildren.length > 0;
  // Show the create-new form by default for parents with no linked
  // children (existing behavior), and hide it behind a toggle for parents
  // who have linked children (chooser is primary). We only trust the
  // "no linked children" signal once the fetch has actually resolved —
  // otherwise the initial empty array would race ahead and surface the
  // create form briefly even for parents who do have kids.
  const [revealCreateForm, setRevealCreateForm] = useState(false);
  const showCreateForm =
    revealCreateForm || (linkedChildrenLoaded && !hasLinkedChildren);
  const addedIds = new Set(children.map((c) => c.id));

  return (
    <Card className="rounded-xl border-border">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shrink-0">
            <UserPlus className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="font-black tracking-tight">
              Add your child{children.length > 0 ? "ren" : ""} to the roster
            </h2>
            <p className="text-xs text-muted-foreground">
              {hasLinkedChildren
                ? "Pick one of your existing kids, or create a brand-new account."
                : "Add as many kids as you have on this team. Each gets their own athlete profile under your guardian account."}
            </p>
          </div>
        </div>

        {children.length > 0 && (
          <div className="space-y-2">
            {children.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"
                data-testid={`row-added-child-${c.id}`}
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="font-bold">
                  {c.firstName} {c.lastName}
                </span>
                <span className="text-emerald-700 ml-auto text-xs uppercase tracking-wider font-bold">
                  On roster
                </span>
              </div>
            ))}
          </div>
        )}

        {hasLinkedChildren && (
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Your kids
            </div>
            {linkedChildren.map((c) => {
              const onTeam = alreadyOnTeam.has(c.id) || addedIds.has(c.id);
              const busy = addingChildId === c.id;
              const displayName = `${c.firstName} ${c.lastName}`.trim();
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                  data-testid={`row-linked-child-${c.id}`}
                >
                  <UserAvatar
                    avatarUrl={c.avatarUrl ?? null}
                    displayName={displayName || "Child"}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold truncate">{displayName}</div>
                    {onTeam && (
                      <div className="text-xs text-muted-foreground">
                        Already on this team
                      </div>
                    )}
                  </div>
                  {onTeam ? (
                    <span
                      className="text-xs uppercase tracking-wider font-bold text-emerald-700"
                      data-testid={`label-on-team-${c.id}`}
                    >
                      On team
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="brand"
                      size="sm"
                      disabled={busy || saving}
                      onClick={() => onAddExistingChild(c.id)}
                      data-testid={`btn-add-linked-child-${c.id}`}
                    >
                      {busy ? "Adding..." : "Add to team"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {showCreateForm ? (
          <form onSubmit={onSubmit} className="space-y-3">
            {hasLinkedChildren && (
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Create a new child account
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="font-bold text-xs">First name</Label>
                <Input
                  value={firstName}
                  onChange={(e) => onFirstNameChange(e.target.value)}
                  placeholder="Jordan"
                  data-testid="input-child-first"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="font-bold text-xs">Last name</Label>
                <Input
                  value={lastName}
                  onChange={(e) => onLastNameChange(e.target.value)}
                  placeholder="Carter"
                  data-testid="input-child-last"
                />
              </div>
            </div>
            <Button
              type="submit"
              variant="brand"
              disabled={saving}
              data-testid="btn-add-child"
            >
              {saving ? "Adding..." : "Add child to roster"}
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full font-bold"
            onClick={() => setRevealCreateForm(true)}
            data-testid="btn-show-create-child-form"
          >
            <Plus className="w-4 h-4 mr-1" /> Create a new child account
          </Button>
        )}

        {children.length > 0 && (
          <Button
            variant="outline"
            className="w-full font-bold rounded-full"
            onClick={onFinish}
            data-testid="btn-finish-setup"
          >
            Done — go to team <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
