import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Estimating for field-service contractors" };

/** Public information page. Describes only features that exist in this codebase. */
const FEATURES = [
  { title: "Customers and jobs", body: "Keep customer records, service addresses, equipment details, technician notes, appointments and private job photos in one place." },
  { title: "Your own price book", body: "Every price comes from the services and rates your company maintains. Amounts are stored to the cent." },
  { title: "AI-assisted drafts", body: "Technicians describe what they found; AI drafts line items and matches them to your price book. Anything without an approved price is flagged for review." },
  { title: "Review before sending", body: "Only owners and admins can approve and send. Totals and tax are calculated on the server from your company settings." },
  { title: "Customer approvals", body: "Customers open a secure, expiring link to accept or decline. Every sent version is preserved exactly as sent." },
  { title: "Automatic follow-ups", body: "Scheduled email reminders for undecided estimates stop automatically once the customer responds or the estimate expires." },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="bg-brand-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-3 px-4 py-4 sm:px-6">
          <Link href="/login" className="text-sm font-medium text-brand-100 hover:text-white">Sign in</Link>
          <LinkButton href="/register" variant="accent" size="sm">Create account</LinkButton>
        </div>
        <div id="main" className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-400">For HVAC and field-service contractors</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
            Turn technician notes into reviewed, price-book-accurate estimates.
          </h1>
          <p className="mt-5 max-w-2xl text-base text-brand-100 sm:text-lg">
            Capture the job, let AI draft the estimate from your own approved prices, review it, send a secure link, and let reminders follow up for you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/register" variant="accent">Create an account</LinkButton>
            <LinkButton href="/login" variant="secondary">Sign in</LinkButton>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-14 sm:px-6">
        <h2 className="text-xl font-semibold text-ink">What it does</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
              <div className="mb-3 h-1 w-10 rounded bg-accent-400" aria-hidden />
              <h3 className="font-semibold text-ink">{f.title}</h3>
              <p className="mt-2 text-sm text-ink-muted">{f.body}</p>
            </div>
          ))}
        </div>
        <h2 className="mt-14 text-xl font-semibold text-ink">Built for teams</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-ink-muted">
          <li>Owner, admin and technician roles with separate permissions.</li>
          <li>Each company&apos;s data is isolated at the database level.</li>
          <li>Belong to more than one company and switch between them explicitly.</li>
        </ul>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-ink-subtle sm:px-6">Accepted estimates are customer approvals, not collected payments.</div>
      </footer>
    </div>
  );
}
