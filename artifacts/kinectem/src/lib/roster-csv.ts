// Roster CSV import — parses roster exports from third-party platforms
// (GotSport, TeamSnap, PlayMetrics, League Athletics, SportsEngine, …) into
// invite rows. Mirrors the competition schedule import's philosophy: accept
// whatever the tool exported. Headers are normalized (lowercase, strip
// non-alphanumerics) and matched against per-column alias lists; each header
// binds to at most one canonical column. Only ONE column is truly required:
// some kind of email address.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RosterCsvRow = {
  /** The address the invite will be sent to. */
  email: string;
  /** Display name for the preview (player/member name when present). */
  name: string | null;
  /** Where the email came from — parents get invites for players. */
  emailSource: "parent" | "member";
  /** Position inferred from a role/type column; defaults to player. */
  position: "player" | "coach" | "assistant_coach" | "manager" | "parent";
  /** 1-based data-row number in the pasted file (for error messages). */
  line: number;
};

export type RosterCsvResult = {
  rows: RosterCsvRow[];
  /** Data rows that had no usable email address. */
  skipped: { line: number; name: string | null; reason: string }[];
  /** True when no email-ish column could be found in the header at all. */
  noEmailColumn: boolean;
  /** True when the input didn't look like a delimited table. */
  empty: boolean;
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Alias lists — matched against normalized headers. Substring matching is
// used for the parent/guardian email family because platforms number them
// (parent1email, guardian2email, mother's email, …).
const MEMBER_EMAIL_ALIASES = new Set([
  "email",
  "emailaddress",
  "memberemail",
  "playeremail",
  "athleteemail",
  "contactemail",
  "primaryemail",
  "email1",
  "useremail",
  "accountemail",
]);

function isParentEmailHeader(h: string): boolean {
  if (!h.includes("email")) return false;
  return (
    h.includes("parent") ||
    h.includes("guardian") ||
    h.includes("mother") ||
    h.includes("father") ||
    h.includes("mom") ||
    h.includes("dad") ||
    h.includes("family")
  );
}

const FIRST_NAME_ALIASES = new Set([
  "firstname",
  "first",
  "givenname",
  "playerfirstname",
  "memberfirstname",
  "athletefirstname",
]);
const LAST_NAME_ALIASES = new Set([
  "lastname",
  "last",
  "surname",
  "familyname",
  "playerlastname",
  "memberlastname",
  "athletelastname",
]);
const FULL_NAME_ALIASES = new Set([
  "name",
  "fullname",
  "playername",
  "membername",
  "athletename",
  "player",
  "member",
]);
const ROLE_ALIASES = new Set([
  "role",
  "position",
  "membertype",
  "type",
  "membershiptype",
  "rostertype",
  "title",
]);

// Map a free-text role/type cell to a Kinectem position. Anything
// unrecognized is treated as a player (invite routes to the parent).
export function mapRole(raw: string): RosterCsvRow["position"] {
  const r = raw.toLowerCase();
  if (/assist/.test(r) && /coach/.test(r)) return "assistant_coach";
  if (/head\s*coach|coach|trainer/.test(r)) return "coach";
  if (/manager|admin|staff|volunteer/.test(r)) return "manager";
  if (/parent|guardian|mother|father|mom|dad|family/.test(r)) return "parent";
  return "player";
}

// Minimal CSV/TSV parser: handles quoted fields with embedded commas,
// quotes ("") and newlines. Auto-detects tab-delimited paste from a
// spreadsheet (tabs in the first line and no commas outside quotes).
export function parseDelimited(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n") + 1 || text.length);
  const delim =
    firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export function parseRosterCsv(text: string): RosterCsvResult {
  const table = parseDelimited(text.trim());
  if (table.length < 2) {
    return { rows: [], skipped: [], noEmailColumn: false, empty: true };
  }

  const header = table[0].map(normalizeHeader);
  let memberEmailCol = -1;
  const parentEmailCols: number[] = [];
  let firstNameCol = -1;
  let lastNameCol = -1;
  let fullNameCol = -1;
  let roleCol = -1;

  header.forEach((h, i) => {
    if (isParentEmailHeader(h)) {
      parentEmailCols.push(i);
    } else if (memberEmailCol === -1 && MEMBER_EMAIL_ALIASES.has(h)) {
      memberEmailCol = i;
    } else if (firstNameCol === -1 && FIRST_NAME_ALIASES.has(h)) {
      firstNameCol = i;
    } else if (lastNameCol === -1 && LAST_NAME_ALIASES.has(h)) {
      lastNameCol = i;
    } else if (fullNameCol === -1 && FULL_NAME_ALIASES.has(h)) {
      fullNameCol = i;
    } else if (roleCol === -1 && ROLE_ALIASES.has(h)) {
      roleCol = i;
    }
  });

  // Last-ditch: any other header containing "email" counts as member email
  // (e.g. "Player 1 Email Address"). Better to import than to reject.
  if (memberEmailCol === -1 && parentEmailCols.length === 0) {
    const loose = header.findIndex((h) => h.includes("email"));
    if (loose !== -1) memberEmailCol = loose;
  }

  if (memberEmailCol === -1 && parentEmailCols.length === 0) {
    return { rows: [], skipped: [], noEmailColumn: true, empty: false };
  }

  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  const rows: RosterCsvRow[] = [];
  const skipped: RosterCsvResult["skipped"] = [];

  table.slice(1).forEach((r, idx) => {
    const line = idx + 1;
    const first = cell(r, firstNameCol);
    const last = cell(r, lastNameCol);
    const full = cell(r, fullNameCol);
    const name = full || [first, last].filter(Boolean).join(" ") || null;

    const roleRaw = cell(r, roleCol);
    const position = roleRaw ? mapRole(roleRaw) : "player";

    const memberEmail = cell(r, memberEmailCol).toLowerCase();
    const parentEmail = parentEmailCols
      .map((i) => cell(r, i).toLowerCase())
      .find((e) => EMAIL_RE.test(e));

    // Players' invites go to their parents (COPPA); staff get their own.
    const preferParent = position === "player" || position === "parent";
    const candidates = preferParent
      ? [parentEmail, memberEmail]
      : [memberEmail, parentEmail];
    const email = candidates.find((e) => e && EMAIL_RE.test(e));

    if (!email) {
      skipped.push({
        line,
        name,
        reason:
          memberEmail || parentEmail
            ? "Invalid email address"
            : "No email address in this row",
      });
      return;
    }

    rows.push({
      email,
      name,
      emailSource: email === parentEmail ? "parent" : "member",
      position,
      line,
    });
  });

  return { rows, skipped, noEmailColumn: false, empty: false };
}
