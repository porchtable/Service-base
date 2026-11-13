import { describe, expect, it } from "vitest";
import { utcToZonedLocal, zonedLocalToUtc } from "@/lib/timezone";

describe("time zone conversion", () => {
  it("converts wall-clock times in a zone to UTC and back, across DST", () => {
    expect(zonedLocalToUtc("2026-01-15T09:30", "America/New_York").toISOString()).toBe("2026-01-15T14:30:00.000Z");
    expect(zonedLocalToUtc("2026-07-15T09:30", "America/New_York").toISOString()).toBe("2026-07-15T13:30:00.000Z");
    expect(zonedLocalToUtc("2026-07-15T09:30", "America/Phoenix").toISOString()).toBe("2026-07-15T16:30:00.000Z");
    expect(utcToZonedLocal(new Date("2026-07-15T13:30:00Z"), "America/New_York")).toBe("2026-07-15T09:30");
    expect(utcToZonedLocal(new Date("2026-01-15T14:30:00Z"), "UTC")).toBe("2026-01-15T14:30");
  });
});
