import { isDeepStrictEqual } from "node:util";

export const HOOK_SCRIPT_MARKER = "timthink-hook.mjs";
const HOOK_TIMEOUT_SECONDS = 5;

type JsonObject = Record<string, unknown>;

interface HookCommand {
  type: "command";
  command: string;
  timeout: number;
}

interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}

const HOOK_EVENTS = [
  { event: "SessionStart", argument: "session-start", matcher: null },
  { event: "SessionEnd", argument: "session-end", matcher: null },
  { event: "PostToolUse", argument: "post-tool-use", matcher: "Write|Edit|MultiEdit" },
] as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function shellQuote(value: string): string {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function hookCommand(launcherPath: string, scriptPath: string, argument: string): string {
  return `${shellQuote(launcherPath)} ${shellQuote(scriptPath)} ${argument} || true`;
}

export function timthinkHookGroups(launcherPath: string, scriptPath: string): Record<string, HookGroup> {
  return Object.fromEntries(
    HOOK_EVENTS.map(({ event, argument, matcher }) => {
      const hooks: HookCommand[] = [
        { type: "command", command: hookCommand(launcherPath, scriptPath, argument), timeout: HOOK_TIMEOUT_SECONDS },
      ];
      return [event, matcher ? { matcher, hooks } : { hooks }];
    }),
  );
}

function isTimthinkHook(hook: unknown): boolean {
  return isObject(hook) && typeof hook.command === "string" && hook.command.includes(HOOK_SCRIPT_MARKER);
}

function withoutTimthinkHooks(groups: readonly unknown[], keep: HookGroup | null): unknown[] {
  const result: unknown[] = [];
  for (const group of groups) {
    if (keep && isDeepStrictEqual(group, keep)) {
      result.push(group);
      continue;
    }
    if (!isObject(group) || !Array.isArray(group.hooks) || !group.hooks.some(isTimthinkHook)) {
      result.push(group);
      continue;
    }
    const remaining = group.hooks.filter((hook) => !isTimthinkHook(hook));
    if (remaining.length > 0) result.push({ ...group, hooks: remaining });
  }
  return result;
}

export class SettingsParseError extends Error {}

function parseSettings(text: string | null): JsonObject {
  if (text === null || text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SettingsParseError(`Claude settings are not valid JSON: ${String(error)}`);
  }
  if (!isObject(parsed)) throw new SettingsParseError("Claude settings must be a JSON object");
  if (parsed.hooks !== undefined && !isObject(parsed.hooks)) {
    throw new SettingsParseError('Claude settings "hooks" must be an object');
  }
  return parsed;
}

function serialise(settings: JsonObject): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function eventGroups(hooks: JsonObject, event: string): unknown[] {
  const groups = hooks[event];
  if (groups === undefined) return [];
  if (!Array.isArray(groups)) throw new SettingsParseError(`Claude settings "hooks.${event}" must be an array`);
  return groups;
}

export function addTimthinkHooks(text: string | null, launcherPath: string, scriptPath: string): string {
  const settings = parseSettings(text);
  const hooks: JsonObject = isObject(settings.hooks) ? { ...settings.hooks } : {};
  for (const [event, desired] of Object.entries(timthinkHookGroups(launcherPath, scriptPath))) {
    const groups = withoutTimthinkHooks(eventGroups(hooks, event), desired);
    if (!groups.some((group) => isDeepStrictEqual(group, desired))) groups.push(desired);
    hooks[event] = groups;
  }
  const merged = { ...settings, hooks };
  return text !== null && isDeepStrictEqual(merged, settings) ? text : serialise(merged);
}

export function removeTimthinkHooks(text: string | null): string | null {
  if (text === null) return null;
  const settings = parseSettings(text);
  if (!isObject(settings.hooks)) return text;
  const hooks: JsonObject = { ...settings.hooks };
  let changed = false;
  for (const { event } of HOOK_EVENTS) {
    const before = eventGroups(hooks, event);
    const after = withoutTimthinkHooks(before, null);
    if (after.length === before.length && after.every((group, position) => group === before[position])) continue;
    changed = true;
    if (after.length > 0) hooks[event] = after;
    else delete hooks[event];
  }
  if (!changed) return text;
  const { hooks: _removed, ...rest } = settings;
  return serialise(Object.keys(hooks).length > 0 ? { ...settings, hooks } : rest);
}

export type HookInstallState = "installed" | "outdated" | "missing";

export function timthinkHookState(text: string | null, launcherPath: string, scriptPath: string): HookInstallState {
  const settings = parseSettings(text);
  const hooks: JsonObject = isObject(settings.hooks) ? settings.hooks : {};
  const desired = Object.entries(timthinkHookGroups(launcherPath, scriptPath));
  const installed = desired.every(([event, group]) =>
    eventGroups(hooks, event).some((existing) => isDeepStrictEqual(existing, group)),
  );
  if (installed) return "installed";
  const anyTimthink = HOOK_EVENTS.some(({ event }) =>
    eventGroups(hooks, event).some(
      (group) => isObject(group) && Array.isArray(group.hooks) && group.hooks.some(isTimthinkHook),
    ),
  );
  return anyTimthink ? "outdated" : "missing";
}
