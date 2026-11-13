import type { Metadata, Viewport } from "next";
import "./globals.css";
import { brand } from "@/config/brand";

export const metadata: Metadata = {
  title: { template: brand.productName ? `%s · ${brand.productName}` : "%s", default: "Estimating for field-service contractors" },
  description: "Estimating, approvals and follow-ups for field-service contractors.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a1433" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
