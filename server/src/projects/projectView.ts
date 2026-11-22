import type { DocContent } from "../docs/content.js";
import type {
  AttachmentSummary,
  CodeRepoInfo,
  DocsIndex,
  GithubRepo,
  IndexedDoc,
  ProjectEntry,
} from "../docs/types.js";
import { isTerminal, type PrInfo } from "../prs/types.js";
import type { ReviewFile } from "../reviews/schema.js";
import type { RoundSummary } from "../rounds/roundView.js";
import { type PrRef, samePr } from "./manifest.js";
import type { ProjectRecord } from "./registry.js";

export type ProjectPrSource = "frontmatter" | "session" | "manifest" | "stack";

export interface ProjectPr {
  repo: string;
  number: number;
  info: PrInfo | null;
  sources: ProjectPrSource[];
  docPaths: string[];
}

export interface ProjectStack {
  repo: string;
  prs: ProjectPr[];
}

export interface ProjectPrs {
  status: "ok" | "disabled" | "unavailable";
  message: string | null;
  stacks: ProjectStack[];
  detached: ProjectPr[];
}

export interface ProjectQuestion {
  docPath: string;
  docTitle: string;
  questionId: string | null;
  prompt: string;
  line: number;
  answered: boolean;
}

export interface ProjectThread {
  docPath: string;
  docTitle: string;
  threadId: string;
  quote: string;
  body: string;
  waitingOn: "you" | "claude";
  at: string;
}

export type ProjectActivityKind =
  | "doc-updated"
  | "review-submitted"
  | "review-addressed"
  | "pr-merged"
  | "pr-closed"
  | "pr-updated";

export interface ProjectActivity {
  kind: ProjectActivityKind;
  at: string;
  title: string;
  docPath: string | null;
  pr: { repo: string; number: number; url: string } | null;
}

export interface ProjectDetail {
  project: ProjectEntry;
  area: { id: string; title: string } | null;
  repoLinks: Record<string, CodeRepoInfo>;
  prs: ProjectPrs;
  questions: ProjectQuestion[];
  threads: ProjectThread[];
  activity: ProjectActivity[];
  rounds: RoundSummary[];
  looksFinished: LooksFinishedDoc[];
  attachments: AttachmentSummary[];
}

export interface LooksFinishedDoc {
  docPath: string;
  title: string;
  prs: number[];
  openTasks: number;
}

export interface DocPrView {
  linked: Array<{ number: number; sources: Array<"frontmatter" | "session"> }>;
  stack: Array<{ number: number }>;
}

export interface ProjectViewDeps {
  index: DocsIndex;
  record: ProjectRecord;
  contentOf(docPath: string): DocContent | undefined;
  readReview(docPath: string): Promise<ReviewFile | null>;
  docPrs(docPath: string): DocPrView;
  githubFor(repo: string): GithubRepo | null;
  lookupPrs(github: GithubRepo, numbers: number[]): void;
  infoFor(github: GithubRepo, number: number): PrInfo | null;
  stackOf(github: GithubRepo, numbers: number[]): number[];
  prsEnabled: boolean;
  prsUnavailable: string | null;
  attachmentsUnder(dir: string): AttachmentSummary[];
  rounds: readonly RoundSummary[];
  awaitingCompletion(docPath: string): { marker: string; openTasks: number } | null;
}

const ACTIVITY_LIMIT = 40;

export function findProjectEntry(index: DocsIndex, id: string) {
  return (
    index.projects.find((project) => project.id === id) ??
    index.areas.flatMap((area) => area.projects).find((project) => project.id === id)
  );
}

function mergeStacks(stacks: readonly number[][]) {
  let merged: number[][] = [];
  for (const stack of stacks) {
    const overlapping = merged.filter((existing) => existing.some((number) => stack.includes(number)));
    const combined = [...new Set([...overlapping.flat(), ...stack])];
    merged = [...merged.filter((existing) => !overlapping.includes(existing)), combined];
  }
  return merged;
}

function prKeyOf(ref: PrRef) {
  return `${ref.repo}#${ref.number}`;
}

function isSettledStack(stack: ProjectStack) {
  return stack.prs.every((pr) => pr.info !== null && isTerminal(pr.info));
}

function newestNumber(stack: ProjectStack) {
  return Math.max(...stack.prs.map((pr) => pr.number));
}

function byLiveThenNewest(a: ProjectStack, b: ProjectStack) {
  return Number(isSettledStack(a)) - Number(isSettledStack(b)) || newestNumber(b) - newestNumber(a);
}

function infoForRef(deps: ProjectViewDeps, ref: PrRef) {
  const github = deps.githubFor(ref.repo);
  return github ? deps.infoFor(github, ref.number) : null;
}

class PrCollector {
  private readonly byKey = new Map<string, ProjectPr>();
  private readonly stacksByRepo = new Map<string, number[][]>();

  constructor(private readonly deps: ProjectViewDeps) {}

  add(ref: PrRef, origin: { source: ProjectPrSource; docPath: string | null }) {
    const entry = this.byKey.get(prKeyOf(ref)) ?? { ...ref, info: null, sources: [], docPaths: [] };
    if (!entry.sources.includes(origin.source)) {
      entry.sources.push(origin.source);
    }
    if (origin.docPath && !entry.docPaths.includes(origin.docPath)) {
      entry.docPaths.push(origin.docPath);
    }
    this.byKey.set(prKeyOf(ref), entry);
  }

  addStack(repo: string, numbers: number[]) {
    if (numbers.length > 0) {
      this.stacksByRepo.set(repo, [...(this.stacksByRepo.get(repo) ?? []), numbers]);
    }
  }

  build() {
    const detached = this.deps.record.manifest.detached;
    const placed = new Set<string>();
    const stacks: ProjectStack[] = [];
    for (const [repo, numberLists] of this.stacksByRepo) {
      for (const numbers of mergeStacks(numberLists)) {
        const refs = numbers
          .map((number) => ({ repo, number }))
          .filter((ref) => !detached.some((other) => samePr(other, ref)));
        for (const ref of refs) {
          placed.add(prKeyOf(ref));
        }
        if (refs.length > 0) {
          stacks.push({ repo, prs: refs.map((ref) => this.entryWithInfo(ref, ["stack"])) });
        }
      }
    }
    for (const entry of this.byKey.values()) {
      const isLoose = !placed.has(prKeyOf(entry)) && !detached.some((other) => samePr(other, entry));
      if (isLoose) {
        stacks.push({ repo: entry.repo, prs: [this.entryWithInfo(entry, [])] });
      }
    }
    return {
      stacks: stacks.sort(byLiveThenNewest),
      detached: detached.map((ref) => this.entryWithInfo(ref, [])),
    };
  }

  private entryWithInfo(ref: PrRef, fallbackSources: ProjectPrSource[]): ProjectPr {
    const known = this.byKey.get(prKeyOf(ref));
    const entry = known ?? { repo: ref.repo, number: ref.number, info: null, sources: fallbackSources, docPaths: [] };
    return { ...entry, info: infoForRef(this.deps, ref) };
  }
}

function collectPrs(deps: ProjectViewDeps, docs: readonly IndexedDoc[]): ProjectPrs {
  if (!deps.prsEnabled) {
    return { status: "disabled", message: null, stacks: [], detached: [] };
  }
  const collector = new PrCollector(deps);
  for (const doc of docs) {
    const view = deps.docPrs(doc.path);
    for (const linked of view.linked) {
      for (const source of linked.sources) {
        collector.add({ repo: doc.codeRepo, number: linked.number }, { source, docPath: doc.path });
      }
    }
    collector.addStack(
      doc.codeRepo,
      view.stack.map((item) => item.number),
    );
  }
  const explicitByRepo = new Map<string, number[]>();
  for (const ref of deps.record.manifest.prs) {
    collector.add(ref, { source: "manifest", docPath: null });
    explicitByRepo.set(ref.repo, [...(explicitByRepo.get(ref.repo) ?? []), ref.number]);
  }
  for (const [repo, numbers] of explicitByRepo) {
    const github = deps.githubFor(repo);
    if (github) {
      deps.lookupPrs(github, numbers);
      collector.addStack(repo, deps.stackOf(github, numbers));
    }
  }
  return {
    status: deps.prsUnavailable ? "unavailable" : "ok",
    message: deps.prsUnavailable,
    ...collector.build(),
  };
}

function prActivity(stacks: readonly ProjectStack[]) {
  return stacks.flatMap((stack) =>
    stack.prs.flatMap((pr): ProjectActivity[] => {
      const info = pr.info;
      if (!info) {
        return [];
      }
      const ref = { repo: pr.repo, number: pr.number, url: info.url };
      if (info.state === "merged") {
        return [
          {
            kind: "pr-merged",
            at: info.mergedAt ?? info.closedAt ?? info.updatedAt,
            title: info.title,
            docPath: null,
            pr: ref,
          },
        ];
      }
      if (info.state === "closed") {
        return [{ kind: "pr-closed", at: info.closedAt ?? info.updatedAt, title: info.title, docPath: null, pr: ref }];
      }
      return [{ kind: "pr-updated", at: info.updatedAt, title: info.title, docPath: null, pr: ref }];
    }),
  );
}

async function reviewItems(deps: ProjectViewDeps, docs: readonly IndexedDoc[]) {
  const questions: ProjectQuestion[] = [];
  const threads: ProjectThread[] = [];
  const activity: ProjectActivity[] = [];
  for (const doc of docs) {
    const review = await deps.readReview(doc.path);
    const pendingAnswers = new Set(
      (review?.answers ?? []).filter((answer) => answer.ack === null).map((answer) => answer.questionId),
    );
    for (const question of deps.contentOf(doc.path)?.questions ?? []) {
      questions.push({
        docPath: doc.path,
        docTitle: doc.title,
        questionId: question.id,
        prompt: question.prompt,
        line: question.line,
        answered: question.id !== null && pendingAnswers.has(question.id),
      });
    }
    if (!review) {
      continue;
    }
    const draftReviews = new Set(review.reviews.filter((entry) => entry.state === "draft").map((entry) => entry.id));
    for (const thread of review.threads) {
      if (thread.status !== "open" || draftReviews.has(thread.reviewId)) {
        continue;
      }
      const last = thread.messages.at(-1);
      threads.push({
        docPath: doc.path,
        docTitle: doc.title,
        threadId: thread.id,
        quote: thread.anchor.quote,
        body: last?.body ?? thread.suggestion ?? "",
        waitingOn: last?.author === "claude" ? "you" : "claude",
        at: last?.at ?? thread.createdAt,
      });
    }
    for (const entry of review.reviews) {
      if (entry.submittedAt) {
        activity.push({
          kind: "review-submitted",
          at: entry.submittedAt,
          title: doc.title,
          docPath: doc.path,
          pr: null,
        });
      }
      if (entry.addressedAt) {
        activity.push({
          kind: "review-addressed",
          at: entry.addressedAt,
          title: doc.title,
          docPath: doc.path,
          pr: null,
        });
      }
    }
  }
  threads.sort((a, b) => b.at.localeCompare(a.at));
  return { questions, threads, activity };
}

export async function buildProjectDetail(deps: ProjectViewDeps): Promise<ProjectDetail | null> {
  const project = findProjectEntry(deps.index, deps.record.id);
  if (!project) {
    return null;
  }
  const area = project.area ? deps.index.areas.find((entry) => entry.id === project.area) : undefined;
  const prs = collectPrs(deps, project.docs);
  const reviews = await reviewItems(deps, project.docs);
  const docActivity: ProjectActivity[] = project.docs.map((doc) => ({
    kind: "doc-updated",
    at: new Date(doc.mtime).toISOString(),
    title: doc.title,
    docPath: doc.path,
    pr: null,
  }));
  const activity = [...docActivity, ...reviews.activity, ...prActivity(prs.stacks)]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, ACTIVITY_LIMIT);
  const repoLinks: Record<string, CodeRepoInfo> = {};
  for (const repo of new Set([...project.repos, ...project.docs.map((doc) => doc.codeRepo)])) {
    const info = deps.index.codeRepos[repo];
    if (info) {
      repoLinks[repo] = info;
    }
  }
  return {
    project,
    area: area ? { id: area.id, title: area.title } : null,
    repoLinks,
    prs,
    questions: reviews.questions,
    threads: reviews.threads,
    activity,
    rounds: projectRounds(deps, prs),
    looksFinished: project.docs.flatMap((doc) => {
      const awaiting = deps.awaitingCompletion(doc.path);
      return awaiting
        ? [
            {
              docPath: doc.path,
              title: doc.title,
              prs: awaiting.marker.split(",").map(Number),
              openTasks: awaiting.openTasks,
            },
          ]
        : [];
    }),
    attachments: deps.attachmentsUnder(deps.record.id),
  };
}

function projectRounds(deps: ProjectViewDeps, prs: ProjectPrs) {
  const projectPrKeys = new Set(prs.stacks.flatMap((stack) => stack.prs.map(prKeyOf)));
  return deps.rounds.filter((round) => {
    const isFiledUnderProject = round.project === deps.record.id;
    const touchesProjectPr = round.prs.some((pr) =>
      projectPrKeys.has(prKeyOf({ repo: round.repo, number: pr.number })),
    );
    return isFiledUnderProject || touchesProjectPr;
  });
}
