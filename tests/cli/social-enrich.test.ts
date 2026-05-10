import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/storage/runs.js", () => ({
  getRunById: vi.fn(),
}));

vi.mock("../../src/modules/social-enrich/index.js", () => ({
  runSocialEnrich: vi.fn(),
}));

import { socialEnrichCommand } from "../../src/cli/commands/social-enrich.js";
import { getRunById } from "../../src/storage/runs.js";
import { runSocialEnrich } from "../../src/modules/social-enrich/index.js";

const RUN_ID = "94fae3e7-070c-41de-a7c9-3e6875818a83";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.mocked(getRunById).mockResolvedValue({ id: RUN_ID } as never);
  vi.mocked(runSocialEnrich).mockResolvedValue({
    loaded: 1,
    selected: 1,
    processed: 1,
    skippedFresh: 0,
    errors: 0,
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
});
