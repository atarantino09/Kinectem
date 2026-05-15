import { useLocation } from "wouter";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Building2, Plus, Trophy } from "lucide-react";

type Props = {
  canAuthorRecap: boolean;
  onCreateOrg: () => void;
};

// Task #508 — Create menu shows ONLY true "create" actions
// (Game Recap, Highlight Clip, New Organization). Management entries
// (Pending Tags, My Drafts, Browse Orgs) moved to the user-avatar
// dropdown / header Orgs tab.
export function CreateMenuItems({ canAuthorRecap, onCreateOrg }: Props) {
  const [, setLocation] = useLocation();
  return (
    <>
      {canAuthorRecap && (
        <DropdownMenuItem
          onSelect={() => setLocation("/posts/new?type=long")}
          data-testid="menu-create-recap"
        >
          <Trophy className="w-4 h-4 mr-2" /> Game Recap
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => setLocation("/posts/new?type=short")}>
        <Plus className="w-4 h-4 mr-2" /> Highlight Clip
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onCreateOrg} data-testid="menu-create-org">
        <Building2 className="w-4 h-4 mr-2" /> New Organization
      </DropdownMenuItem>
    </>
  );
}
