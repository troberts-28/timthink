import { z } from "zod";

export const ROUND_KINDS = ["pr-comments"] as const;
export const ROUND_STATES = ["open", "submitted", "done", "abandoned"] as const;
export const OUTCOME_KINDS = ["fixed", "replied", "no-change", "deferred", "skipped"] as const;

const MAX_TEXT = 20_000;
const MAX_REPLY = 5_000;
const MAX_HUNK = 50_000;
const ITEM_ID = /^[\w.-]{1,64}$/;
const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

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

export const roundItemSchema = z
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
    const optionIds = item.options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length) {
      context.addIssue({ code: "custom", path: ["options"], message: "Option ids must be unique" });
    }
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

export const roundInputSchema = z
  .object({
    kind: z.enum(ROUND_KINDS),
    title: z.string().trim().min(1).max(200),
    repo: z.string().trim().min(1).max(128).optional(),
    prs: z.array(roundPrSchema).min(1).max(50),
    items: z.array(roundItemSchema).min(1).max(500),
  })
  .superRefine((input, context) => {
    const itemIds = input.items.map((item) => item.id);
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({ code: "custom", path: ["items"], message: "Item ids must be unique" });
    }
    const prNumbers = new Set(input.prs.map((pr) => pr.number));
    for (const [index, item] of input.items.entries()) {
      if (!prNumbers.has(item.pr)) {
        context.addIssue({ code: "custom", path: ["items", index, "pr"], message: `#${item.pr} isn't in prs` });
      }
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

export const roundSchema = z.object({
  id: z.string().regex(ITEM_ID),
  kind: z.enum(ROUND_KINDS),
  title: z.string(),
  repo: z.string(),
  project: z.string().nullable(),
  cwd: z.string().nullable(),
  prs: z.array(roundPrSchema),
  items: z.array(roundItemSchema),
  createdAt: z.string(),
  state: z.enum(ROUND_STATES),
  submittedAt: z.string().nullable(),
  decisions: z.record(z.string(), roundDecisionSchema),
  outcomes: z.record(z.string(), roundOutcomeSchema),
  waiter: roundWaiterSchema.nullable(),
});

export type RoundKind = (typeof ROUND_KINDS)[number];
export type RoundState = (typeof ROUND_STATES)[number];
export type RoundOutcomeKind = (typeof OUTCOME_KINDS)[number];
export type RoundOption = z.infer<typeof roundOptionSchema>;
export type RoundMessage = z.infer<typeof roundMessageSchema>;
export type RoundReply = z.infer<typeof roundReplySchema>;
export type RoundItem = z.infer<typeof roundItemSchema>;
export type RoundPr = z.infer<typeof roundPrSchema>;
export type RoundInput = z.input<typeof roundInputSchema>;
export type RoundChoice = z.infer<typeof roundChoiceSchema>;
export type RoundDecision = z.infer<typeof roundDecisionSchema>;
export type RoundOutcome = z.infer<typeof roundOutcomeSchema>;
export type RoundWaiter = z.infer<typeof roundWaiterSchema>;
export type Round = z.infer<typeof roundSchema>;
export const ROUND_ID_PATTERN = ITEM_ID;
