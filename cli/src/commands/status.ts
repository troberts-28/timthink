import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalStatus,
  FrontmatterEditError,
  KNOWN_STATUSES,
  parseFrontmatter,
  setFrontmatterStatus,
  type TimthinkConfig,
  writeFileAtomic,
} from "@timthink/server";
import { resolveDocArgument } from "./review.js";

export const STATUS_USAGE = `Usage: timthink status <doc> [status]

Prints a plan's status, or sets it. Status is one of ${KNOWN_STATUSES.join(", ")}.
Common synonyms (pending, wip, complete, cancelled, …) are mapped to these.
"approved" can't be set here: only the user approves, by submitting a review.`;

export interface StatusIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

export async function runStatus(config: TimthinkConfig, args: readonly string[], io: StatusIo): Promise<number> {
  const [docArg, requested] = args;
  if (!docArg) {
    io.err(STATUS_USAGE);
    return 1;
  }
  const docPath = await resolveDocArgument(config.docsRoot, docArg);
  const absolute = path.join(config.docsRoot, docPath);
  const raw = await readFile(absolute, "utf8").catch(() => null);
  if (raw === null) {
    io.err(`No plan at ${docPath}`);
    return 1;
  }
  const current = parseFrontmatter(raw).data.status;
  if (requested === undefined) {
    io.out(typeof current === "string" ? current : "(no status)");
    return 0;
  }
  const status = canonicalStatus(requested);
  if (!status || !(KNOWN_STATUSES as readonly string[]).includes(status)) {
    io.err(`"${requested}" isn't a status. Use one of ${KNOWN_STATUSES.join(", ")}.`);
    return 1;
  }
  if (status === "approved") {
    io.err("Only the user approves a plan, by submitting a review in the hub.");
    return 1;
  }
  if (config.readOnly) {
    io.err("timthink is read-only (readOnly in the config, or TIMTHINK_READONLY)");
    return 1;
  }
  try {
    const updated = setFrontmatterStatus(raw, status);
    if (updated !== raw) await writeFileAtomic(absolute, updated);
    io.out(`${docPath}: ${status}`);
    return 0;
  } catch (error) {
    if (!(error instanceof FrontmatterEditError)) throw error;
    io.err(error.message);
    return 1;
  }
}
