import type { SessionView } from "@timthink/server";
import { describe, expect, it } from "vitest";
import { NEW_SESSION, NOT_NOW, newSessionCommand, plannerOf, targetFor } from "./buildHandOff";

function session(overrides: Partial<SessionView>): SessionView {
  return {
    id: "s",
    title: "Session",
    cwd: "/code/repo",
    branch: null,
    firstSeen: null,
    lastActivity: null,
    live: false,
    warpFocusUrl: null,
    canResume: true,
    mayBeOpenUntracked: false,
    wroteDoc: false,
    plannedDoc: false,
    builtDoc: false,
    ...overrides,
  };
}

describe("plannerOf", () => {
  it("prefers a live planning session", () => {
    const sessions = [
      session({ id: "old", plannedDoc: true, wroteDoc: true }),
      session({ id: "live", plannedDoc: true, wroteDoc: true, live: true, warpFocusUrl: "warp://session/x" }),
      session({ id: "builder", builtDoc: true, wroteDoc: true, live: true, warpFocusUrl: "warp://session/y" }),
    ];
    expect(plannerOf(sessions)?.id).toBe("live");
  });

  it("falls back to a writer that didn't build, never to a builder", () => {
    expect(plannerOf([session({ id: "w", wroteDoc: true })])?.id).toBe("w");
    expect(plannerOf([session({ id: "b", wroteDoc: true, builtDoc: true })])).toBeNull();
  });
});

describe("targetFor", () => {
  const sessions = [session({ id: "p", plannedDoc: true })];

  it("maps the remembered kind onto this plan's sessions", () => {
    expect(targetFor("planner", sessions, false)).toBe("p");
    expect(targetFor("planner", [], false)).toBe(NEW_SESSION);
    expect(targetFor("new", sessions, true)).toBe(NEW_SESSION);
  });

  it("only offers not-now where it's allowed", () => {
    expect(targetFor("not-now", sessions, true)).toBe(NOT_NOW);
    expect(targetFor("not-now", sessions, false)).toBe(NEW_SESSION);
  });
});

describe("newSessionCommand", () => {
  it("starts in the planner's directory", () => {
    expect(newSessionCommand({ doc: "repo/plan.md" }, [session({ plannedDoc: true, cwd: "/code/repo-4" })])).toBe(
      "cd '/code/repo-4' && claude '/timthink build repo/plan.md'",
    );
  });
});
