import { formatDistanceToNow, format } from "date-fns";

export function timeAgo(iso?: string): string {
  if (!iso) return "";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

export function formatDate(iso?: string): string {
  if (!iso) return "";
  try {
    return format(new Date(iso), "MMM d, yyyy");
  } catch {
    return "";
  }
}

export function friendlyAgeLabel(
  dob: Date,
  now: Date = new Date(),
): string {
  const dobY = dob.getUTCFullYear();
  const dobM = dob.getUTCMonth();
  const dobD = dob.getUTCDate();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const ty = today.getUTCFullYear();
  let age = ty - dobY;
  const hadBirthdayThisYear =
    today.getUTCMonth() > dobM ||
    (today.getUTCMonth() === dobM && today.getUTCDate() >= dobD);
  if (!hadBirthdayThisYear) age -= 1;
  let nextBday = new Date(Date.UTC(ty, dobM, dobD));
  if (nextBday.getTime() < today.getTime()) {
    nextBday = new Date(Date.UTC(ty + 1, dobM, dobD));
  }
  const days = Math.round(
    (nextBday.getTime() - today.getTime()) / 86400000,
  );
  if (days === 0) return `Turns ${age} today`;
  const nextAge = age + 1;
  if (days === 1) return `Turns ${nextAge} tomorrow`;
  if (days <= 7) return `Turns ${nextAge} in ${days} days`;
  return `Age ${age}`;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
