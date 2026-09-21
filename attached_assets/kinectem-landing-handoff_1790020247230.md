# Kinectem Landing Page — Replit Handoff

This is a condensed, restyled version of the current kinectem.com landing page. Paste the code block below into `index.html` (or your framework's equivalent) in Replit as a starting point, then wire up your real assets and any routing/CMS you're using for nav links.

---

## 1. What changed and why

- **Cut the repeated "what Kinectem does" messaging** that ran 3x across the old page (hero, Who It's For, Why Kinectem) down to one clear pass per section.
- **"Who It's For" went from 4 stacked full-width sections to one 4-column grid** — same info, a fraction of the scroll, reordered to Organization Admins → Coaches → Players → Parents.
- **Every paragraph trimmed** to 1–2 sentences; detail moved into short bullet-style trust badges instead of long paragraphs.
- **Visual "pop" added**: subtle dot-grid texture + blurred gradient orbs in the hero, elevated card shadows, a highlighted Pro pricing tier, and CTA band texture — all built from your locked brand ramps (see tokens below), not invented colors.
- **New positioning line** in "Why Kinectem" naming TeamSnap/Byga/PlayMetrics as the "kickoff" layer and Kinectem as what comes after.
- **FAQ trimmed** to the highest-value 7 questions with a "view all" link out to a full FAQ page.

---

## 2. Design tokens

All colors pulled directly from `kinectem_brand_sheet_2026.pdf` (locked 22 Aug 2026). Do not substitute other purples/blues — these are the only approved ramps.

```css
:root {
  /* Ink / neutrals */
  --ink: #150F26;
  --ink-soft: #3A3352;
  --body-text: #4A4360;
  --muted-text: #6B6480;
  --border: #EAE6F7;
  --surface-tint: #F8F6FD;
  --surface-tint-2: #F1ECFC;
  --navy: #0B1228;

  /* Named brand swatches */
  --royal-purple: #7E22CE;
  --indigo: #5B82B6;
  --deep-violet: #4C1D95;
  --royal-blue: #1D4EDB;
  --bright-blue: #2563EB;
  --magenta: #FF1F9E;      /* accent only — max ~12% of any surface, leading corner or glyph tip */
  --ink-violet: #1C0A56;   /* shoulder / surface only, never on a glyph */
  --ink-blue: #0C2A8C;     /* shoulder / surface only, never on a glyph */
  --shadow-violet: #3A1470; /* use for all shadows on light backgrounds — never gray */

  /* SURFACE ramp — buttons, filled bands, icon tiles, app-icon-style blocks. NO magenta. */
  --surface-gradient: linear-gradient(135deg,
    #1C0A56 0%, #9B22F0 22%, #6A28F8 42%, #4A34F5 58%, #2563EB 80%, #0C2A8C 100%);

  /* GLYPH ramp — the K mark and the 'em' in the wordmark ONLY. Magenta at origin. */
  --glyph-gradient: linear-gradient(135deg,
    #FF1F9E 0%, #9B22E8 22%, #7E22CE 42%, #5B32E8 58%, #2563EB 80%, #3B82F6 100%);

  /* Compressed glyph slice (0–58% of ramp) for small text like the 'em' suffix */
  --glyph-gradient-compressed: linear-gradient(135deg,
    #FF1F9E 0%, #9B22E8 45%, #7E22CE 100%);
}
```

**Brand usage rules (from the sheet — keep these when extending the page):**
1. Every gradient runs 135°, top-left to bottom-right. Magenta at the origin, blue exits.
2. Magenta is an accent only — max ~12% of any surface, always at the leading (top-left) corner or the tip of a glyph. Never a full button/band fill.
3. Ink Violet (`#1C0A56`) and Ink Blue (`#0C2A8C`) are surface shoulders only — they never touch the K glyph or the 'em' text.
4. Small objects (icons, the 'em' suffix, favicon) get a **compressed slice** of the glyph ramp (0–58%), not a shortened full ramp.
5. Shading is strong on the app icon, light on the full lockup, and the plain wordmark text gets none.
6. Shadows on light backgrounds are violet-tinted (`#3A1470`), never gray.
7. Lockup spacing is fixed by ratio, not pixels.

**Typography:**
- Wordmark ("Kinectem"): **Poppins Bold**, `-0.016em` letter-spacing — logo lockup images only, don't re-set this in code except where you're recreating "Kinect" + gradient "em" in text.
- Headlines / UI: **Inter**, weights 400–900 (Black for H1/H2).
- Google Fonts import: `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Poppins:wght@600;700;800&display=swap`

---

## 3. Assets needed

Pull these from `kinectem_brand_LOCKED.zip` (Kinectem Marketing → Kinectem Branding and Logo in Drive) — **do not** recreate the K mark or wordmark in CSS/SVG for production; use the real files:

| Use | File |
|---|---|
| Nav logo (light bg) | Horizontal lockup, light — `kinectem_logo_horizontal_light.png/svg` |
| Footer logo (dark bg) | Horizontal lockup, dark — `kinectem_logo_horizontal_dark.png/svg` |
| Hero video thumbnail | Your actual AI Assist demo video / GIF, 54 sec (currently a placeholder gradient panel — swap for a real `<video>` or embed) |
| Favicon / app icon | `icon_suite/` exports (44–300px) |

⚠️ The build below currently points at temporary preview URLs (`/_blob/...`) from this design mock — **replace these two `<img src>` values** with your real hosted logo paths before shipping.

---

## 4. Full page code

Single-file HTML/CSS, responsive (stacks below 960px, nav collapses below 860px). No JS dependencies — the FAQ "+" icons are static; wire up an accordion toggle if you want them to expand (a few lines of JS, noted at the bottom of the file).

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kinectem — The Platform That Makes Your Organization Shine</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Poppins:wght@600;700;800&display=swap">
<style>
  :root {
    --ink: #150F26;
    --ink-soft: #3A3352;
    --body-text: #4A4360;
    --muted-text: #6B6480;
    --border: #EAE6F7;
    --surface-tint: #F8F6FD;
    --surface-tint-2: #F1ECFC;
    --navy: #0B1228;
    --royal-purple: #7E22CE;
    --magenta: #FF1F9E;
    --shadow-violet: #3A1470;
    --surface-gradient: linear-gradient(135deg,#1C0A56 0%,#9B22F0 22%,#6A28F8 42%,#4A34F5 58%,#2563EB 80%,#0C2A8C 100%);
    --glyph-gradient: linear-gradient(135deg,#FF1F9E 0%,#9B22E8 22%,#7E22CE 42%,#5B32E8 58%,#2563EB 80%,#3B82F6 100%);
    --glyph-gradient-compressed: linear-gradient(135deg,#FF1F9E 0%,#9B22E8 45%,#7E22CE 100%);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: var(--ink); font-family: 'Inter', system-ui, sans-serif; }
  h1, h2, h3 { font-family: 'Inter', system-ui, sans-serif; font-weight: 900; margin: 0; letter-spacing: -0.01em; }
  p { margin: 0; }
  a { color: var(--royal-purple); text-decoration: none; }
  a:hover { color: #5B32E8; }
  img { max-width: 100%; }
  .wordmark { font-family: 'Poppins', sans-serif; font-weight: 700; letter-spacing: -0.016em; }
  .wordmark-em { background-image: var(--glyph-gradient-compressed); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .eyebrow { font-family: 'Inter', sans-serif; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; font-size: 13px; color: var(--royal-purple); }
  .grad-text { background-image: var(--surface-gradient); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .surface-grad { background-image: var(--surface-gradient); }
  .glyph-grad { background-image: var(--glyph-gradient); }

  .wrap { max-width: 1296px; margin: 0 auto; padding: 0 24px; }
  section { padding: 84px 0; }
  @media (max-width: 640px) { section { padding: 56px 0; } }

  /* Nav */
  .nav { border-bottom: 1px solid var(--border); }
  .nav-inner { display: flex; align-items: center; justify-content: space-between; min-height: 100px; padding: 16px 0; gap: 24px; }
  .nav-logo img { height: 56px; width: auto; display: block; }
  .nav-links { display: flex; align-items: center; gap: 32px; flex-wrap: wrap; }
  .nav-links a { font-size: 14px; font-weight: 600; color: var(--ink-soft); }
  .nav-links a:hover { color: var(--royal-purple); }
  .nav-actions { display: flex; align-items: center; gap: 16px; }
  @media (max-width: 860px) { .nav-links { display: none; } }

  /* Buttons */
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 16px 30px; border-radius: 999px; font-weight: 700; font-size: 16px; font-family: 'Inter', sans-serif; border: none; cursor: pointer; text-decoration: none; }
  .btn-primary { background-image: var(--surface-gradient); color: #fff; box-shadow: 0 14px 28px -12px rgba(58,20,112,0.45); }
  .btn-outline { background: transparent; color: var(--ink); border: 2px solid #DCD6F0; }
  .btn-outline-light { background: transparent; color: #fff; border: 2px solid rgba(255,255,255,0.4); }
  .btn-sm { padding: 12px 24px; font-size: 14px; }

  /* Card */
  .card { background: #fff; border: 1px solid var(--border); border-radius: 22px; padding: 28px; box-shadow: 0 14px 32px -22px rgba(58,20,112,0.35); }

  /* Hero */
  .hero { position: relative; overflow: hidden; background-image: radial-gradient(circle, rgba(126,34,206,0.10) 1.6px, transparent 1.6px), linear-gradient(180deg, #FBFAFF 0%, #FFFFFF 100%); background-size: 28px 28px, auto; padding: 76px 0 64px; }
  .hero-inner { display: flex; gap: 56px; align-items: center; }
  .hero-orb-1 { position: absolute; width: 460px; height: 460px; border-radius: 999px; filter: blur(100px); opacity: 0.28; top: -180px; right: 8%; z-index: 0; }
  .hero-orb-2 { position: absolute; width: 280px; height: 280px; border-radius: 999px; filter: blur(90px); opacity: 0.18; bottom: -140px; left: 2%; z-index: 0; }
  .hero-copy { position: relative; z-index: 1; flex: 1.1; min-width: 320px; display: flex; flex-direction: column; gap: 22px; }
  .hero-copy h1 { font-size: 58px; line-height: 1.04; }
  .hero-copy p.lede { font-size: 18px; line-height: 1.5; color: var(--body-text); max-width: 520px; }
  .hero-ctas { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px; }
  .trust-row { display: flex; gap: 30px; flex-wrap: wrap; margin-top: 8px; }
  .trust-item { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--ink-soft); }
  .trust-item svg { flex-shrink: 0; }
  .hero-media { position: relative; z-index: 1; flex: 1; min-width: 320px; display: flex; align-items: center; justify-content: center; }
  .hero-video-panel { width: 100%; aspect-ratio: 4/3; border-radius: 24px; position: relative; overflow: hidden; box-shadow: 0 30px 60px -20px rgba(28,10,86,0.5); }
  .hero-video-panel .scrim { position: absolute; inset: 20px; border-radius: 16px; background: rgba(11,18,40,0.35); backdrop-filter: blur(2px); }
  .hero-video-panel .top-row { position: absolute; top: 24px; left: 24px; right: 24px; display: flex; justify-content: space-between; align-items: center; }
  .hero-video-panel .top-row img { height: 22px; }
  .hero-video-panel .badge { color: #fff; font-size: 12px; font-weight: 700; background: rgba(255,255,255,0.2); padding: 5px 10px; border-radius: 999px; }
  .hero-video-panel .play { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .hero-video-panel .play button { width: 74px; height: 74px; border-radius: 999px; background: rgba(255,255,255,0.94); border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .hero-video-panel .caption { position: absolute; bottom: 22px; left: 24px; right: 24px; color: #fff; font-size: 14px; font-weight: 700; }
  @media (max-width: 960px) { .hero-inner { flex-direction: column; } }

  /* Section header */
  .section-head { display: flex; flex-direction: column; gap: 12px; align-items: center; text-align: center; margin-bottom: 44px; }
  .section-head p { font-size: 16px; color: var(--body-text); max-width: 640px; }
  .section-head h2 { font-size: 38px; }
  @media (max-width: 640px) { .section-head h2 { font-size: 28px; } }

  /* Grids */
  .grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
  @media (max-width: 960px) { .grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .grid-3 { grid-template-columns: 1fr; } }
  @media (max-width: 560px) { .grid-4 { grid-template-columns: 1fr; } }

  .icon-tile { width: 48px; height: 48px; border-radius: 13px; background: var(--surface-tint-2); display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 22px -14px rgba(126,34,206,0.5); margin-bottom: 14px; }
  .icon-tile-grad { width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center; box-shadow: 0 14px 26px -12px rgba(58,20,112,0.55); margin-bottom: 14px; }
  .card h3 { font-size: 18px; margin-bottom: 4px; }
  .card p { font-size: 14px; line-height: 1.5; color: var(--body-text); }

  /* Who it's for / Why Kinectem sections */
  .section-alt { background: var(--surface-tint); }

  /* Pricing */
  .price-card { display: flex; flex-direction: column; gap: 18px; }
  .price-card .plan-name { font-size: 18px; font-weight: 800; }
  .price-card .plan-range { font-size: 13px; color: var(--muted-text); }
  .price-card .price { font-size: 40px; font-weight: 900; }
  .price-card .price span { font-size: 15px; font-weight: 600; color: var(--muted-text); }
  .price-card .feature-list { display: flex; flex-direction: column; gap: 9px; font-size: 13.5px; color: var(--ink-soft); }
  .price-card.featured { border: 2px solid var(--royal-purple); box-shadow: 0 28px 54px -22px rgba(58,20,112,0.45); position: relative; background-image: linear-gradient(180deg, #FFFFFF 0%, #F5F0FC 100%); transform: translateY(-6px); }
  .price-card .popular-badge { position: absolute; top: -14px; left: 28px; color: #fff; font-size: 12px; font-weight: 800; padding: 6px 14px; border-radius: 999px; }
  @media (max-width: 960px) { .price-card.featured { transform: none; } }

  /* FAQ */
  .faq-layout { display: flex; gap: 56px; flex-wrap: wrap; }
  .faq-aside { flex: 0.9; min-width: 260px; display: flex; flex-direction: column; gap: 14px; }
  .faq-aside h2 { font-size: 34px; line-height: 1.15; }
  .faq-list { flex: 1.3; min-width: 320px; display: flex; flex-direction: column; gap: 12px; }
  .faq-item { display: flex; align-items: stretch; padding: 0; overflow: hidden; cursor: pointer; }
  .faq-item .bar { width: 5px; flex-shrink: 0; }
  .faq-item .row { flex: 1; display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; gap: 16px; }
  .faq-item .row span:first-child { font-size: 15px; font-weight: 700; }
  .faq-item .row span:last-child { font-size: 20px; color: var(--royal-purple); font-weight: 700; flex-shrink: 0; }

  /* CTA band */
  .cta-band { position: relative; overflow: hidden; text-align: center; padding: 76px 0; }
  .cta-band .texture { position: absolute; inset: 0; background-image: repeating-linear-gradient(135deg, rgba(255,255,255,0.07) 0px, rgba(255,255,255,0.07) 1px, transparent 1px, transparent 26px); z-index: 0; }
  .cta-band .orb { position: absolute; top: -120px; left: -5%; width: 340px; height: 340px; border-radius: 999px; background: var(--magenta); filter: blur(110px); opacity: 0.35; z-index: 0; }
  .cta-band .inner { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 22px; }
  .cta-band h2 { font-size: 36px; color: #fff; }
  .cta-band p { font-size: 16px; color: rgba(255,255,255,0.88); max-width: 480px; }

  /* Footer */
  .footer { background: var(--navy); padding: 48px 0; }
  .footer-inner { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 24px; }
  .footer-brand { display: flex; align-items: center; gap: 16px; }
  .footer-brand img { height: 26px; }
  .footer-tagline { font-size: 13px; color: #8A82A8; }
  .footer-links { display: flex; gap: 28px; flex-wrap: wrap; }
  .footer-links span { font-size: 13px; color: #B5AED0; }
</style>
</head>
<body>

<!-- NAV -->
<header class="nav">
  <div class="wrap nav-inner">
    <a class="nav-logo" href="/">
      <img src="/_blob/1ab3d7e7b0b43281a675dbf33b6b144c" alt="Kinectem">
    </a>
    <nav class="nav-links">
      <a href="#who-its-for">Who It's For</a>
      <a href="#why-kinectem">Why Kinectem</a>
      <a href="#pricing">Pricing</a>
      <a href="#faq">FAQ</a>
      <a href="/organizers">For Organizers</a>
      <a href="/partners">Partners</a>
    </nav>
    <div class="nav-actions">
      <a href="/login" style="font-size:14px;font-weight:600;color:var(--ink-soft);">Log In</a>
      <a href="/signup" class="btn btn-primary btn-sm">Get Started</a>
    </div>
  </div>
</header>

<!-- HERO -->
<section class="hero">
  <div class="hero-orb-1 surface-grad"></div>
  <div class="hero-orb-2 glyph-grad"></div>
  <div class="wrap hero-inner">
    <div class="hero-copy">
      <h1>Every game note becomes a player's <span class="grad-text">digital legacy.</span></h1>
      <p class="lede">AI Assist turns a coach's rough notes into a polished game recap in seconds. Every rostered player gets tagged, recognized, and remembered — building a searchable storybook that grows every season.</p>
      <div class="hero-ctas">
        <a href="/signup" class="btn btn-primary">Get Started</a>
        <a href="#who-its-for" class="btn btn-outline">See Who It's For</a>
      </div>
      <div class="trust-row">
        <div class="trust-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7E22CE" stroke-width="2"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          AI-assisted recaps
        </div>
        <div class="trust-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7E22CE" stroke-width="2"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Recognition for every player
        </div>
        <div class="trust-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7E22CE" stroke-width="2"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          A storybook that grows every season
        </div>
      </div>
    </div>
    <div class="hero-media">
      <div class="hero-video-panel surface-grad">
        <div class="scrim"></div>
        <div class="top-row">
          <img src="/_blob/5c803585fad54fc472e80b7824098697" alt="Kinectem">
          <span class="badge">LIVE PREVIEW</span>
        </div>
        <div class="play">
          <button aria-label="Play the 54-second AI Assist demo">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="#5B32E8"><path d="M8 5v14l11-7z"/></svg>
          </button>
        </div>
        <div class="caption">Watch AI Assist turn game notes into a recap — 54 seconds</div>
      </div>
    </div>
  </div>
</section>

<!-- WHO IT'S FOR -->
<section id="who-its-for">
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">Built for your entire program</span>
      <h2>Who Kinectem is for</h2>
      <p>One platform, four audiences — organization admins, coaches, players, and parents.</p>
    </div>
    <div class="grid-4">

      <div class="card">
        <div class="icon-tile">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7E22CE" stroke-width="2" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h2M14 8h2M8 12h2M14 12h2M8 16h2M14 16h2"/></svg>
        </div>
        <h3>Organization Admins</h3>
        <p>Build your organization's home, add teams, and give coaches and admins the access they need.</p>
      </div>

      <div class="card">
        <div class="icon-tile">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7E22CE" stroke-width="2" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="1.5"/><path d="M9 2.5h6v3H9z"/><path d="M9 11h6M9 15h6"/></svg>
        </div>
        <h3>Coaches</h3>
        <p>AI Assist turns your game notes into a full draft right in the editor — about two minutes, not an afternoon.</p>
      </div>

      <div class="card">
        <div class="icon-tile">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7E22CE" stroke-width="2" stroke-linejoin="round"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg>
        </div>
        <h3>Players</h3>
        <p>Every game recap auto-tags each rostered player, so your storybook builds itself one game at a time.</p>
      </div>

      <div class="card">
        <div class="icon-tile">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7E22CE" stroke-width="2" stroke-linejoin="round"><path d="M12 3l7 3.2v5.4c0 4.7-3 8.3-7 9.4-4-1.1-7-4.7-7-9.4V6.2z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg>
        </div>
        <h3>Parents</h3>
        <p>Follow your athlete's team, catch every recap and highlight, and upload your own photos and videos to the game recap albums.</p>
      </div>

    </div>
  </div>
</section>

<!-- WHY KINECTEM -->
<section id="why-kinectem" class="section-alt">
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">Built different</span>
      <h2>Why Kinectem</h2>
      <p>Kinectem isn't another registration, scheduling, or communication app — it's the layer that sits on top of the ones you already use. TeamSnap, Byga, and PlayMetrics get your team to kickoff. Kinectem is where the season lives on after the final whistle.</p>
    </div>
    <div class="grid-3">

      <div class="card">
        <div class="icon-tile-grad surface-grad">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M6 4h9l3 3v13H6z"/><path d="M9 9h6M9 13h6M9 17h3"/></svg>
        </div>
        <h3>Third-party validation</h3>
        <p>Recaps are written by the organization, not self-reported — credible proof that compounds into a living archive every season.</p>
      </div>

      <div class="card">
        <div class="icon-tile-grad surface-grad">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 21c0-4 3.2-6.5 7-6.5S19 17 19 21"/></svg>
        </div>
        <h3>Digital storybook & resume</h3>
        <p>Real recaps go beyond the box score — capturing the hustle plays and turning points the stat sheet misses. Season after season, it compounds into a searchable storybook that gets more impressive every game.</p>
      </div>

      <div class="card">
        <div class="icon-tile-grad surface-grad">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M12 3l7 3.2v5.4c0 4.7-3 8.3-7 9.4-4-1.1-7-4.7-7-9.4V6.2z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg>
        </div>
        <h3>COPPA compliant by design</h3>
        <p>Parental consent, guardian controls, and under-13 data protections baked into the architecture from day one.</p>
      </div>

    </div>
  </div>
</section>

<!-- PRICING -->
<section id="pricing">
  <div class="wrap">
    <div class="section-head" style="margin-bottom: 32px;">
      <span class="eyebrow">Simple, transparent pricing</span>
      <h2>Pricing that grows with you</h2>
      <p>One annual plan per organization, priced by team count. Every tier includes the full platform. <strong style="color:var(--ink);">Your first 90 days are free.</strong></p>
    </div>
    <div class="grid-3">

      <div class="card price-card">
        <div>
          <div class="plan-name">Starter</div>
          <div class="plan-range">1–15 teams</div>
        </div>
        <div class="price">$1,000<span> / yr</span></div>
        <div class="feature-list">
          <div>✓ Up to 15 teams</div>
          <div>✓ Unlimited players & recaps</div>
          <div>✓ COPPA guardian controls</div>
        </div>
        <a href="/signup" class="btn btn-outline" style="width:100%;">Get Started</a>
      </div>

      <div class="card price-card featured">
        <span class="popular-badge surface-grad">MOST POPULAR</span>
        <div>
          <div class="plan-name">Pro</div>
          <div class="plan-range">16–40 teams</div>
        </div>
        <div class="price">$1,750<span> / yr</span></div>
        <div class="feature-list">
          <div>✓ Up to 40 teams</div>
          <div>✓ Everything in Starter</div>
          <div>✓ Unlimited players & recaps</div>
        </div>
        <a href="/signup" class="btn btn-primary" style="width:100%; justify-content:center;">Get Started</a>
      </div>

      <div class="card price-card">
        <div>
          <div class="plan-name">Elite</div>
          <div class="plan-range">41+ teams</div>
        </div>
        <div class="price">$2,500<span> / yr</span></div>
        <div class="feature-list">
          <div>✓ Unlimited teams</div>
          <div>✓ Everything in Pro</div>
          <div>✓ Priority support</div>
        </div>
        <a href="/signup" class="btn btn-outline" style="width:100%;">Get Started</a>
      </div>

    </div>
  </div>
</section>

<!-- FAQ -->
<section id="faq" class="section-alt">
  <div class="wrap faq-layout">
    <div class="faq-aside">
      <span class="eyebrow">Frequently asked</span>
      <h2>Questions? We've got answers.</h2>
      <p style="font-size:15px; color:var(--body-text);">Can't find what you're looking for? See the full FAQ page.</p>
      <a href="/faq" style="font-size:14px; font-weight:700;">View all FAQs →</a>
    </div>
    <div class="faq-list">

      <div class="card faq-item">
        <div class="bar surface-grad"></div>
        <div class="row"><span>How hard is it to set up?</span><span>+</span></div>
      </div>
      <div class="card faq-item">
        <div class="bar surface-grad"></div>
        <div class="row"><span>Is my kid actually safe on this platform?</span><span>+</span></div>
      </div>
      <div class="card faq-item">
        <div class="bar surface-grad"></div>
        <div class="row"><span>I'm a coach — I don't have time to write a 500-word game recap.</span><span>+</span></div>
      </div>
      <div class="card faq-item">
        <div class="bar surface-grad"></div>
        <div class="row"><span>Do college coaches actually look at platforms like this?</span><span>+</span></div>
      </div>
      <div class="card faq-item">
        <div class="bar surface-grad"></div>
        <div class="row"><span>Why not just keep using our club website and Facebook?</span><span>+</span></div>
      </div>
      <div class="card faq-item">
        <div class="bar surface-grad"></div>
        <div class="row"><span>Does Kinectem only work for top travel teams?</span><span>+</span></div>
      </div>
      <div class="card faq-item">
        <div class="bar surface-grad"></div>
        <div class="row"><span>What happens to all the data Kinectem captures about my kid?</span><span>+</span></div>
      </div>

    </div>
  </div>
</section>

<!-- CTA BAND -->
<section class="cta-band surface-grad">
  <div class="texture"></div>
  <div class="orb"></div>
  <div class="wrap inner">
    <h2>Ready to make your program shine?</h2>
    <p>Your first 90 days are free — no charge until then, cancel anytime.</p>
    <div class="hero-ctas" style="justify-content:center;">
      <a href="/signup" class="btn btn-outline-light" style="background:#fff; color:#5B32E8; border:none;">Get Started</a>
      <a href="#who-its-for" class="btn btn-outline-light">See Who It's For</a>
    </div>
  </div>
</section>

<!-- FOOTER -->
<footer class="footer">
  <div class="wrap footer-inner">
    <div class="footer-brand">
      <img src="/_blob/5c803585fad54fc472e80b7824098697" alt="Kinectem">
      <span class="footer-tagline">Where Programs Shine</span>
    </div>
    <div class="footer-links">
      <span>Getting Started</span>
      <span>For Organizers</span>
      <span>Privacy Policy</span>
      <span>app.kinectem.com</span>
    </div>
  </div>
</footer>

<!-- Optional: wire up the FAQ accordion -->
<script>
  document.querySelectorAll('.faq-item').forEach(function (item) {
    item.addEventListener('click', function () {
      // TODO: toggle an answer panel here once FAQ copy/answers are finalized.
      // e.g. item.classList.toggle('open'); and reveal a hidden .answer block.
    });
  });
</script>

</body>
</html>
```

---

## 5. Copy reference (for quick text edits without touching markup)

**Hero**
- H1: *Every game note becomes a player's digital legacy.*
- Subhead: *AI Assist turns a coach's rough notes into a polished game recap in seconds. Every rostered player gets tagged, recognized, and remembered — building a searchable storybook that grows every season.*
- Trust row: AI-assisted recaps · Recognition for every player · A storybook that grows every season
- Video caption: *Watch AI Assist turn game notes into a recap — 54 seconds*

**Who It's For**
- Organization Admins — Build your organization's home, add teams, and give coaches and admins the access they need.
- Coaches — AI Assist turns your game notes into a full draft right in the editor — about two minutes, not an afternoon.
- Players — Every game recap auto-tags each rostered player, so your storybook builds itself one game at a time.
- Parents — Follow your athlete's team, catch every recap and highlight, and upload your own photos and videos to the game recap albums.

**Why Kinectem**
- Positioning line: *Kinectem isn't another registration, scheduling, or communication app — it's the layer that sits on top of the ones you already use. TeamSnap, Byga, and PlayMetrics get your team to kickoff. Kinectem is where the season lives on after the final whistle.*
- Third-party validation — Recaps are written by the organization, not self-reported — credible proof that compounds into a living archive every season.
- Digital storybook & resume — Real recaps go beyond the box score — capturing the hustle plays and turning points the stat sheet misses. Season after season, it compounds into a searchable storybook that gets more impressive every game.
- COPPA compliant by design — Parental consent, guardian controls, and under-13 data protections baked into the architecture from day one.

**Pricing** — unchanged from current site (Starter $1,000/yr, Pro $1,750/yr "Most Popular", Elite $2,500/yr; 90 days free on all tiers).

**FAQ (7 shown, link to full page)**
1. How hard is it to set up?
2. Is my kid actually safe on this platform?
3. I'm a coach — I don't have time to write a 500-word game recap.
4. Do college coaches actually look at platforms like this?
5. Why not just keep using our club website and Facebook?
6. Does Kinectem only work for top travel teams?
7. What happens to all the data Kinectem captures about my kid?

**CTA band**
- H2: *Ready to make your program shine?*
- Sub: *Your first 90 days are free — no charge until then, cancel anytime.*

---

## 6. Implementation notes

- **Replace the two logo `<img src>` placeholders** (nav + footer/hero) with your real hosted logo file paths — the current values point at temporary preview URLs.
- **Hero video panel** is currently a styled placeholder with a play button. Swap in your real 54-second AI Assist demo (embed, `<video>` tag, or link to hosted player).
- **FAQ items** are static (no expand/collapse yet). The `<script>` at the bottom is a stub — add answer copy and a simple `max-height` or `display` toggle when ready.
- **Mobile nav**: links are hidden below 860px width; add a hamburger/menu toggle if you want them accessible on mobile rather than just relying on the logo + Get Started button.
- **Don't introduce new colors.** Anything purple/blue should come from `--surface-gradient` (or the named swatches); magenta (`--magenta`) should only ever appear as a small accent (max ~12% of a surface, top-left/leading corner), never as a full fill — that's a hard brand rule, not a style preference.
- **Fonts**: make sure the Google Fonts `<link>` stays in `<head>` — Inter and Poppins are both required (Poppins only shows up if you're recreating the wordmark in text rather than using the logo image).
