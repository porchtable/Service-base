import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-brand-900">
      <div className="px-4 py-4 sm:px-6">
        <Link href="/" className="text-sm font-medium text-brand-100 hover:text-white">← Home</Link>
      </div>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-16">
        <div className="w-full max-w-md rounded-[var(--radius-card)] bg-surface p-6 shadow-xl sm:p-8">{children}</div>
      </main>
    </div>
  );
}
