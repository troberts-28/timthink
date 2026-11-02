import { stat } from "node:fs/promises";
import path from "node:path";
import type { TimthinkConfig } from "../config.js";
import type { GithubRepo } from "../docs/types.js";
import { isInside, isRealPathInsideAny } from "../safePath.js";
import { parseCodeRef } from "./codeRef.js";
import { GitFileIndexCache } from "./fileIndex.js";
import { type CheckoutHead, readCheckoutHead, readGithubRemote } from "./git.js";
import { hostCheckout } from "./repoCheckouts.js";

const MAX_MATCHES = 20;
const CHECKOUT_HEAD_TTL_MS = 5_000;

export interface SessionCheckoutHint {
  worktree: string;
}

export interface CheckoutRequest {
  repo: string;
  docBranch?: string | null;
  session?: SessionCheckoutHint | null;
}

export interface CodeMatch {
  relPath: string;
  absPath: string;
  line: number | null;
  col: number | null;
  githubUrl: string | null;
}

export type CodeResolution =
  | { status: "resolved"; checkout: string; matches: CodeMatch[] }
  | { status: "not-found"; checkout: string }
  | { status: "no-checkout" };

async function isDirectory(candidate: string): Promise<boolean> {
  return (await stat(candidate).catch(() => null))?.isDirectory() ?? false;
}

async function isFile(candidate: string): Promise<boolean> {
  return (await stat(candidate).catch(() => null))?.isFile() ?? false;
}

export function githubBlobUrl(github: GithubRepo, relPath: string, line: number | null): string {
  const encodedPath = relPath.split("/").map(encodeURIComponent).join("/");
  const anchor = line ? `#L${line}` : "";
  return `https://github.com/${github.owner}/${github.repo}/blob/HEAD/${encodedPath}${anchor}`;
}

export function allowedCodeRoots(config: TimthinkConfig): string[] {
  const roots = [config.codeRoot];
  for (const override of Object.values(config.repos)) {
    if (override.host) roots.push(override.host);
    if (override.worktrees) roots.push(path.dirname(override.worktrees));
  }
  return roots;
}

export class CodeService {
  private readonly fileIndex = new GitFileIndexCache();
  private readonly githubByCheckout = new Map<string, Promise<GithubRepo | null>>();
  private readonly headByWorktree = new Map<string, { readAt: number; head: Promise<CheckoutHead | null> }>();

  constructor(private readonly config: TimthinkConfig) {}

  async resolveCheckout({ repo, docBranch, session }: CheckoutRequest): Promise<string | null> {
    if (session && docBranch) {
      const head = await this.currentHead(session.worktree);
      if (head?.branch === docBranch) return head.toplevel;
    }
    const host = hostCheckout(this.config, repo);
    return (await isDirectory(host)) ? host : null;
  }

  private async currentHead(worktree: string): Promise<CheckoutHead | null> {
    const cached = this.headByWorktree.get(worktree);
    if (cached && Date.now() - cached.readAt < CHECKOUT_HEAD_TTL_MS) return cached.head;
    const head = isDirectory(worktree).then((exists) => (exists ? readCheckoutHead(worktree) : null));
    this.headByWorktree.set(worktree, { readAt: Date.now(), head });
    return head;
  }

  async githubForCheckout(checkout: string): Promise<GithubRepo | null> {
    let pending = this.githubByCheckout.get(checkout);
    if (!pending) {
      pending = readGithubRemote(checkout);
      this.githubByCheckout.set(checkout, pending);
    }
    return pending;
  }

  async githubForRepo(repo: string): Promise<GithubRepo | null> {
    const checkout = await this.resolveCheckout({ repo });
    return checkout ? this.githubForCheckout(checkout) : null;
  }

  async resolve(request: CheckoutRequest & { ref: string }): Promise<CodeResolution> {
    const checkout = await this.resolveCheckout(request);
    if (!checkout) return { status: "no-checkout" };
    const ref = parseCodeRef(request.ref);
    const relPaths = await this.findPaths(checkout, ref.path);
    if (relPaths.length === 0) return { status: "not-found", checkout };
    const github = await this.githubForCheckout(checkout);
    const matches = relPaths.slice(0, MAX_MATCHES).map((relPath) => ({
      relPath,
      absPath: path.join(checkout, relPath),
      line: ref.line,
      col: ref.col,
      githubUrl: github ? githubBlobUrl(github, relPath, ref.line) : null,
    }));
    return { status: "resolved", checkout, matches };
  }

  async isOpenable(absPath: string): Promise<boolean> {
    return isRealPathInsideAny(allowedCodeRoots(this.config), absPath);
  }

  private async findPaths(checkout: string, refPath: string): Promise<string[]> {
    if (!refPath) return [];
    const exact = path.resolve(checkout, refPath);
    if (isInside(checkout, exact) && exact !== checkout && (await isFile(exact))) {
      return [path.relative(checkout, exact).split(path.sep).join("/")];
    }
    const index = await this.fileIndex.get(checkout);
    if (!index) return [];
    if (refPath.includes("/")) {
      const suffix = `/${refPath}`;
      return index.files.filter((file) => file.endsWith(suffix));
    }
    return [...(index.byBasename.get(refPath) ?? [])];
  }
}
