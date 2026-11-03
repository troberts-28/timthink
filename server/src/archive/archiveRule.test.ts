import { describe, expect, it } from "vitest";
import { DEFAULT_ARCHIVE_SETTINGS } from "../config.js";
import { type ArchiveRuleInput, archiveState } from "./archiveRule.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 3, 12);

function input(overrides: Partial<ArchiveRuleInput> = {}): ArchiveRuleInput {
  return {
    status: "draft",
    mtime: NOW - DAY_MS,
    manual: null,
    needsUser: false,
    settings: DEFAULT_ARCHIVE_SETTINGS,
    now: NOW,
    ...overrides,
  };
}

describe("archiveState", () => {
  it("keeps recently edited docs active", () => {
    expect(archiveState(input())).toEqual({ state: "active" });
    expect(archiveState(input({ mtime: NOW - 21 * DAY_MS }))).toEqual({ state: "active" });
  });

  it("auto-archives docs not edited for longer than staleAfterDays", () => {
    expect(archiveState(input({ mtime: NOW - 34 * DAY_MS }))).toEqual({
      state: "auto",
      reason: "Not edited for 34 days",
    });
  });

  it("auto-archives finished docs after finishedAfterDays", () => {
    expect(archiveState(input({ status: "done", mtime: NOW - 5 * DAY_MS }))).toEqual({
      state: "auto",
      reason: "Done 5 days ago",
    });
    expect(archiveState(input({ status: "abandoned", mtime: NOW - 4 * DAY_MS })).reason).toBe("Abandoned 4 days ago");
    expect(archiveState(input({ status: "completed", mtime: NOW - 4 * DAY_MS })).state).toBe("auto");
    expect(archiveState(input({ status: "done", mtime: NOW - 2 * DAY_MS })).state).toBe("active");
  });

  it("never auto-archives docs in review or in progress", () => {
    for (const status of ["review", "in-progress", "needs review", "wip", "active"]) {
      expect(archiveState(input({ status, mtime: NOW - 90 * DAY_MS })).state).toBe("active");
    }
  });

  it("keeps docs that need the user active", () => {
    expect(archiveState(input({ needsUser: true, mtime: NOW - 90 * DAY_MS })).state).toBe("active");
  });

  it("revives an auto-archived doc when it is edited", () => {
    const stale = input({ mtime: NOW - 40 * DAY_MS });
    expect(archiveState(stale).state).toBe("auto");
    expect(archiveState({ ...stale, mtime: NOW - 60_000 }).state).toBe("active");
  });

  it("keeps a manually archived doc archived even after an edit", () => {
    const manual = { kind: "archived" as const, at: new Date(NOW - 2 * DAY_MS).toISOString() };
    expect(archiveState(input({ manual, mtime: NOW }))).toEqual({
      state: "manual",
      reason: "Archived by you 2 days ago",
    });
    expect(archiveState(input({ manual, needsUser: true })).state).toBe("manual");
  });

  it("lets keep-active override the auto rule", () => {
    const manual = { kind: "keep-active" as const, at: new Date(NOW - 50 * DAY_MS).toISOString() };
    expect(archiveState(input({ manual, mtime: NOW - 90 * DAY_MS, status: "done" })).state).toBe("active");
  });

  it("does nothing automatically when auto is off", () => {
    const settings = { ...DEFAULT_ARCHIVE_SETTINGS, auto: false };
    expect(archiveState(input({ settings, mtime: NOW - 90 * DAY_MS })).state).toBe("active");
  });

  it("honours custom thresholds", () => {
    const settings = { auto: true, staleAfterDays: 7, finishedAfterDays: 0 };
    expect(archiveState(input({ settings, mtime: NOW - 8 * DAY_MS })).state).toBe("auto");
    expect(archiveState(input({ settings, status: "done", mtime: NOW - 60_000 })).state).toBe("auto");
  });
});
