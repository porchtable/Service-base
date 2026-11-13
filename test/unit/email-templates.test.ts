import { describe, expect, it } from "vitest";
import { estimateEmail, escapeHtml } from "@/server/email/templates";

describe("email templates", () => {
  it("escapes untrusted content", () => {
    expect(escapeHtml(`<script>"x"&'`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;");
    const e = estimateEmail({
      kind: "delivery", orgName: "A&B <Heating>", orgPhone: null, customerName: "<img src=x>", estimateNumber: 1001,
      title: "Fix \"it\"", totalCents: 44135, expiresAt: "2026-12-12T00:00:00Z", timeZone: "UTC", link: "https://x.test/e/abc",
    });
    expect(e.html).not.toContain("<img src=x>");
    expect(e.html).not.toContain("<Heating>");
    expect(e.html).toContain("$441.35");
    expect(e.text).toContain("https://x.test/e/abc");
    expect(e.subject).toContain("A&B <Heating>"); // subject is plain text
  });
});
