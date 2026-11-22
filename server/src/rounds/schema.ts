import { z } from "zod";
import { PROJECT_STATUSES } from "../projects/manifest.js";

export const ROUND_KINDS = ["pr-comments", "doc-moves"] as const;
export const ROUND_STATES = ["open", "submitted", "done", "abandoned"] as const;
export const OUTCOME_KINDS = ["fixed", "replied", "no-change", "deferred", "skipped", "moved"] as const;

const MAX_TEXT = 20_000;
const MAX_REPLY = 5_000;
const MAX_HUNK = 50_000;
const ITEM_ID = /^[\w.-]{1,64}$/;
const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;
const PROJECT_ID = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/i;
const MAX_DOC_MOVES = 2_000;

export const projectIdSchema = z.string().trim().regex(PROJECT_ID, "use <project> or <area>/<project>");

export const roundOptionSchema = z.object({
  id: z.string().regex(ITEM_ID),
  label: z.string().trim().min(1).max(200),
  hint: z.string().max(500).default(""),
});

export const roundMessageSchema = z.object({
  author: z.string().trim().min(1).max(100),
  body: z.string().max(MAX_TEXT),
  at: z.string().max(64).nullable().default(null),
});

export const roundReplySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("drafted"), drafts: z.record(z.string(), z.string().max(MAX_REPLY)) }),
  z.object({ kind: z.literal("yours"), suggestion: z.string().max(MAX_REPLY).nullable().default(null) }),
]);

export const prCommentItemSchema = z
  .object({
    id: z.string().regex(ITEM_ID),
    pr: z.number().int().positive(),
    threadId: z.string().min(1).max(200).nullable().default(null),
    path: z.string().min(1).max(1024).nullable().default(null),
    line: z.number().int().positive().nullable().default(null),
    author: z.string().trim().min(1).max(100),
    participants: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    flags: z.object({ outdated: z.boolean().default(false), summary: z.boolean().default(false) }).default({}),
    messages: z.array(roundMessageSchema).min(1).max(200),
    diffHunk: z.string().max(MAX_HUNK).nullable().default(null),
    said: z.string().trim().min(1).max(MAX_TEXT),
    read: z.object({ assessment: z.string().trim().min(1).max(40), reason: z.string().max(MAX_TEXT) }),
    fix: z.string().max(MAX_TEXT),
    options: z.array(roundOptionSchema).min(1).max(8),
    reply: roundReplySchema,
  })
  .superRefine((item, context) => {
    requireUniqueOptionIds(item.options, context);
    const optionIds = item.options.map((option) => option.id);
    if (item.reply.kind === "drafted") {
      const unknownDrafts = Object.keys(item.reply.drafts).filter((optionId) => !optionIds.includes(optionId));
      if (unknownDrafts.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["reply", "drafts"],
          message: `Drafts for unknown options: ${unknownDrafts.join(", ")}`,
        });
      }
    }
  });

export const roundPrSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().max(500).default(""),
  headSha: z.string().regex(COMMIT_SHA),
  link: z.string().url().max(2048),
});

const prCommentsInputSchema = z.object({
  kind: z.literal("pr-comments"),
  title: z.string().trim().min(1).max(200),
  repo: z.string().trim().min(1).max(128).optional(),
  prs: z.array(roundPrSchema).min(1).max(50),
  items: z.array(prCommentItemSchema).min(1).max(500),
});

function refinePrCommentsInput(input: z.infer<typeof prCommentsInputSchema>, context: z.RefinementCtx) {
  const prNumbers = new Set(input.prs.map((pr) => pr.number));
  for (const [index, item] of input.items.entries()) {
    if (!prNumbers.has(item.pr)) {
      context.addIssue({ code: "custom", path: ["items", index, "pr"], message: `#${item.pr} isn't in prs` });
    }
  }
}

export const docMoveOptionSchema = roundOptionSchema.extend({ target: projectIdSchema.nullable() });

export const docMoveItemSchema = z
  .object({
    id: z.string().regex(ITEM_ID),
    doc: z.string().min(1).max(1024),
    title: z.string().max(500).default(""),
    status: z.string().max(40).nullable().default(null),
    date: z.string().max(40).default(""),
    reason: z.string().max(MAX_TEXT).default(""),
    options: z.array(docMoveOptionSchema).min(1).max(8),
  })
  .superRefine((item, context) => requireUniqueOptionIds(item.options, context));

export const proposedAreaSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i),
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(MAX_TEXT).nullable().default(null),
});

export const proposedProjectSchema = z.object({
  id: projectIdSchema,
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(MAX_TEXT).nullable().default(null),
  status: z.enum(PROJECT_STATUSES).default("active"),
  repos: z.array(z.string().trim().min(1).max(128)).max(20).default([]),
  prs: z
    .array(z.union([z.string(), z.number()]))
    .max(200)
    .default([]),
});

const docMovesInputSchema = z.object({
  kind: z.literal("doc-moves"),
  title: z.string().trim().min(1).max(200),
  repo: z.string().trim().min(1).max(128).optional(),
  areas: z.array(proposedAreaSchema).max(100).default([]),
  projects: z.array(proposedProjectSchema).max(500).default([]),
  items: z.array(docMoveItemSchema).min(1).max(MAX_DOC_MOVES),
});

export const roundInputSchema = z
  .discriminatedUnion("kind", [prCommentsInputSchema, docMovesInputSchema])
  .superRefine((input, context) => {
    requireUniqueItemIds(input.items, context);
    if (input.kind === "pr-comments") {
      refinePrCommentsInput(input, context);
      return;
    }
    const docs = input.items.map((item) => item.doc);
    if (new Set(docs).size !== docs.length) {
      context.addIssue({ code: "custom", path: ["items"], message: "Each doc can only move once" });
    }
  });

export const roundChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("option"), optionId: z.string().regex(ITEM_ID) }),
  z.object({ kind: z.literal("other"), text: z.string().trim().min(1).max(MAX_TEXT) }),
]);

export const roundDecisionSchema = z.object({
  choice: roundChoiceSchema,
  reply: z.string().max(MAX_REPLY),
});

export const roundOutcomeSchema = z.object({
  kind: z.enum(OUTCOME_KINDS),
  note: z.string().max(MAX_TEXT).default(""),
  commit: z.string().regex(COMMIT_SHA).nullable().default(null),
});

export const roundOutcomesSchema = z.record(z.string(), roundOutcomeSchema);

export const roundWaiterSchema = z.object({ pid: z.number().int().positive(), since: z.string() });

const roundLifecycle = {
  id: z.string().regex(ITEM_ID),
  title: z.string(),
  repo: z.string(),
  project: z.string().nullable(),
  cwd: z.string().nullable(),
  createdAt: z.string(),
  state: z.enum(ROUND_STATES),
  submittedAt: z.string().nullable(),
  decisions: z.record(z.string(), roundDecisionSchema),
  outcomes: z.record(z.string(), roundOutcomeSchema),
  waiter: roundWaiterSchema.nullable(),
};

export const prCommentsRoundSchema = z.object({
  ...roundLifecycle,
  kind: z.literal("pr-comments"),
  prs: z.array(roundPrSchema),
  items: z.array(prCommentItemSchema),
});

export const docMovesRoundSchema = z.object({
  ...roundLifecycle,
  kind: z.literal("doc-moves"),
  areas: z.array(proposedAreaSchema),
  projects: z.array(proposedProjectSchema),
  items: z.array(docMoveItemSchema),
  applyError: z.string().nullable().default(null),
});

export const roundSchema = z.discriminatedUnion("kind", [prCommentsRoundSchema, docMovesRoundSchema]);

export type RoundKind = (typeof ROUND_KINDS)[number];
export type RoundState = (typeof ROUND_STATES)[number];
export type RoundOutcomeKind = (typeof OUTCOME_KINDS)[number];
export type RoundOption = z.infer<typeof roundOptionSchema>;
export type RoundMessage = z.infer<typeof roundMessageSchema>;
export type RoundReply = z.infer<typeof roundReplySchema>;
export type PrCommentItem = z.infer<typeof prCommentItemSchema>;
export type DocMoveItem = z.infer<typeof docMoveItemSchema>;
export type DocMoveOption = z.infer<typeof docMoveOptionSchema>;
export type ProposedArea = z.infer<typeof proposedAreaSchema>;
export type ProposedProject = z.infer<typeof proposedProjectSchema>;
export type RoundItem = PrCommentItem | DocMoveItem;
export type RoundPr = z.infer<typeof roundPrSchema>;
export type RoundInput = z.input<typeof roundInputSchema>;
export type RoundChoice = z.infer<typeof roundChoiceSchema>;
export type RoundDecision = z.infer<typeof roundDecisionSchema>;
export type RoundOutcome = z.infer<typeof roundOutcomeSchema>;
export type RoundWaiter = z.infer<typeof roundWaiterSchema>;
export type PrCommentsRound = z.infer<typeof prCommentsRoundSchema>;
export type DocMovesRound = z.infer<typeof docMovesRoundSchema>;
export type Round = z.infer<typeof roundSchema>;
export const ROUND_ID_PATTERN = ITEM_ID;

function requireUniqueItemIds(items: ReadonlyArray<{ id: string }>, context: z.RefinementCtx) {
  const itemIds = items.map((item) => item.id);
  if (new Set(itemIds).size !== itemIds.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Item ids must be unique" });
  }
}

function requireUniqueOptionIds(options: ReadonlyArray<{ id: string }>, context: z.RefinementCtx) {
  const optionIds = options.map((option) => option.id);
  if (new Set(optionIds).size !== optionIds.length) {
    context.addIssue({ code: "custom", path: ["options"], message: "Option ids must be unique" });
  }
}
