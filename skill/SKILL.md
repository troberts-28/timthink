---
name: timthink
description: Write implementation plans, design notes and specs as markdown that renders in the timthink hub, and act on reviews submitted from it. Use whenever you write or update a plan or planning doc, when the user says "write a plan", "plan this out", "put this in a plan", or runs "/timthink review" (with or without a doc path), or asks you to address, answer or work through review comments on a plan.
---

# timthink

Plans are plain markdown files in a docs folder that the timthink hub renders, and that the user reviews like a pull request. You read and answer reviews only through the `timthink` CLI. Never edit files under `.timthink/` by hand.

## Writing a plan

**Where.** Run `timthink docs-dir` from the repo you're working in and write into the folder it prints, optionally in a project subfolder. If it notes the folder doesn't exist yet, create it. Name files `YYYY-MM-DD-<slug>.md`.

**Frontmatter.** Always add it:

```yaml
---
title: Short human title
project: optional-project-name
status: draft
branch: feat/branch-name
pr: 1234
linear: ABC-123
---
```

Leave out fields you don't know. `status` is one of `draft`, `review`, `approved`, `in-progress`, `done`, `abandoned`.

**Status rules.**
- Set `status: review` when you want the user's input.
- Never set `approved` yourself. Only the user approves, by submitting a review.

**Content conventions.**
- Code paths in backticks, with a line number when you mean a specific place: `src/server/app.ts:42`. They become editor links.
- Diagrams in ` ```mermaid ` blocks.
- A genuine open decision goes in a `question` block, one per decision, with a stable `id`. Mark at most one option `(recommended)`:

  ````markdown
  ```question id=activity-gate
  Should writes to the activity table be gated?
  - Gate behind the release flag
  - Dark-write from day one (recommended)
  ```
  ````

  Don't use question blocks for things you can decide yourself.
- Richer prototypes go in a sibling `.html` file embedded with ` ```demo src=prototype.html ` .

**Finishing.**
1. Run `timthink check <path-to-plan>`. It checks frontmatter, `question`/`mermaid`/`demo` blocks and relative links, printing problems with line numbers. Fix every error and re-run until it passes before you report back.
2. When the plan wants input, run `timthink url <path-to-plan>` and end your message with the URL it prints.

## `/timthink review [doc]`

The user submitted a review in the hub. Work through all of it.

1. **Find the doc.** If none was given, run `timthink review list` and pick the doc that matches the current repo and branch. If more than one fits, ask.
2. **Read the review.** `timthink review show <doc>`. It prints the verdict, the overall comment, every open thread (id, section, line numbers, quoted passage, the comment or suggested replacement, earlier messages) and any answers to question blocks. Exit code 2 means there is nothing to address.
3. **Address every thread.** Edit the plan file directly.
   - Comments: change the plan, or explain why not.
   - Suggestions: apply the replacement (adjusting it if needed), or decline with a reason.
   - Outdated threads: the passage has changed. Check whether the comment still applies.
4. **Reply to each thread** with what you did: `timthink review reply <doc> <thread-id> "<what changed, or why not>"`. For long replies, pipe the text on stdin and pass `-` as the message.
5. **Resolve** threads you fully addressed: `timthink review resolve <doc> <thread-id>` (add `--message "…"` to reply and resolve in one step). Leave a thread open when you disagree or need the user's input, and say so in your reply.
6. **Answers.** Fold each chosen option and note into the plan (turn the question block into a decided statement), then `timthink review answer-ack <doc> <question-id> --message "<what you decided>"`.
7. **Finish.** `timthink review addressed <doc>`, then summarise in chat: what changed, what you declined, and what still needs the user.

Rules:
- Only act on what `review show` prints. Never invent comments or answers.
- Don't change `status` to `approved`. After addressing a "Request changes" review, set `status: review` if you want another look.
- `<doc>` can be absolute, `~`-relative, or relative to the docs root.
