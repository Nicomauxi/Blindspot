import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/storage/runs.js", () => ({
  getRunById: vi.fn(),
  createSocialEnrichRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
}));

vi.mock("../../src/modules/social-enrich/index.js", () => ({
  runSocialEnrich: vi.fn(),
}));

import { socialEnrichCommand } from "../../src/cli/commands/social-enrich.js";
import { completeRun, createSocialEnrichRun, failRun, getRunById } from "../../src/storage/runs.js";
import { runSocialEnrich } from "../../src/modules/social-enrich/index.js";

const RUN_ID = "94fae3e7-070c-41de-a7c9-3e6875818a83";
const SOCIAL_RUN_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.mocked(getRunById).mockResolvedValue({ id: RUN_ID } as never);
  vi.mocked(createSocialEnrichRun).mockResolvedValue({ id: SOCIAL_RUN_ID } as never);
  vi.mocked(completeRun).mockResolvedValue(undefined);
  vi.mocked(failRun).mockResolvedValue(undefined as never);
  vi.mocked(runSocialEnrich).mockResolvedValue({
    loaded: 1,
    selected: 1,
    processed: 1,
    skippedFresh: 0,
    errors: 0,
    blocked: 0,
  });
});

describe("socialEnrichCommand", () => {
  it("requires exactly one of --run or --all", async () => {
    await socialEnrichCommand({ all: false, limit: 10, force: false });
    expect(process.exit).toHaveBeenCalledWith(1);

    vi.clearAllMocks();
    await socialEnrichCommand({ run: RUN_ID, all: true, limit: 10, force: false });
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("validates run existence and forwards parsed args", async () => {
    await socialEnrichCommand({ run: RUN_ID, all: false, limit: "3", force: false });

    expect(getRunById).toHaveBeenCalledWith(RUN_ID);
    expect(runSocialEnrich).toHaveBeenCalledWith({
      run: RUN_ID,
      limit: 3,
      force: false,
    });
  });

  it("supports --all without run lookup", async () => {
    await socialEnrichCommand({ all: true, limit: "2", force: true });

    expect(getRunById).not.toHaveBeenCalled();
    expect(runSocialEnrich).toHaveBeenCalledWith({
      all: true,
      limit: 2,
      force: true,
    });
  });

  it("crea un run kind social y lo completa con las stats", async () => {
    await socialEnrichCommand({ all: true, limit: "2", force: true });

    expect(createSocialEnrichRun).toHaveBeenCalledWith({ scope: "all", limit: 2, force: true });
    expect(completeRun).toHaveBeenCalledWith(
      SOCIAL_RUN_ID,
      expect.objectContaining({
        command: "social-enrich",
        loaded: 1,
        selected: 1,
        processed: 1,
        errors: 0,
      })
    );
    expect(failRun).not.toHaveBeenCalled();
  });

  it("marca el run como fallido y propaga si el social-enrich revienta", async () => {
    vi.mocked(runSocialEnrich).mockRejectedValue(new Error("browser murió"));

    await expect(socialEnrichCommand({ all: true, limit: "2", force: false })).rejects.toThrow("browser murió");
    expect(failRun).toHaveBeenCalledWith(SOCIAL_RUN_ID, "browser murió", expect.any(Number));
    expect(completeRun).not.toHaveBeenCalled();
  });
});
