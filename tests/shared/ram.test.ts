import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("os", () => ({
  freemem: vi.fn(),
}));

import { freemem } from "os";
import { computeConcurrency } from "../../src/shared/ram.js";

const mockedFreemem = vi.mocked(freemem);

describe("computeConcurrency", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("computes conservative mode concurrency with cap 8", () => {
    mockedFreemem.mockReturnValue(10 * 1024 * 1024 * 1024);

    const result = computeConcurrency("conservative");

    expect(result.concurrency).toBe(8);
  });

  it("computes auto mode concurrency with cap 16", () => {
    mockedFreemem.mockReturnValue(10 * 1024 * 1024 * 1024);

    const result = computeConcurrency("auto");

    expect(result.concurrency).toBe(16);
  });

  it("returns requested manual concurrency when within limit", () => {
    mockedFreemem.mockReturnValue(2 * 1024 * 1024 * 1024);

    const result = computeConcurrency("manual", 5);

    expect(result.concurrency).toBe(5);
  });

  it("throws when manual concurrency would exceed free RAM budget", () => {
    mockedFreemem.mockReturnValue(1_000 * 1024 * 1024);

    expect(() => computeConcurrency("manual", 5)).toThrow(
      /--concurrency 5 would use ~1000MB but only 1000MB RAM is free/
    );
  });

  it("never returns less than one worker", () => {
    mockedFreemem.mockReturnValue(50 * 1024 * 1024);

    const result = computeConcurrency("conservative");

    expect(result.concurrency).toBe(1);
  });
});
