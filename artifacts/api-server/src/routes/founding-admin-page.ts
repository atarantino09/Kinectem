import { Router, type IRouter } from "express";

const router: IRouter = Router();

// Self-contained standalone manager page for the Founding 100 signups.
// Served unauthenticated (it is just the shell / login screen); all data
// access is gated by the password-protected /api/v1/founding-admin/* API.
const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Founding 100 Manager · Kinectem</title>
<link rel="icon" href="data:," />
<style>
  :root {
    --bg: #0b1220; --panel: #111a2e; --panel2: #0e1729; --line: #1f2c47;
    --text: #e8eefc; --muted: #93a3c4; --brand: #4f7cff; --brand2: #6f9bff;
    --danger: #ff5c6c; --ok: #34d399; --radius: 12px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  a { color: var(--brand2); }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 18px 60px; }
  header.top { display: flex; align-items: center; justify-content: space-between;
    gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
  .title { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
  .sub { color: var(--muted); font-size: 13px; margin-top: 2px; }
  button { font: inherit; cursor: pointer; border-radius: 10px; border: 1px solid var(--line);
    background: var(--panel); color: var(--text); padding: 9px 14px; }
  button:hover { border-color: #2c3c63; }
  button.primary { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 600; }
  button.primary:hover { background: var(--brand2); }
  button.danger { color: var(--danger); border-color: #3a2230; }
  button.danger:hover { background: #2a1620; }
  button.ghost { background: transparent; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  input, select {
    font: inherit; width: 100%; padding: 10px 12px; border-radius: 10px;
    border: 1px solid var(--line); background: var(--panel2); color: var(--text); }
  input:focus, select:focus { outline: none; border-color: var(--brand); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); }
  .login { max-width: 380px; margin: 12vh auto 0; padding: 26px; }
  .login h1 { margin: 0 0 4px; font-size: 20px; }
  .login p { color: var(--muted); margin: 0 0 18px; font-size: 13px; }
  .login .row { margin-bottom: 12px; }
  .toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
  .toolbar .search { flex: 1; min-width: 220px; }
  .count { color: var(--muted); font-size: 13px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 11px 12px; border-bottom: 1px solid var(--line); font-size: 14px; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:hover td { background: rgba(79,124,255,0.05); }
  .org { font-weight: 600; }
  .email { color: var(--muted); }
  .rowact { display: flex; gap: 6px; justify-content: flex-end; }
  .empty { text-align: center; color: var(--muted); padding: 30px; }
  .err { color: var(--danger); font-size: 13px; min-height: 18px; margin-top: 6px; }
  .overlay { position: fixed; inset: 0; background: rgba(4,8,18,0.6); display: none;
    align-items: center; justify-content: center; padding: 18px; z-index: 50; }
  .overlay.show { display: flex; }
  .modal { width: 100%; max-width: 520px; padding: 22px; }
  .modal h2 { margin: 0 0 16px; font-size: 18px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 5px; }
  .field { margin-bottom: 12px; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }
  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    background: var(--panel); border: 1px solid var(--line); padding: 10px 16px;
    border-radius: 10px; opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 60; }
  .toast.show { opacity: 1; }
  @media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } .hide-sm { display: none; } }
</style>
</head>
<body>
<div class="wrap">
  <!-- LOGIN -->
  <div id="loginView" class="card login" style="display:none">
    <h1>Founding 100 Manager</h1>
    <p>Enter the manager password to view and edit signups.</p>
    <form id="loginForm">
      <div class="row"><input id="pw" type="password" placeholder="Password" autocomplete="current-password" autofocus /></div>
      <button class="primary" style="width:100%" type="submit">Sign in</button>
      <div class="err" id="loginErr"></div>
    </form>
  </div>

  <!-- APP -->
  <div id="appView" style="display:none">
    <header class="top">
      <div>
        <div class="title">Founding 100</div>
        <div class="sub">Pre-launch organization signups from the marketing site.</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="exportBtn" class="ghost">Export CSV</button>
        <button id="logoutBtn" class="ghost">Sign out</button>
      </div>
    </header>

    <div class="toolbar">
      <div class="search"><input id="search" placeholder="Search organization, name, email, sport…" /></div>
      <div class="count" id="count">—</div>
      <button id="refreshBtn" class="ghost">Refresh</button>
    </div>

    <div class="card" style="padding:16px; margin-bottom:14px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;">Seed organization pages</div>
          <div class="sub">Create the written-in org pages in this environment and download their claim links. Safe to run more than once.</div>
        </div>
        <button id="seedBtn" class="primary">Seed org pages &amp; download CSV</button>
      </div>
      <div id="seedStatus" class="sub" style="margin-top:10px; min-height:16px;"></div>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th class="hide-sm">Submitted</th>
            <th>Organization</th>
            <th>Admin</th>
            <th class="hide-sm">Email</th>
            <th class="hide-sm">Role</th>
            <th class="num">Teams</th>
            <th class="num">Players</th>
            <th class="hide-sm">Sport</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="rows"><tr><td colspan="9" class="empty">Loading…</td></tr></tbody>
      </table>
    </div>
  </div>
</div>

<!-- EDIT MODAL -->
<div class="overlay" id="overlay">
  <div class="card modal">
    <h2 id="modalTitle">Edit signup</h2>
    <form id="editForm">
      <input type="hidden" id="f_id" />
      <div class="field"><label>Organization</label><input id="f_orgName" required maxlength="200" /></div>
      <div class="grid2">
        <div class="field"><label>Admin name</label><input id="f_adminName" required maxlength="200" /></div>
        <div class="field"><label>Admin email</label><input id="f_adminEmail" type="email" required maxlength="320" /></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Role / title</label><input id="f_roleTitle" required maxlength="200" /></div>
        <div class="field"><label>Sport</label><input id="f_sport" maxlength="100" placeholder="(optional)" /></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Estimated teams</label><input id="f_estimatedTeams" type="number" min="0" max="100000" required /></div>
        <div class="field"><label>Estimated players</label><input id="f_estimatedPlayers" type="number" min="0" max="1000000" required /></div>
      </div>
      <div class="err" id="editErr"></div>
      <div class="modal-actions">
        <button type="button" class="ghost" id="cancelEdit">Cancel</button>
        <button type="submit" class="primary" id="saveEdit">Save changes</button>
      </div>
    </form>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
(function () {
  var API = "/api/v1/founding-admin";
  var TOKEN_KEY = "founding_admin_token";
  var rows = [];

  function token() { return sessionStorage.getItem(TOKEN_KEY); }
  function setToken(t) { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); }

  function $(id) { return document.getElementById(id); }
  function show(el, on) { el.style.display = on ? "" : "none"; }

  var toastTimer;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  async function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (token()) headers["Authorization"] = "Bearer " + token();
    if (opts.body) headers["Content-Type"] = "application/json";
    var res = await fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body });
    if (res.status === 401) { setToken(null); renderAuth(); throw new Error("Session expired — please sign in again."); }
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || ("Request failed (" + res.status + ")"));
    return data;
  }

  function renderAuth() {
    if (token()) { show($("loginView"), false); show($("appView"), true); load(); }
    else { show($("appView"), false); show($("loginView"), true); $("pw").focus(); }
  }

  async function load() {
    $("rows").innerHTML = '<tr><td colspan="9" class="empty">Loading…</td></tr>';
    try {
      var data = await api("/signups");
      rows = data.data || [];
      renderRows();
    } catch (e) { toast(e.message); }
  }

  function fmtDate(s) { try { return new Date(s).toLocaleDateString(); } catch (e) { return s; } }

  function renderRows() {
    var q = ($("search").value || "").trim().toLowerCase();
    var list = !q ? rows : rows.filter(function (r) {
      return (r.orgName || "").toLowerCase().indexOf(q) >= 0
        || (r.adminName || "").toLowerCase().indexOf(q) >= 0
        || (r.adminEmail || "").toLowerCase().indexOf(q) >= 0
        || (r.sport || "").toLowerCase().indexOf(q) >= 0;
    });
    $("count").textContent = rows.length + " total · " + list.length + " shown";
    if (list.length === 0) { $("rows").innerHTML = '<tr><td colspan="9" class="empty">No signups found.</td></tr>'; return; }
    $("rows").innerHTML = list.map(function (r) {
      return '<tr>'
        + '<td class="hide-sm">' + esc(fmtDate(r.submittedAt)) + '</td>'
        + '<td class="org">' + esc(r.orgName) + '</td>'
        + '<td>' + esc(r.adminName) + '</td>'
        + '<td class="email hide-sm">' + esc(r.adminEmail) + '</td>'
        + '<td class="hide-sm">' + esc(r.roleTitle) + '</td>'
        + '<td class="num">' + esc(r.estimatedTeams) + '</td>'
        + '<td class="num">' + esc(r.estimatedPlayers) + '</td>'
        + '<td class="hide-sm">' + esc(r.sport || "—") + '</td>'
        + '<td><div class="rowact">'
        +   '<button data-edit="' + esc(r.id) + '">Edit</button>'
        +   '<button class="danger" data-del="' + esc(r.id) + '">Delete</button>'
        + '</div></td>'
        + '</tr>';
    }).join("");
  }

  function openEdit(r) {
    $("f_id").value = r.id;
    $("f_orgName").value = r.orgName || "";
    $("f_adminName").value = r.adminName || "";
    $("f_adminEmail").value = r.adminEmail || "";
    $("f_roleTitle").value = r.roleTitle || "";
    $("f_sport").value = r.sport || "";
    $("f_estimatedTeams").value = r.estimatedTeams;
    $("f_estimatedPlayers").value = r.estimatedPlayers;
    $("editErr").textContent = "";
    $("overlay").classList.add("show");
  }
  function closeEdit() { $("overlay").classList.remove("show"); }

  function csvCell(v) {
    if (v == null) return "";
    var s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv() {
    if (rows.length === 0) { toast("Nothing to export yet"); return; }
    var head = ["submitted_at","org_name","admin_name","admin_email","role_title","estimated_teams","estimated_players","sport","updated_at","id"];
    var lines = [head.join(",")];
    rows.forEach(function (r) {
      lines.push([r.submittedAt,r.orgName,r.adminName,r.adminEmail,r.roleTitle,r.estimatedTeams,r.estimatedPlayers,r.sport||"",r.updatedAt,r.id].map(csvCell).join(","));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "kinectem-founding-100-" + new Date().toISOString().slice(0,10) + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  // --- events ---
  $("loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    $("loginErr").textContent = "";
    try {
      var data = await (await fetch(API + "/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: $("pw").value })
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Sign in failed"); return j; }); }));
      setToken(data.token); $("pw").value = ""; renderAuth();
    } catch (e2) { $("loginErr").textContent = e2.message; }
  });

  function downloadSeedCsv(csv) {
    if (!csv) return;
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "kinectem-org-claim-links-" + new Date().toISOString().slice(0,10) + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }
  async function onSeed() {
    var btn = $("seedBtn"); btn.disabled = true;
    var s = $("seedStatus"); s.style.color = "var(--muted)"; s.textContent = "Seeding… this can take a moment.";
    try {
      var data = await api("/seed-orgs", { method: "POST", body: "{}" });
      s.textContent = "Created " + data.created + " new · " + data.skipped + " already existed · "
        + data.tokensBackfilled + " token(s) backfilled · " + data.totalLinks + " claim link(s) ready.";
      downloadSeedCsv(data.csv);
      toast("Seed complete — CSV downloaded");
    } catch (e) {
      s.style.color = "var(--danger)"; s.textContent = e.message;
    } finally { btn.disabled = false; }
  }

  $("logoutBtn").addEventListener("click", function () { setToken(null); renderAuth(); });
  $("refreshBtn").addEventListener("click", load);
  $("exportBtn").addEventListener("click", exportCsv);
  $("seedBtn").addEventListener("click", onSeed);
  $("search").addEventListener("input", renderRows);

  $("rows").addEventListener("click", function (e) {
    var ed = e.target.getAttribute("data-edit");
    var dl = e.target.getAttribute("data-del");
    if (ed) { var r = rows.find(function (x) { return x.id === ed; }); if (r) openEdit(r); }
    if (dl) { onDelete(dl); }
  });

  async function onDelete(id) {
    var r = rows.find(function (x) { return x.id === id; });
    var name = r ? r.orgName : "this signup";
    if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
    try { await api("/signups/" + id, { method: "DELETE" }); toast("Deleted"); await load(); }
    catch (e) { toast(e.message); }
  }

  $("cancelEdit").addEventListener("click", closeEdit);
  $("overlay").addEventListener("click", function (e) { if (e.target === $("overlay")) closeEdit(); });

  $("editForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    $("editErr").textContent = "";
    var btn = $("saveEdit"); btn.disabled = true;
    var payload = {
      orgName: $("f_orgName").value.trim(),
      adminName: $("f_adminName").value.trim(),
      adminEmail: $("f_adminEmail").value.trim(),
      roleTitle: $("f_roleTitle").value.trim(),
      sport: $("f_sport").value.trim() || null,
      estimatedTeams: Number($("f_estimatedTeams").value),
      estimatedPlayers: Number($("f_estimatedPlayers").value)
    };
    try {
      await api("/signups/" + $("f_id").value, { method: "PATCH", body: JSON.stringify(payload) });
      closeEdit(); toast("Saved"); await load();
    } catch (e2) { $("editErr").textContent = e2.message; }
    finally { btn.disabled = false; }
  });

  renderAuth();
})();
</script>
</body>
</html>`;

router.get("/founding-admin", (_req, res) => {
  res.type("html").send(PAGE);
});

export default router;
