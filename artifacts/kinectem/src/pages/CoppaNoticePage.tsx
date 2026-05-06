import { Link } from "wouter";
import { Trophy } from "lucide-react";

// Task #359 — the COPPA direct notice to parents. Mirrors the verbatim
// notice text the consent-flow API serves so a parent who lands here
// without an email link sees exactly the same wording. Keep this in
// sync with `CONSENT_NOTICE_TEXT` in artifacts/api-server/src/lib/coppa.ts.
export default function CoppaNoticePage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white flex items-center justify-center">
              <Trophy className="w-4 h-4" />
            </div>
            <span className="font-black text-xl tracking-tight text-slate-900">
              Kinect<span className="brand-gradient-text">em</span>
            </span>
          </Link>
          <Link href="/privacy-policy" className="text-sm text-blue-600 hover:underline">
            Full privacy policy
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6 text-slate-800">
        <h1 className="font-black tracking-tight text-3xl">Direct notice to parents</h1>
        <p className="text-sm text-slate-500">
          This notice explains what Kinectem collects from your child and what
          you can do about it. The same notice is emailed to you when your
          child signs up under age 13.
        </p>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">Operator contact</h2>
          <p>
            Kinectem is operated by Kinectem, Inc. You can reach our
            privacy team about anything in this notice:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Mail: Kinectem, Inc., 2261 Market Street #4567, San Francisco, CA 94114</li>
            <li>
              Email:{" "}
              <a className="text-blue-600 hover:underline" href="mailto:privacy@kinectem.com">
                privacy@kinectem.com
              </a>
            </li>
            <li>Phone: +1 (415) 555-0137</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">What we collect</h2>
          <p>
            Your child's first name, last name, sport, jersey number, and date
            of birth. Their date of birth is used only to determine when the
            COPPA limits no longer apply and to age-gate features.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">What an under-13 account can do</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Sign in and view their team roster, recaps, and highlights.</li>
            <li>
              Be tagged in posts created by coaches and teammates (you can
              require per-tag approval at any time from your Family page).
            </li>
            <li>
              Upload a profile photo. We automatically strip GPS / location and
              other camera metadata before storing minor uploads.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">What is disabled</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              A discoverable public profile. Under-13 profiles are visible
              only to the user, the linked guardian, platform
              administrators, organization admins of teams the child is on,
              and approved followers.
            </li>
            <li>Public profile fields beyond first initial + jersey number.</li>
            <li>
              Direct messaging with anyone outside the allowlist you control
              from your Family page.
            </li>
            <li>Posting comments or new content visible to strangers.</li>
            <li>Following users, organizations, or teams in search.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">Third-party data sharing</h2>
          <p>
            We do <strong>not</strong> sell your child's personal information,
            we do <strong>not</strong> show third-party advertising to under-13
            accounts, and we do <strong>not</strong> share your child's data
            with marketing, analytics, or ad-tech vendors. We share the
            minimum data necessary with the following service providers,
            each contractually bound to use the data only to provide their
            service to Kinectem:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Database hosting (Postgres / Replit infrastructure).</li>
            <li>Transactional email delivery (consent + account notifications).</li>
            <li>Object storage for uploaded photos and videos.</li>
          </ul>
          <p>
            We may disclose data when required by law (e.g. lawful
            subpoena) or to protect the safety of a child.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">Your rights</h2>
          <p>
            You can review the personal information we have collected from
            your child, request its deletion, or refuse to permit further
            collection or use. From your Family page you can{" "}
            <strong>export</strong> the data, request{" "}
            <strong>deletion</strong> (locks the account immediately and
            hard-deletes after a 30-day cooling-off window), or{" "}
            <strong>revoke</strong> consent. You can also email
            privacy@kinectem.com with any request — we respond within 10
            business days.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">How we get your consent</h2>
          <p>
            We use the FTC-approved "email plus" method: when your child signs
            up, we email you a notice link with a checkbox. After you submit it,
            we wait briefly and email you a second confirmation link. The
            account stays disabled until you open the second link.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">Revoking consent</h2>
          <p>
            You can revoke consent at any time. Open the "Revoke consent" link
            in the email we send you at finalization (or use the Revoke button
            on your Family page once you sign in). Revocation immediately
            disables the account.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">Contact</h2>
          <p>
            Email{" "}
            <a className="text-blue-600 hover:underline" href="mailto:privacy@kinectem.com">
              privacy@kinectem.com
            </a>{" "}
            with any question or to request data access or deletion.
          </p>
        </section>
      </main>
    </div>
  );
}
