import { Link } from "wouter";
import { Trophy } from "lucide-react";

// Task #359 — privacy policy with the COPPA-required Direct Notice
// section linked. Hand-authored so the wording stays human-reviewed
// when the consent notice version bumps.
export default function PrivacyPolicyPage() {
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
          <Link href="/coppa-notice" className="text-sm text-blue-600 hover:underline">
            COPPA notice for parents
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6 text-slate-800">
        <h1 className="font-black tracking-tight text-3xl">Privacy policy</h1>
        <p className="text-sm text-slate-500">Last updated: 2026-05-06.</p>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">Operator contact</h2>
          <p>
            Kinectem is operated by Kinectem, Inc., 2261 Market Street
            #4567, San Francisco, CA 94114. Reach the privacy team at{" "}
            <a className="text-blue-600 hover:underline" href="mailto:privacy@kinectem.com">
              privacy@kinectem.com
            </a>{" "}
            or +1 (415) 555-0137.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">What we collect</h2>
          <p>
            When you create a Kinectem account we collect your name, email
            address, sport, jersey number, and date of birth. Coaches and
            organization admins may add you to a roster, which links you to
            your team and the recaps that team's coaches publish. We store the
            content you publish (recaps, highlights, comments, direct messages)
            and the assets you upload.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">Children under 13 (COPPA)</h2>
          <p>
            Kinectem complies with the Children's Online Privacy Protection
            Act. Any user we know to be under 13 cannot create an account
            without verifiable parental consent obtained through our two-step
            "email plus" flow. Under-13 accounts are subject to strict data
            minimization: no direct messages, no comments, no public profile
            beyond first initial and jersey number, no follower discovery, and
            all photo uploads have GPS / camera metadata stripped before
            storage. Parents can revoke consent at any time from the link we
            email them at finalization, which immediately disables the
            account.
          </p>
          <p>
            Read the full direct notice to parents at{" "}
            <Link href="/coppa-notice" className="text-blue-600 hover:underline">
              /coppa-notice
            </Link>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">How we share data</h2>
          <p>
            We share your data with the people you publish to (your team,
            your organization, your followers) and with the following
            service providers, each contractually bound to use the data
            only to provide their service to Kinectem:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Database hosting (Postgres / Replit infrastructure).</li>
            <li>Transactional email delivery.</li>
            <li>Object storage for uploaded photos and videos.</li>
          </ul>
          <p>
            We do <strong>not</strong> sell personal information. We do{" "}
            <strong>not</strong> show third-party advertising. We do{" "}
            <strong>not</strong> share data with marketing, analytics, or
            ad-tech vendors. We may disclose data when required by law or
            to protect the safety of a child.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">Your rights</h2>
          <p>
            You can edit or delete your account at any time. Guardians of
            an under-13 account can export the child's data, request
            account deletion (locks immediately, hard-deletes after a
            30-day cooling-off window), or revoke consent — all from the
            Family page. You can also email{" "}
            <a className="text-blue-600 hover:underline" href="mailto:privacy@kinectem.com">
              privacy@kinectem.com
            </a>{" "}
            with any data-access or deletion request, including for an
            under-13 account. We respond within 10 business days.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-bold text-xl">Photos of minors</h2>
          <p>
            If you are the guardian of a child whose photo appears in a
            recap or highlight without your approval, open the post and
            use the <strong>Request takedown</strong> link, or email
            privacy@kinectem.com. The post is hidden while we review the
            request.
          </p>
        </section>
      </main>
    </div>
  );
}
