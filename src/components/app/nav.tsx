"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/components/ui/cn";

export interface NavItem {
  href: string;
  label: string;
}

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`));
  const links = (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cn(
              "block rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium",
              isActive(item.href) ? "bg-brand-700 text-white" : "text-brand-100 hover:bg-brand-800 hover:text-white",
            )}
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <button
        type="button"
        className="rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 lg:hidden"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Close menu" : "Menu"}
      </button>
      <nav aria-label="Main" className="hidden lg:block">{links}</nav>
      {open ? (
        <nav id="mobile-nav" aria-label="Main" className="absolute inset-x-0 top-14 z-40 border-b border-brand-800 bg-brand-900 px-4 pb-4 lg:hidden">
          {links}
        </nav>
      ) : null}
    </>
  );
}
