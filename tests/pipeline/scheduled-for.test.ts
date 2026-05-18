import { describe, it, expect } from "vitest";
import { nextCronRun } from "../../src/modules/pipeline/scheduled-for.js";

describe("nextCronRun", () => {
  it("returns a future date for a valid cron expression", () => {
    const next = nextCronRun("0 2 * * 0"); // every Sunday at 2am
    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns next run after the provided 'after' date", () => {
    const after = new Date("2026-01-01T00:00:00Z");
    const next = nextCronRun("0 2 * * 0", after);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
  });

  it("handles every-minute cron expression", () => {
    const next = nextCronRun("* * * * *");
    expect(next).toBeInstanceOf(Date);
  });
});
