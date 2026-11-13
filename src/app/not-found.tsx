import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-xl font-semibold text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-ink-muted">It may have been removed, or you may not have access to it.</p>
      <p className="mt-6"><Link href="/app" className="text-brand-500 hover:underline">Go to the dashboard</Link></p>
    </main>
  );
}
