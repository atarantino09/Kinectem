---
name: Public recap visitor gate
description: How logged-out visitors view game recaps and why detection keys on whoami, not the users/me 401.
---

- Logged-out visitors may view `/posts/:id` ONLY when the post is a long-form game recap (`postType === "long"`). Highlights and org posts keep the login wall even though `GET /api/v1/posts/:id` serves all published posts sessionless (openapi locked — restriction is client-side in Layout).
- Layout renders a slim visitor shell (logo + Log in + Join buttons) with a capture-phase click gate on `<main>`: any interactive click routes to `/login?signup=1&gate=recap&returnTo=<path>`. LoginPage shows the invite banner on `gate=recap`.
- **Why whoami:** visitor detection must key on `whoami` returning `{authenticated:false}` (immediate 200), NOT on the users/me 401 — other mounts of the shared users/me query use default react-query retries, so the error arrives seconds late and the wrong chrome flashes.
- Layout peeks at the post via the SAME query key as PostPage (`["post", id]`) so it costs no extra fetch; the login-redirect effect must include that query's loading/data in its deps or the deny-path never redirects.
- `returnTo` is sanitized with `safeInternalPath` in BOTH SignInForm and SignUpForm (open-redirect guard). Keep it that way for any new auth-return flows.
