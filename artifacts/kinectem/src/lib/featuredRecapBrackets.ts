type RecapBracketSource = {
  id: string;
  bracketId?: string | null;
  groupDivision?: string | null;
  groupBracket?: string | null;
};
type SavedBracket = { id: string; label: string };

export function featuredRecapBrackets(recaps: RecapBracketSource[], brackets: SavedBracket[], overallNames: string[] = []) {
  const saved = new Map(brackets.map((bracket, index) => [
    bracket.id, { label: bracket.label.trim(), index },
  ]));
  const byRecap = new Map<string, { key: string; label: string | null; subgroup: string | null }>();
  const options = new Map<string, { id: string; label: string; count: number }>();
  const addOption = (name: string) => {
    const label = name.trim();
    if (!label) return;
    const id = `group:${label.toLowerCase()}`;
    if (!options.has(id)) options.set(id, { id, label, count: 0 });
  };
  for (const bracket of brackets) {
    const divisions = recaps
      .filter((recap) => recap.bracketId === bracket.id)
      .flatMap((recap) => recap.groupDivision?.trim() ? [recap.groupDivision.trim()] : []);
    if (divisions.length) divisions.forEach(addOption);
    else addOption(bracket.label);
  }
  overallNames.forEach(addOption);
  // Preserve organizer ordering while combining subgroups with the same full division name.
  const ordered = [...recaps].sort((a, b) =>
    (saved.get(a.bracketId ?? "")?.index ?? brackets.length) -
    (saved.get(b.bracketId ?? "")?.index ?? brackets.length),
  );
  for (const recap of ordered) {
    const division = recap.groupDivision?.trim();
    const subgroup = recap.groupBracket?.trim() || null;
    const fallback = subgroup && !/^bracket\s+[a-z0-9]+$/i.test(subgroup) ? subgroup : null;
    const label = division || saved.get(recap.bracketId ?? "")?.label || fallback || null;
    const key = label ? `group:${label.toLowerCase()}` : "__other__";
    if (label) {
      addOption(label);
      options.get(key)!.count += 1;
    }
    byRecap.set(recap.id, { key, label: options.get(key)?.label ?? null, subgroup });
  }
  return { options: [...options.values()], byRecap };
}
