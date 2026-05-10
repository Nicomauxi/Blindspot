import { describe, expect, it } from "vitest";
import { parseCopyrightYear } from "../../../src/modules/enrichment/parsers/copyright-year.js";

describe("parseCopyrightYear", () => {
  it("detects compact copyright year as outdated", () => {
    expect(parseCopyrightYear("<footer>©2019 Test</footer>")).toEqual({
      year: 2019,
      outdated: true,
    });
  });

  it("detects html entity copyright year as current", () => {
    expect(parseCopyrightYear("<footer>&copy; 2021 Test</footer>")).toEqual({
      year: 2021,
      outdated: false,
    });
  });

  it("uses the most recent year from a copyright range", () => {
    expect(parseCopyrightYear("<footer>Copyright 2019-2023 Test</footer>")).toEqual({
      year: 2023,
      outdated: false,
    });
  });

  it("ignores years outside copyright context", () => {
    expect(parseCopyrightYear("<main>Desde 1998 en Montevideo</main>")).toEqual({
      year: null,
      outdated: false,
    });
  });
});
