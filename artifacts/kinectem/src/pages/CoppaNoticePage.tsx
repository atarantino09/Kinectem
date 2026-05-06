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
            <li>Public profile fields beyond first initial + jersey number.</li>
            <li>Direct messaging with anyone.</li>
            <li>Posting comments or new content visible to strangers.</li>
            <li>Following users, organizations, or teams in search.</li>
          </ul>
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
