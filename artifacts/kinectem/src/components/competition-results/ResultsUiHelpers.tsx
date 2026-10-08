import type { ReactNode } from "react";
import { nameCandidates, type Participant } from "@/lib/competition-results";

export const UNSET = "__unset__";
export const EXTERNAL = "__external__";

const fmtCand = (p: Participant) =>
  `${p.name}: gender ${p.gender || "?"}, age ${p.age || "?"}, division ${p.division || "?"}, bracket ${p.bracket || "?"}`;

export function Candidates({ name, participants, testId }: { name: string; participants: Participant[]; testId: string }) {
  const c = nameCandidates(name, participants);
  if (c.length === 0) return null;
  return (
    <ul
      className={`rounded-md border p-1.5 text-[11px] ${c.length > 1 ? "border-amber-500 bg-amber-50" : "border-border bg-background"}`}
      data-testid={testId}
    >
      <li className="font-bold">
        {c.length > 1 ? `${c.length} teams share this name. Pick the right one yourself.` : "Same-name team:"}
      </li>
      {c.map((p) => (
        <li key={p.id}>{fmtCand(p)}</li>
      ))}
    </ul>
  );
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Please try again.");

export const statusTone: Record<string, string> = {
  ready: "bg-emerald-100 text-emerald-900",
  partial: "bg-amber-100 text-amber-900",
  blocked: "bg-red-100 text-red-900",
  unsupported: "bg-red-100 text-red-900",
};

export function PickParticipant({
  value,
  decided,
  participants,
  onPick,
  testId,
  label,
  candidates,
}: {
  candidates?: ReactNode;
  value: string | null;
  decided: boolean;
  participants: Participant[];
  onPick: (id: string | null) => void;
  testId: string;
  label: string;
}) {
  return (
    <div className="space-y-1">
    {candidates}
    <select
      aria-label={label}
      value={!decided ? UNSET : value ?? EXTERNAL}
      onChange={(e) => onPick(e.target.value === EXTERNAL ? null : e.target.value)}
      className={`h-8 w-full rounded-md border bg-background px-2 text-xs ${decided ? "border-border" : "border-amber-500"}`}
      data-testid={testId}
    >
      <option value={UNSET} disabled>
        Choose team…
      </option>
      <option value={EXTERNAL}>External team (not on Kinectem)</option>
      {participants.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({[p.gender, p.age, p.division, p.bracket].filter(Boolean).join(" / ") || "no metadata"})
        </option>
      ))}
    </select>
    </div>
  );
}
