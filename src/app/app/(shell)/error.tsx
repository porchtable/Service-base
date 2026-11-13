"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Generic error boundary: never shows internals; the digest correlates with server logs. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-muted">The page could not be loaded. Your data has not been changed.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
      <div className="mt-6"><Button onClick={reset}>Try again</Button></div>
    </div>
  );
}
