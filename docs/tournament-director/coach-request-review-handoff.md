# Focused Handoff — Coach-Request Review Interface (prototype behavior vs. Kinectem contract)

Scope: only the tested coach **scheduling-request** handling in the prototype — interpretation, the director review panel, and inline editing. Not the rest of the tournament app. Where the prototype's behavior differs from Kinectem's settled contract (explicit field values + reasons, confirmed coach IDs, immutable originals/history, no accept-all), the difference is called out — **follow the contract, not the prototype, on those points.**

## What the prototype actually has (and what it doesn't)

The prototype has **three** request-related surfaces:
1. **Interpretation + confirm-back on entry** (`parseRequest` + `ReqAssist`) — tested, 10/10 on the negation cases.
2. **A director review panel** in Coaches & conflicts — lists every request with its original text, interpreted rule, source, and an *acknowledge / edit / remove* workflow.
3. **A coach self-service form** (`PublicCoachSheet`) reached by a shared link.

It does **not** have: a persisted original-vs-current-vs-proposed triple with history; an explicit hard-vs-soft field per request; an accept / reject / partial-accept / awaiting-clarification state machine; or coach identity by confirmed ID. Those are all contract requirements the prototype doesn't model — build them fresh.

**Request data shape in the prototype** (for reference, not a schema to copy):
`{ id, teamId, note (the original free text), before, after, avoid:[a,b], day, via ("registration" | "coach sign-in"), changedAt ("just added" | "just updated" | null), acked (bool) }`
Note it's keyed to **teamId**, and `before/after/avoid/day` are recomputed from `note` by `parseRequest` — they're a cache of the interpretation, not independently-stored, reasoned field values.

## Q1 — Reviewing the original alongside current & proposed values

**Prototype:** each row in the review panel shows, together: the **original text** verbatim (`"done by 2 Saturday"`), the **interpreted rule** (green "✓ Locked into the scheduler: done by 2:00 PM · Saturday"), and **provenance** ("via registration" or "via coach sign-in" + "just updated"). When you hit **Edit**, the original text drops into an input with `ReqAssist` beneath it, which shows the proposed reading live as you type ("We'll schedule: … · Not right?").

**Differences from the contract:**
- The "proposed" value is **recomputed live** from the current text by `parseRequest` — it is **not** stored as an independent proposed field, and editing **overwrites `note` in place**. There is **no immutable original and no history**. The contract requires immutable originals + stored proposed field values + history — add those; the prototype's layout (original + interpreted + source shown side by side) is a good visual starting point, but the data model behind it is not.
- There is no "current vs proposed" distinction in the prototype — the interpreted rule *is* the current value once parsed. The contract's three-way (original / current / proposed, with reasons) is new.

## Q2 — Vague request → explicit values; hard restriction vs soft preference; when clarification is required

**Vague → explicit (tested):** `parseRequest(text)` converts free text to `{ before, after, avoid:[a,b], day }` in minutes-from-midnight, and a plain-English `label`. It handles done-by / not-before / windows / part-of-day words (with **negation inversion** — "no morning games" = play afternoon on) / early-late / day scope (Sat/Sun/Fri/each day) / explicit "flexible". Full function below.

**When clarification is required:** when `parseRequest` returns `understood === false`. At entry, `ReqAssist` shows an amber "we couldn't read this" with `guessRequest` offering a best-guess ("Did you mean *Done by 1:00 PM*?") and a guided dropdown builder (No-games-before / Done-by / Avoid-between + time(s) + day) that emits a phrase that always parses. In the review panel, an unparseable request is flagged **RED**: "Needs your action — not read as a time rule. Edit it here to lock in a rule." That red/needs-action state is the prototype's only "awaiting clarification" analog.

**Hard vs soft — important difference:** the prototype does **not** tag a request hard or soft, and has no UI to set it. **Every parsed time request is enforced as a SOFT preference** — the scheduler penalizes out-of-window placements and shows an **amber** flag on the grid if a game breaks it (never blocks). The only thing that becomes **HARD** is an **impossible matchup**: when two teams in the same division have **disjoint windows** (e.g. one "done by noon", the other "no games before 5pm"), they can never play — flagged **RED** as a pre-solve feasibility guard. So in the prototype, hardness is **inferred from feasibility across a division**, never declared per request. The contract's **explicit hard-restriction vs soft-preference field** is new — the prototype gives you the interpretation, but not that classification; don't try to back it out of the prototype.

## Q3 — Partial acceptance, rejection, requests awaiting clarification

**Prototype:** there is **no accept, no reject, and no partial acceptance** of requests. A parsed rule is **enforced automatically** — the panel's own copy says so: *"Acknowledging just marks that you've seen a request — it does NOT change scheduling: the rule is enforced whether or not you acknowledge."* The only actions are:
- **Acknowledge** — a per-row checkbox (informational "I've seen it"), plus an **"Acknowledge all (N)"** bulk button.
- **Edit** — fix the text/rule inline (via `ReqAssist`).
- **Remove** — delete the request entirely.

States surfaced: **✓ Locked** (parsed and enforced), **"New — needs your OK" / "Updated — needs your OK"** (unacknowledged, amber row), and **RED "needs your action — not read as a time rule"** (the clarification state).

**Differences from the contract:**
- The contract **forbids accept-all.** The prototype's bulk control is **"Acknowledge all"** — same shape, different meaning. **Do not carry over any bulk accept.** If you keep a bulk ack at all, keep it strictly informational and separate from acceptance.
- The contract wants explicit **partial accept / reject-with-reason / awaiting-clarification** statuses. The prototype models **none** of accept/reject/partial — rules simply enforce once parsed. So those review states are **new work**; the prototype doesn't constrain them. Its one reusable idea is the **red "needs clarification" flag for unparseable text** — that maps cleanly to your awaiting-clarification state.

## Q4 — Unsaved edits when closing or switching requests

**Prototype:**
- The **"Add team request" modal** (`RequestModal`) holds local state; **Cancel, the X, or clicking the backdrop discards everything with no confirmation**; only "Add request" commits. It edits **one request at a time — there is no switching between requests.**
- The **inline Edit** in the review panel **commits live** — `ReqAssist`'s `onSet` and the "Done" button both call `setTeamRequest` immediately. There is **no pending-edits buffer.**

**Differences / implications for your build:**
- The prototype has **no multi-request switch with buffered edits**, so there is **no tested behavior** for "what happens to unsaved edits when you switch requests" — you're designing that fresh.
- Since **you're building the forms with saving disabled**, the commit paths are moot anyway. The only tested precedents are **modal close = discard** and **inline edit = commit live**. Pick the unsaved-edits-on-switch behavior deliberately (the contract's immutable-original + explicit-proposed model argues for an explicit "discard / keep editing" prompt rather than the prototype's silent discard).

## Coach identity — a difference that affects this interface

The prototype reconciles coaches by **typo-tolerant NAME matching** (`nameSim` / `bestCoachMatch` / `similarCoachClusters`, with merge suggestions and a merge action), and a request is keyed to **`teamId`**, resolving to the coach through the team. The contract requires **confirmed coach identity IDs, not name matching.** So tie requests and the review to confirmed coach IDs per the contract; treat the prototype's fuzzy name matching as a demo convenience, not the model.

## The tested interpretation code (reusable)

`parseRequest` and `guessRequest` are the genuinely tested core — this is the logic worth porting; the review UI around it should follow the contract.

```js
function parseRequest(str) {
  const s = (str || "").toLowerCase().replace(/[.!,]+/g, " ").replace(/\s+/g, " ").trim();
  const out = { before: null, after: null, avoid: null, day: null, understood: false, flexible: false, label: "" };
  if (!s) return out;
  const t = (tok) => {
    tok = (tok || "").trim();
    if (tok === "noon" || tok === "midday" || tok === "12pm" || tok === "12 pm") return 720;
    if (tok === "midnight") return 0;
    const mm = tok.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?/);
    if (!mm) return null;
    let h = +mm[1]; const min = mm[2] ? +mm[2] : 0; const ap = (mm[3] || "")[0];
    if (ap === "p" && h < 12) h += 12; else if (ap === "a" && h === 12) h = 0;
    else if (!ap && h >= 1 && h <= 7) h += 12; // bare 1–7 assumed afternoon (soccer context)
    return Math.max(0, Math.min(1439, h * 60 + min));
  };
  const TP = "(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a|p)?|noon|midday|midnight)";
  let m;
  // DONE-BY / NOT AFTER → `after` (last game must be done by this time)
  if ((m = s.match(new RegExp("(?:done|finished?|wrapp?ed|out|home|off|complete|ending?|last game)\\s*(?:up\\s*)?(?:by|before|no later than|at)?\\s*" + TP)))) out.after = t(m[1]);
  if ((m = s.match(new RegExp("(?:no|not|nothing|none)\\s*(?:more\\s*)?(?:games?\\s*)?(?:after|past|beyond|later than)\\s*" + TP)))) out.after = t(m[1]);
  if ((m = s.match(new RegExp("(?:no later than|by)\\s*" + TP + "\\s*(?:latest)?")))) { const v = t(m[1]); if (out.after == null) out.after = v; }
  // START-AFTER / NOT BEFORE → `before` (nothing scheduled before this time)
  if ((m = s.match(new RegExp("(?:nothing|no|not|dont|don't)\\s*(?:games?\\s*)?before\\s*" + TP)))) out.before = t(m[1]);
  if ((m = s.match(new RegExp("(?:no earlier than|not earlier than|earliest|not until|start(?:ing)?(?:\\s*(?:at|after|from))?)\\s*" + TP)))) out.before = t(m[1]);
  if ((m = s.match(new RegExp(TP + "\\s*(?:or later|and later|onwards?|or after|at the earliest|earliest)")))) out.before = t(m[1]);
  if (out.before == null && out.after == null && (m = s.match(new RegExp("(?:after|from|anytime after|play after)\\s*" + TP)))) out.before = t(m[1]);
  // WINDOW "between 9 and 12" / "9-12" / "avoid 11-1"
  if ((m = s.match(/(avoid|cant|can't|cannot|not between|between|from)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?)\s*(?:to|-|–|and|until|thru|through)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?)/))) {
    const a = t(m[2]), b = t(m[3]);
    if (a != null && b != null) { if (/avoid|cant|can't|cannot|not/.test(m[1] || "")) out.avoid = [a, b]; else if (out.before == null && out.after == null) { out.before = a; out.after = b; } }
  }
  // PART-OF-DAY keywords (only when no explicit time). A negation INVERTS the window.
  if (out.before == null && out.after == null && !out.avoid && !/\b(?:no preference|no pref|whenever|flexible|any ?time|doesn'?t matter|no restriction|no request)\b/.test(s)) {
    const NEG = "(?:no|not|avoid|skip|without|dont|don'?t|cant|can'?t|cannot|hate|rather not|prefer not)";
    const negOf = (w) => new RegExp("\\b" + NEG + "\\b(?:\\s+\\w+){0,3}\\s+(?:" + w + ")\\b").test(s);
    const negMorn = negOf("mornings?|a\\.?m\\.?");
    const negAft = negOf("afternoons?");
    const negEve = negOf("evenings?|nights?|p\\.?m\\.?");
    if (negMorn) out.before = 720;                                                    // no mornings → nothing before noon
    else if (negAft) out.after = 720;                                                 // no afternoons → done by noon
    else if (negEve) out.after = 1020;                                                // no evenings/nights → done by 5pm
    else if (/\bafternoons?\b/.test(s)) out.before = 720;                             // afternoon = no games before noon
    else if (/\bmornings?\b/.test(s)) out.after = 720;                                // morning = done by noon
    else if (/\b(?:evenings?|nights?|under the lights)\b/.test(s)) out.before = 1020; // evening = after 5pm
  }
  if (out.before == null && /\b(?:no|not|avoid|hate|skip)\s+(?:the\s+)?early\b/.test(s)) out.before = 600;   // no early = after 10am
  if (out.after == null && /\b(?:no|not|avoid|hate|skip)\s+(?:the\s+)?late\b/.test(s)) out.after = 1080;      // no late = done by 6pm
  // drop a contradictory window (before ≥ after)
  if (out.before != null && out.after != null && out.before >= out.after && !out.avoid) out.before = null;
  // DAY SCOPE (null = every day)
  let dayNote = "";
  if (/\b(?:each|every|both|all)\b[^.]*\bdays?\b/.test(s) || /\bdaily\b/.test(s)) { out.day = null; dayNote = "each day"; }
  else if (/\b(?:sat|saturday|saturdays)\b/.test(s)) { out.day = "sat"; dayNote = "Saturday"; }
  else if (/\b(?:sun|sunday|sundays)\b/.test(s)) { out.day = "sun"; dayNote = "Sunday"; }
  else if (/\b(?:fri|friday|fridays)\b/.test(s)) { out.day = "fri"; dayNote = "Friday"; }
  // "flexible/anytime" counts as understood (so a no-restriction answer isn't flagged)
  out.flexible = (out.before == null && out.after == null && !out.avoid) && /\b(?:any ?time|no preference|no pref|whenever|flexible|open|no request|no restriction|doesn'?t matter|all good|we're good|were good|none|n\/a|na)\b/.test(s);
  out.understood = (out.before != null || out.after != null || !!out.avoid || out.flexible);
  const lab = [];
  if (out.before != null) lab.push("no games before " + minToLabel(out.before));
  if (out.after != null) lab.push("done by " + minToLabel(out.after));
  if (out.avoid) lab.push("avoid " + minToLabel(out.avoid[0]) + "–" + minToLabel(out.avoid[1]));
  if (!lab.length && out.flexible) lab.push("no time restriction");
  if (lab.length && dayNote) lab.push(dayNote);
  out.label = lab.join(" · ");
  return out;
}

// For ambiguous text that doesn't hard-parse, offer a best-guess the coach/director confirms (never silently assumed).
function guessRequest(str) {
  const s = (str || "").toLowerCase();
  const day = /\bsun/.test(s) ? "sun" : /\bsat/.test(s) ? "sat" : /\bfri/.test(s) ? "fri" : "";
  const dayW = day ? " " + reqDayWord(day) : "";
  let text = null;
  if (/\bearly\b/.test(s)) text = `Done by 12:00 PM${dayW}`;
  else if (/\blate\b/.test(s)) text = `No games before 5:00 PM${dayW}`;
  else if (/\b(?:lunch|midday|noon)\b/.test(s)) text = `Done by 1:00 PM${dayW}`;
  else { const m = s.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/); if (m && day) text = `Done by ${m[1]}${dayW}`; }
  if (!text) return null;
  const pr = parseRequest(text);
  return pr.understood ? { text, label: pr.label } : null;
}
```

`reqDayOK(r, date)` applies a day-scoped rule only on the matching day; `minToLabel` formats minutes to "10:00 AM". The review-panel row logic (`ackRequest` / `ackAllRequests`, the ✓-Locked / New-needs-OK / red-needs-action states, inline `ReqAssist` edit, Remove) lives in the Coaches & conflicts requests panel of the prototype — reproduce its *interpretation surfacing* (original + interpreted + source), not its ack-centric, auto-enforce workflow.

## One-line summary of what to take vs. leave
- **Take:** `parseRequest` / `guessRequest` interpretation (vague → explicit, with the clarification trigger when `understood` is false); the visual idea of showing original text + interpreted rule + source together.
- **Leave / build per contract:** immutable original + explicit stored proposed values + history (Q1); an explicit hard-vs-soft field (Q2); accept / reject / partial-accept / awaiting-clarification states with reasons (Q3); confirmed coach IDs instead of name matching; and a deliberate unsaved-edits-on-switch behavior (Q4). No accept-all — the prototype's "Acknowledge all" is not an accept.
