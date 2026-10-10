// Competition recap entry points share a viewer-local opening boundary.
export function competitionRecapOpensAt(startDate: string | null | undefined): number | null {
  const day = startDate?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date - 1, 0, 1).getTime();
}

export function competitionRecapsOpen(startDate: string | null | undefined, now: number): boolean {
  const opensAt = competitionRecapOpensAt(startDate);
  return opensAt !== null && now >= opensAt;
}

// Wake at midnight for calendar-date changes, then at 12:01 for authoring.
export function nextLocalRecapBoundary(now: number): number {
  const local = new Date(now);
  const openingMinute = new Date(local.getFullYear(), local.getMonth(), local.getDate(), 0, 1).getTime();
  return now < openingMinute ? openingMinute :
    new Date(local.getFullYear(), local.getMonth(), local.getDate() + 1).getTime();
}
