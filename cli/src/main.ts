#!/usr/bin/env node
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig, type TimthinkConfig } from "@timthink/server";
import { ARCHIVE_USAGE, runArchive } from "./commands/archive.js";
import { runCheck } from "./commands/check.js";
import { findDocsDir } from "./commands/docsDir.js";
import { doctor, probePort } from "./commands/doctor.js";
import {
  applySteps,
  type ConfigSeed,
  describeSteps,
  type InstallPaths,
  type InstallStep,
  installPaths,
  isBlocked,
  planInstall,
  planUninstall,
  runCommand,
} from "./commands/install.js";
import { REVIEW_USAGE, type ReviewIo, resolveDocArgument, runReview } from "./commands/review.js";
import { serve } from "./commands/serve.js";
import { runStatus, STATUS_USAGE } from "./commands/status.js";
import { docUrlForRelative } from "./commands/url.js";

const USAGE = `Usage: timthink <command>

Commands:
  serve                 Start the hub on 127.0.0.1
  url <doc-path>        Print the hub URL for a doc (absolute or docsRoot-relative)
  docs-dir [--cwd dir]  Print the docs folder for the git repo containing dir (default: current directory)
  docs-root             Print the docs root
  check <doc-path>      Check a plan renders: frontmatter, question/mermaid/demo blocks and relative links
  status <doc> [status] Print a plan's status, or set it (draft, review, in-progress, done, abandoned)
  review <command>      Read and answer reviews submitted from the hub (see \`timthink review --help\`)
  archive <doc>         Archive a plan; also --list and --dry-run-auto (see \`timthink archive --help\`)
  unarchive <doc>       Keep a plan active, even when the auto rule would archive it
  doctor                Check every installed component and print fixes
  install [--apply] [--docs-root dir] [--code-root dir]
                        Set up the config, CLI shim, launchd agent, skill and Claude Code hooks (dry run unless --apply)
  uninstall [--apply]   Remove them again (dry run unless --apply)
`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function machinePaths(config: TimthinkConfig): InstallPaths {
  return installPaths({
    home: homedir(),
    repoRoot: REPO_ROOT,
    configPath: config.configPath,
    nodePath: process.execPath,
    uid: userInfo().uid,
    label: config.launchdLabel,
  });
}

function tildify(absolute: string): string {
  const home = homedir();
  return absolute === home || absolute.startsWith(`${home}/`) ? `~${absolute.slice(home.length)}` : absolute;
}

async function runSteps(command: string, steps: InstallStep[], apply: boolean): Promise<number> {
  const blocked = isBlocked(steps);
  const mode = apply ? "applying" : "dry run; nothing changes until you re-run with --apply";
  console.log(`timthink ${command} (${mode})\n`);
  console.log(describeSteps(steps));
  if (!apply) return blocked ? 1 : 0;
  await applySteps(steps, runCommand);
  console.log(`\nDone. Run \`timthink doctor\` to check everything.`);
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

const consoleIo: ReviewIo = {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
  readStdin,
  stdinIsTty: process.stdin.isTTY === true,
};

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      apply: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
      message: { type: "string", short: "m" },
      cwd: { type: "string" },
      list: { type: "boolean", default: false },
      "dry-run-auto": { type: "boolean", default: false },
      clear: { type: "boolean", default: false },
      repo: { type: "string" },
      "docs-root": { type: "string" },
      "code-root": { type: "string" },
    },
  });
  const [command, ...rest] = positionals;
  if (command === "review" && (values.help || rest.length === 0)) {
    console.log(REVIEW_USAGE);
    return values.help ? 0 : 1;
  }
  if (command === "archive" && values.help) {
    console.log(ARCHIVE_USAGE);
    return 0;
  }
  if (!command || values.help) {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  const config = loadConfig();
  switch (command) {
    case "serve":
      await serve(config);
      return 0;
    case "url": {
      const [docPath] = rest;
      if (!docPath) {
        console.error("Usage: timthink url <doc-path>");
        return 1;
      }
      console.log(docUrlForRelative(config, await resolveDocArgument(config.docsRoot, docPath)));
      return 0;
    }
    case "docs-root":
      console.log(config.docsRoot);
      return 0;
    case "docs-dir": {
      const found = await findDocsDir(config, values.cwd ?? process.cwd());
      console.log(found.dir);
      if (!found.exists) console.error(`(${found.dir} doesn't exist yet; create it when you write the first plan)`);
      return 0;
    }
    case "check": {
      const [docPath] = rest;
      if (!docPath) {
        console.error("Usage: timthink check <doc-path>");
        return 1;
      }
      return runCheck(config, docPath, { out: (text) => console.log(text), err: (text) => console.error(text) });
    }
    case "status":
      if (values.help) {
        console.log(STATUS_USAGE);
        return 0;
      }
      return runStatus(config, rest, { out: (text) => console.log(text), err: (text) => console.error(text) });
    case "review":
      return runReview(config, rest, values.message === undefined ? {} : { message: values.message }, consoleIo);
    case "archive":
    case "unarchive":
      return runArchive(
        config,
        command,
        rest,
        { list: values.list, dryRunAuto: values["dry-run-auto"], clear: values.clear, repo: values.repo },
        { out: (text) => console.log(text), err: (text) => console.error(text) },
      );
    case "doctor":
      return doctor(config, machinePaths(config), { run: runCommand, probePort, pathEnv: process.env.PATH ?? "" });
    case "install": {
      const seed: ConfigSeed = {};
      if (values["docs-root"]) seed.docsRoot = tildify(path.resolve(values["docs-root"]));
      if (values["code-root"]) seed.codeRoot = tildify(path.resolve(values["code-root"]));
      const plistEnv: Record<string, string> = process.env.TIMTHINK_CONFIG
        ? { TIMTHINK_CONFIG: process.env.TIMTHINK_CONFIG }
        : {};
      const steps = await planInstall(machinePaths(config), {
        run: runCommand,
        seed,
        pathEnv: process.env.PATH ?? "",
        env: plistEnv,
      });
      return runSteps("install", steps, values.apply);
    }
    case "uninstall":
      return runSteps("uninstall", await planUninstall(machinePaths(config), { run: runCommand }), values.apply);
    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
