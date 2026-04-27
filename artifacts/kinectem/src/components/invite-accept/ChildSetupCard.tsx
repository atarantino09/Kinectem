import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, CheckCircle2, ArrowRight } from "lucide-react";

export interface AddedChild {
  id: string;
  firstName: string;
  lastName: string;
}

interface ChildSetupCardProps {
  children: AddedChild[];
  firstName: string;
  lastName: string;
  saving: boolean;
  onFirstNameChange: (v: string) => void;
  onLastNameChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onFinish: () => void;
}

export function ChildSetupCard({
  children,
  firstName,
  lastName,
  saving,
  onFirstNameChange,
  onLastNameChange,
  onSubmit,
  onFinish,
}: ChildSetupCardProps) {
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
              Add as many kids as you have on this team. Each gets their own
              athlete profile under your guardian account.
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

        <form onSubmit={onSubmit} className="space-y-3">
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
            disabled={saving}
            className="font-bold rounded-full"
            data-testid="btn-add-child"
          >
            {saving ? "Adding..." : "Add child to roster"}
          </Button>
        </form>

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
