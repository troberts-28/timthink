---
name: timthink
description: Write implementation plans, design notes and specs as markdown that renders in the timthink hub, act on reviews submitted from it, and build approved plans. Use whenever you write or update a plan or planning doc, when the user says "write a plan", "plan this out", "put this in a plan", runs "/timthink review" (with or without a doc path), "/timthink build <doc>", "/timthink comments" or "/timthink migrate", asks you to address, answer or work through review comments on a plan, or asks you to implement a plan.
---

# timthink

Plans are plain markdown files in a docs folder that the timthink hub renders, and that the user reviews like a pull request. You read and answer reviews only through the `timthink` CLI. Never edit files under `.timthink/` by hand.

## Session labels

Start every mode by naming the session, so the project page shows what it's doing: `timthink session label "<what>: <subject>"`, e.g. `"Planning: annual DD mandate"`, `"Building phase 2: rounds"`, `"Reviewing: checkout plan"`, `"Addressing comments on #19586"`, `"Migrating docs"`. Relabel when the work changes. When a session works on a project without writing into its folder or sitting on one of its PR branches, bind it with `timthink project use <id>`. If either command is unknown or says it isn't in a session, carry on without it.

## Writing a plan

**Where.** Docs belong to projects. A project is one shippable piece of work, often spanning repos, and usually sits in an area (`<area>/<project>`, e.g. `car-insurance/annual-payments`).

1. Run `timthink project list --repo <repo>` with the current repo's name. If the work belongs to a listed project, run `timthink project show <id>` to orient (it prints the folder, docs, PRs and open questions), then write into the folder it prints.
2. If the work is a new project, ask the user whether to create one, then `timthink project create <area>/<project> --title "…" --repos <repo>[,<other>]`.
3. If the `project` command is unknown, or the work is a one-off with no project, run `timthink docs-dir` from the repo and write into the folder it prints. If it notes the folder doesn't exist yet, create it.

Name files `YYYY-MM-DD-<slug>.md`.

**Markdown that isn't a plan.** Drafts of files destined for a repo (README, AGENTS.md), prompts, logs and raw notes don't belong in the hub's plan list. Keep them in a subfolder and add that folder to the repo docs folder's `.timthinkignore` (gitignore syntax, e.g. `/2026-11-03-agents-md/`). `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` are never treated as plans.

**Frontmatter.** Always add it:

```yaml
---
title: Short human title
kind: plan
status: draft
branch: feat/branch-name
pr: 1234
linear: ABC-123
---
```

Leave out fields you don't know. `kind` is one of `plan`, `design`, `research`, `decision`, `handoff`, `notes`; leave it out for a plan. `pr` can be a list (`pr: [1234, 1235]`) when the plan ships as several PRs. `status` is one of `draft`, `review`, `approved`, `in-progress`, `done`, `abandoned`.

In a project folder the folder decides the project, so leave out `project:`. Docs in a multi-repo project are about its first repo; add `repo: <name>` for a doc about another one, so its code paths and PR numbers resolve there. Outside a project, `project: <name>` still groups docs inside a repo folder.

**Status rules.**
- Change status with `timthink status <doc> <status>` rather than editing the line by hand; it maps synonyms (wip, pending, complete…) to the six values and refuses `approved`.
- Set `status: review` when you want the user's input.
- Never set `approved` yourself. Only the user approves, by submitting a review.

**Content conventions.**
- Code paths in backticks, with a line number when you mean a specific place: `src/server/app.ts:42`. They become editor links.
- Diagrams in ` ```mermaid ` blocks.
- A genuine open decision goes in a `question` block, one per decision, with a stable `id`. The user decides from the block alone, so every block MUST carry its decision context:
  - **Options**: each `- option` line gets an indented line under it with a one-line trade-off. Mark at most one option `(recommended)`.
  - **Details**: after the options, a line that is exactly `---`, then three sections:
    - `### Context`: what the problem is, why it matters now and what it affects, citing code paths.
    - `### Options`: each option with concrete pros, cons, effort and risk.
    - `### Recommendation`: your pick, why, and what would change your mind.

  ````markdown
  ```question id=activity-gate
  Should writes to the activity table be gated?
  - Gate behind `release_activity_feed`
    Safer rollout, but history only starts when the flag flips.
  - Dark-write from day one (recommended)
    History builds up before the UI ships; tiny write cost.
  ---
  ### Context
  The feed UI ships in two weeks and reads history from `activity_events` (`src/feed/activityRepo.ts:40`). Without history it launches empty.

  ### Options
  **Gate it.** Pros: no writes until we're ready to ship. Cons: the feed starts empty for everyone. Effort: small. Risk: low.

  **Dark-write.** Pros: two weeks of history at launch. Cons: about 1ms extra per write and a table nothing reads yet. Effort: small. Risk: low; writes are fire-and-forget.

  ### Recommendation
  Dark-write from day one: an empty feed at launch is the bigger risk. Gate it instead if write latency on the hot path becomes a concern.
  ```
  ````

  The details are ordinary markdown (code paths, PR links, lists, `mermaid`). If they contain a fenced code block, open the question with four backticks (````` ````question `````) so the inner fence doesn't close it. Don't use question blocks for things you can decide yourself.
- Richer prototypes go in a sibling `.html` file embedded with ` ```demo src=prototype.html ` .

**Finishing.**
1. Run `timthink check <path-to-plan>`. It checks frontmatter, `question`/`mermaid`/`demo` blocks, relative links and the `project.yaml`/`area.yaml` the doc sits under, printing problems with line numbers. Fix every error and every question-block warning, and re-run until it passes before you report back.
2. When the plan wants input, run `timthink url <path-to-plan>` and end your message with the URL it prints.

## Project pages

A project can carry a `project.page.tsx` in its folder. The hub renders it at the top of the project's page, above the generated sections (PRs, rounds, docs, open questions, activity), so it holds what those can't: what the project is, how to test and demo it, diagrams and decisions.

**When.** Pages are opt-in. Write one when a project has test setup, demos or diagrams worth keeping, or when the user asks; never to restate the generated sections. Once a project has a page, keep it current: update it whenever you write a plan, open a PR or change test setup in that project.

**How.**
- Default-export one component. Import only from `react`, `timthink/page` and relative files.
- Shared setup for an area (seed commands, gates, stack status) lives as components in `<area>/page/`, which pages import relatively (`import { Gate } from "../page/Gate"`). Look there before writing setup from scratch, and add to it rather than copying between projects. Repo-specific tooling belongs in those components, never in timthink.
- Build from the primitives in `timthink/page`:
  - `<Section id title>`: a titled section; the page's top-level blocks.
  - `<Callout tone>`: `tone` is `note` (default), `tip`, `warning` or `caution`.
  - `<Choices options={[{ title, body, chosen }]}>`: the options considered, with the chosen one marked.
  - `<BeforeAfter before={…} after={…}>` and `<DecisionTable rows={[{ decision, choice, why }]}>`.
  - `<KvTable rows={{ Gate: <code>x</code>, "Test card": "4000…" }}>`.
  - `<Diagram caption>` around a raw `<svg>`, `<Mermaid code>` for anything Mermaid draws (flows, sequences, ER diagrams), and `<ScreenFlow before={[{ src, caption }]} after={[…]}>` for screenshot sequences, with `src` relative to the page's folder.
  - `<CopyCommand command>` for seed and setup commands.
  - `<Checklist id pr={27974}>` with `<Step id="…">text</Step>` children: the user marks each step pass or fail with a note, stamped with the PR's head SHA, and a result goes stale when the PR gets new commits. `pr` must be one of the project's PRs.
  - `<QrLink href label>` for anything to open on a phone, and `useJson(url)` (`{ data, error, loading, refresh }`, refreshed every 15 seconds) for reading a local dev service.
  - `useProject()` returns the project's live detail: `project` (manifest and docs), `prs`, `questions`, `threads`, `activity` and `rounds`.
- Plain JSX (`<p>`, `<ul>`, `<table>`, `<code>`) is styled like a plan. Tailwind classes only work when the hub already uses them, so lay things out with the primitives or an inline `style`.
- Give every primitive an `id` that is unique on the page and stays the same across edits. Write it literally as `id="how-to-test"` in `project.page.tsx` itself: the user comments on blocks by id, and a block whose id lives in an imported component can't take comments.
- Block comments arrive as a review on `<project-folder>/project.page.tsx`, handled with `/timthink review` like any plan. Each thread quotes the block's `id="…"` and gives its line. Renaming or removing the id makes the thread outdated.

**Finishing.** Run `timthink check <project-folder>/project.page.tsx`. It compiles the page, renders it once against stub project data and checks that block ids are unique. Fix every error and re-run until it passes. The hub shows compile and render errors on the project page too.

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

## `/timthink build <doc> [--phase N] [--branch name]`

The user approved a plan and wants it built, usually in a fresh session with nothing but the plan in context. Build it.

1. **Read the plan** in full, then run `timthink review show <doc>`. If a submitted review hasn't been addressed (exit code 0 with threads or answers), work through it first with the review steps above, then carry on. If `status` isn't `approved`, say so in one line and carry on.
2. **Branch.** The branch is `--branch` if given, else the plan's `branch:`. If the current branch already matches, build on it. Otherwise create it from the repo's trunk (`gt create <branch>` in Graphite repos, else `git switch -c <branch>`). If neither names a branch, pick a short `feat/<slug>`. Write it to `branch:` in the frontmatter.
3. **Mark it started.** `timthink status <doc> in-progress`.
4. **Build.** Work phase by phase, in order, through every phase with open tasks, or only phase N with `--phase N`. Tick each task (`- [x]`) in the plan as it lands, not in a batch at the end. Follow the repo's own conventions for tests, lint and commits. When the plan's decisions turn out to be wrong in practice, follow the code, note the deviation in the plan under the phase, and mention it in your summary.
5. **PRs.** After `gt submit`, `gh pr create` or similar, add every PR number to the plan's `pr:` list. When the plan is in a project, also run `timthink project link-pr <id> <repo>#<number>` for a PR in a repo other than the plan's. Don't open PRs or push unless the user's instructions for the repo say to; ask if unsure.
6. **Finish.** Leave `status: in-progress` while any phase has open tasks. Set `status: done` only when every task is ticked and the work is merged or the user says it's done. Summarise what's built, what's left, and any deviations, and end with the URL from `timthink url <doc>`.

## `/timthink comments [--stack] [--round <id>]`

Address PR review comments with the decisions made in the hub instead of in chat. This mode wraps the address-comments skill rather than replacing it.

1. **Find the skill in effect.** Read `$(git rev-parse --show-toplevel)/.claude/skills/address-comments/SKILL.md` if it exists (a repo's team copy wins), else `~/.claude/skills/address-comments/SKILL.md`. Follow it, with `--stack` passed through, except where this section says otherwise.
2. **Fall back when the hub is down.** If `curl -sf http://127.0.0.1:7420/api/health` fails (use the port from the URLs timthink prints) or `timthink round` is an unknown command, say so in one line and run address-comments as written.
3. **Collect and Triage** run as written.
4. **Replace step 3** (called "Set the plan" where the skill asks the user, "Decide and print the plan" where it decides alone) with a round. Write the round JSON to a temp file, then `timthink round create <file>`. One item per triage row:
   - `id`: the row number; in `--stack`, `<pr>-<n>`. `pr`, `threadId` (null for a greptile-summary item), `path`, `line`, `author` (root author), `participants`, `flags` (`outdated`, `summary`), `messages` (the whole thread, `{ author, body, at }`), `diffHunk`.
   - `said`, `read` (`{ assessment, reason }`, the assessment word without its emoji) and `fix`: the row's Said, My read and Fix lines.
   - `options`: the decisions the skill offers for this row (`{ id, label, hint }`), your pick first. Never add an Other option; the hub always offers one.
   - `reply`: on a greptile-authored row, `{ "kind": "drafted", "drafts": { "<option id>": "<exact reply>" } }` with the text the skill's reply step would post for each option; leave out options that post nothing. On any other row, `{ "kind": "yours", "suggestion": "<suggested answer>" }`.
   - The round itself: `{ "kind": "pr-comments", "title": "Comments on #<pr>", "prs": [{ "number", "title", "headSha", "link" }], "items": [...] }`, with `prs` bottom to top for `--stack` and `link` per the skill's link rule. `fixtures/rounds/pr-comments.json` in the timthink repo is a complete example.
5. **Wait.** Run `timthink round wait <id>` as a background Bash command, then end your turn with one line and the round URL that `round create` printed. Never poll.
6. **When the wait exits 0**, it prints the decisions as JSON. Echo the plan in one status line (`#1 fix · #2 no change · #3 custom fix`), then run the skill's Execute, Push, Reply, Report and Re-review steps on these decisions:
   - `decision` is the chosen option's label. `customFix` set means Other: treat it as the skill treats a typed Other answer (a custom fix, marked VALID).
   - `reply` is the exact text to post on that item. Post it on greptile rows in place of the skill's own wording, and post it under the user's `gh` identity on human rows (still never resolving a human thread). An empty `reply` posts nothing, except a greptile row with `customFix`, where you word the reply by the skill's rules.
7. **Report outcomes.** `timthink round report <id> -` with `{ "<item id>": { "kind": "fixed" | "replied" | "no-change" | "deferred" | "skipped", "note": "…", "commit": "<sha>" } }` on stdin, one entry per item, so the round page shows what happened. Then finish with the skill's report.
8. **Exit 3** means the user abandoned the round: stop, with nothing edited, pushed or posted.

`--round <id>` resumes a round, usually from the hub's Resume in Warp. Run `timthink round show <id>`: while it's `open`, go back to step 5; once `submitted`, its decisions are printed, so check out the PR's branch and carry on from step 6; once `done`, summarise its outcomes.

## `/timthink migrate`

Propose an area and project for every doc still in a legacy repo folder, as a round the hub applies when the user submits it.

1. **Inventory.** `timthink project list` for the projects that already exist, and `timthink project legacy-docs` for every doc to place (path, title, kind, status, date, branch, PRs, Linear id, frontmatter `project:`). Read a doc when its metadata doesn't place it.
2. **Propose.** Group docs into projects: one shippable piece of work each, inside an area for a long-running initiative (`car-insurance/annual-payments`). Reuse existing projects. A doc that fits nowhere goes to `misc/<its folder>`. Keep a doc where it is only when moving it would clearly be wrong, and say why.
3. **Write the round** to a temp file and run `timthink round create <file>`:
   - `{ "kind": "doc-moves", "title": "File docs into projects", "areas": [...], "projects": [...], "items": [...] }`.
   - `areas`: `{ id, title, summary }` for each new area. `projects`: `{ id, title, summary, status, repos, prs }` for each new project, with `repos` most-used first and `status` (`active`, `paused`, `shipped` or `dropped`) from its docs and PRs.
   - One item per doc: `{ id, doc, title, status, date, reason, options }`. `reason` is one line on why it belongs there. `options` are `{ id, label, hint, target }` with your proposal first, up to two plausible alternatives, and `{ "id": "leave", "label": "Leave it", "target": null }` last. `target` is a project id; `label` repeats it.
4. **Hand over.** Don't wait: the hub moves the docs when the user submits, and Undo on the round page reverses it. End with one line and the round URL.
