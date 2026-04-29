import { useMemo } from "react";
import { ChevronDown, Loader2, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/UserAvatar";
import { cn } from "@/lib/utils";

export type RosterPickerMember = {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
};

interface RosterTagPickerProps {
  members: RosterPickerMember[];
  selectedUserIds: string[];
  onSelectionChange: (next: string[]) => void;
  loading?: boolean;
  disabled?: boolean;
}

// Reusable dropdown-with-checkboxes used by the highlight composer to
// pick roster players to tag in a clip (task #313). The trigger
// summarizes the current selection ("3 players tagged" / "No players
// tagged"); the menu shows a "Select all" row with an indeterminate
// state plus one row per player. Loading and empty states render
// inside the menu so the trigger keeps the same width and the
// surrounding form doesn't reflow.
export function RosterTagPicker({
  members,
  selectedUserIds,
  onSelectionChange,
  loading = false,
  disabled = false,
}: RosterTagPickerProps) {
  // Snap the selection to the current roster — when the team changes
  // the parent resets `selectedUserIds`, but during the brief window
  // before the new roster lands we still want the summary to match
  // what the menu actually shows. Filtering here also tolerates a
  // tagged user being removed from the roster between renders.
  const memberIds = useMemo(
    () => new Set(members.map((m) => m.userId)),
    [members],
  );
  const visibleSelected = useMemo(
    () => selectedUserIds.filter((id) => memberIds.has(id)),
    [selectedUserIds, memberIds],
  );
  const selectedCount = visibleSelected.length;
  const total = members.length;
  const isEmpty = !loading && total === 0;
  // Spec requires the trigger to be disabled when the roster is
  // empty (task #313). We still render an inline helper underneath
  // the trigger in that case so the user understands *why* it's
  // greyed out instead of just seeing a non-interactable control.
  const isDisabled = disabled || isEmpty;

  const allChecked = total > 0 && selectedCount === total;
  const someChecked = selectedCount > 0 && selectedCount < total;

  const summary = loading
    ? "Loading roster…"
    : isEmpty
      ? "No roster members"
      : selectedCount === 0
        ? "No players tagged"
        : `${selectedCount} player${selectedCount === 1 ? "" : "s"} tagged`;

  const toggleOne = (userId: string, checked: boolean) => {
    if (checked) {
      if (selectedUserIds.includes(userId)) return;
      onSelectionChange([...selectedUserIds, userId]);
    } else {
      onSelectionChange(selectedUserIds.filter((id) => id !== userId));
    }
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      onSelectionChange(members.map((m) => m.userId));
    } else {
      // Preserve any out-of-roster ids the parent may be holding
      // (shouldn't happen in practice, but defensive). Filtering
      // out only the visible ids matches what "Select all" showed.
      onSelectionChange(
        selectedUserIds.filter((id) => !memberIds.has(id)),
      );
    }
  };

  return (
    <div>
      <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
        Tag Players
      </Label>
      <DropdownMenu>
        <DropdownMenuTrigger
          asChild
          disabled={isDisabled}
          data-testid="trigger-tag-players"
        >
          <button
            type="button"
            className={cn(
              "mt-2 flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring",
              isDisabled
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer",
            )}
            aria-disabled={isDisabled}
          >
            <span className="flex items-center gap-2 truncate">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span
                className={cn(
                  "truncate",
                  selectedCount === 0 && "text-muted-foreground",
                )}
                data-testid="text-tag-players-summary"
              >
                {summary}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-72 p-0"
        >
          {loading ? (
            <div
              className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground"
              data-testid="state-tag-players-loading"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading roster…
            </div>
          ) : isEmpty ? (
            <div
              className="px-3 py-6 text-center text-sm text-muted-foreground"
              data-testid="state-tag-players-empty"
            >
              No roster members on this team yet.
            </div>
          ) : (
            <>
              <label
                className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm font-bold hover:bg-accent"
                data-testid="row-tag-players-select-all"
              >
                <Checkbox
                  checked={
                    allChecked
                      ? true
                      : someChecked
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={(v) => toggleAll(v === true)}
                  data-testid="checkbox-tag-players-select-all"
                />
                <span>Select all</span>
                <span className="ml-auto text-xs font-medium text-muted-foreground">
                  {selectedCount}/{total}
                </span>
              </label>
              <div className="overflow-y-auto">
                {members.map((m) => {
                  const checked = visibleSelected.includes(m.userId);
                  return (
                    <label
                      key={m.userId}
                      className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent"
                      data-testid={`row-tag-players-${m.userId}`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          toggleOne(m.userId, v === true)
                        }
                        data-testid={`checkbox-tag-players-${m.userId}`}
                      />
                      <UserAvatar
                        avatarUrl={m.avatarUrl}
                        displayName={m.displayName}
                        size="xs"
                        fallbackClassName="bg-slate-900 text-primary-foreground"
                      />
                      <span className="truncate font-semibold">
                        {m.displayName}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {isEmpty && (
        // Inline helper next to the disabled trigger so the user
        // understands why the control is greyed out (vs. assuming
        // it's a bug).
        <p
          className="mt-1.5 text-[11px] text-muted-foreground font-semibold"
          data-testid="text-tag-players-empty-helper"
        >
          No roster members on this team yet.
        </p>
      )}
    </div>
  );
}
