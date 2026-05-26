# Development Instructions

Default conventions for Fredrik's personal projects — typically Bun-based JavaScript libraries published to npm. Some sections (package preparation, `exports`/`files`) apply specifically to publishable libraries; for applications, services, or one-off scripts, those sections can be ignored.

## Runtime: Bun

Always use Bun. Every command, script, and tool must use Bun.

```sh
export PATH="$HOME/.bun/bin:$PATH"
```

If Bun is not available, install it before doing anything else:

```sh
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
```

This takes priority over all other actions. Do not fall back to Node.js, npm, yarn, or pnpm.

- Use `bun <file>` instead of `node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>`
- Bun automatically loads .env — do not use dotenv.

## Voice

All writing produced in this project — dev notes, README, documentation, code comments, commit messages, changelog entries, issue descriptions, anything prose — follows the voice rules in `project/brand/voice.md`. Read that file before writing anything substantive.

This covers tone, vocabulary, humor style, and the `adams` / `flight-controller` persona system for long-form pieces. The voice file is the single source of truth; don't paraphrase or summarize its rules elsewhere — refer to it.

Code comments get the same voice treatment as prose: plain, direct, specific. No filler comments that restate the code. A comment exists to explain *why*, not *what*.

The voice rules in `project/brand/voice.md` are written for English. For Swedish or other-language output (rare, but possible for domain-specific projects), apply the spirit of the rules — plain, direct, specific, no marketing language — without forcing the English-specific vocabulary and idiom guidance.

## Project Layout

A typical project looks like this:

```
.
├── src/
│   └── index.js              # main entry point
├── tests/                    # bun:test files
├── docs/
│   ├── overview.md           # user-facing architecture
│   ├── api.md                # full API reference
│   ├── roadmap.md            # future versions
│   └── **.md                 # individual feature docs
├── project/                  # project administration and reference material
│   ├── brand/
│   │   └── voice.md          # voice and tone rules
│   ├── tickets/
│   │   ├── backlog/          # not yet started, including deferred work
│   │   ├── active/           # currently being worked on
│   │   └── done/             # completed tickets, kept for history
│   └── dev_notes.md          # raw material for blog posts
├── ARCHITECTURE.md           # internal design doc (gitignored)
├── CHANGELOG.md
├── README.md
├── LICENSE
├── AGENTS.md
└── package.json
```

Notes:

- `project/` holds everything used to administrate the project that isn't source code, tests, or published docs — voice rules, tickets, dev notes, draft announcements, references. The directory is tracked in git; `ARCHITECTURE.md` is not.
- `src/index.js` is the canonical entry point. Sub-modules live under `src/` as needed.
- Single-purpose libraries should resist growing a `lib/` or `utils/` directory until the structure genuinely demands it.

## APIs

- `Bun.serve()` for HTTP and WebSocket servers. Do not use `express`.
- `bun:sqlite` for SQLite. Do not use `better-sqlite3`.
- `Bun.file` over `node:fs` readFile/writeFile.
- Native `WebSocket` — do not use `ws`.

## Architecture

Always refer to `ARCHITECTURE.md` when considering new features, packages, or structural changes. All work must align with the architecture document. If a proposed change conflicts with the architecture, discuss it first and update the architecture document before proceeding.

`ARCHITECTURE.md` is an internal design document and is not published to git (it should be in `.gitignore`). The public-facing version is `docs/overview.md` — a user-focused explanation of how the library works, without internal file paths or implementation details that belong in the architecture doc.

## Tickets

Tickets are units of work, stored as markdown files under `project/tickets/`. They serve three purposes: breaking down `ARCHITECTURE.md` into actionable chunks, capturing scope changes as they emerge during development, and stashing deferred work that shouldn't be lost.

### Workflow

1. **Initial breakdown.** When a project starts (or when major architectural work lands), read `ARCHITECTURE.md` and break it into tickets. One ticket per coherent unit of work — small enough to complete in one focused session, large enough to be worth tracking. New tickets go in `project/tickets/backlog/`.
2. **During development.** When the work uncovers something that needs doing later — a refactor, a missing feature, a bug to revisit — create a backlog ticket immediately. Don't rely on memory.
3. **Scope or design changes.** When a change affects what's already planned, either update existing tickets in place or create new ones. If `ARCHITECTURE.md` itself shifts, sweep the ticket directories for tickets that no longer make sense.
4. **State transitions.** Move the ticket file between subdirectories:
   - `backlog/` → `active/` when starting work
   - `active/` → `done/` when complete and merged
   - `active/` → `backlog/` if work is paused
5. **Done ≠ deleted.** Completed tickets stay in `done/` as project history. They're useful when writing dev notes or blog posts ("what did I actually build last month?").

### Naming

Tickets use a numeric prefix and a short slug:

```
001-lidar-scan-parsing.md
002-motor-controller-protocol.md
003-deferred-tofu-error-handling.md
```

The numeric prefix is sequential across all subdirectories — once assigned, it doesn't change when the ticket moves between `backlog/`, `active/`, and `done/`. This gives stable IDs for cross-references (a dev note can say "addresses #017" and the link survives state changes).

### Template

```markdown
# 017 — LIDAR scan parsing

## Origin

Where this came from. Options: "Breakdown of ARCHITECTURE.md §3.2", "Discovered while implementing #014", "Deferred from #012", "Bug found in production". Be specific.

## Description

What needs to happen, and why. One or two paragraphs. The reader should understand the goal without needing to re-read the architecture doc.

## Acceptance criteria

- Specific, checkable conditions for "done."
- Prefer measurable over vague. "Parses 1000 scans/sec at 95% accuracy" beats "parses scans well."
- Three to seven items is the sweet spot. If there are more, the ticket is probably two tickets.

## Notes (optional)

Implementation thoughts, references, prior art, code sketches. Anything that helps the future-you who picks this up cold. Skip if there's nothing useful to add.

## Related (optional)

- Depends on: #014
- Blocks: #022
- See also: #009 (similar approach)
```

### What goes in a ticket vs. what doesn't

- **Ticket-worthy**: discrete features, bugs with a clear fix path, refactors, scope changes, deferred work that has enough shape to act on.
- **Not ticket-worthy**: vague ideas ("maybe explore X"), pure questions, daily TODOs. Use a scratchpad or just keep thinking — tickets should be actionable.

## Testing

All new features must have dedicated tests in the `tests/` folder. Use `bun:test`.

```js
import { test, expect } from 'bun:test'

test('example', () => {
  expect(1).toBe(1)
})
```

Run tests with:

```sh
bun test tests/
```

## Documentation

All features must be documented in the `docs/` folder. Each individual document should be concise and focused on usage and API surface — but coverage should be complete across the suite. Concise per file, exhaustive across files.

The docs folder structure:

- `docs/overview.md` — user-facing version of ARCHITECTURE.md. Explains how the library works, layer breakdown, and platform details. No internal file paths or design rationale that belongs only in the architecture doc.
- `docs/api.md` — full API reference: constructor options, methods, events, and any sub-modules.
- `docs/roadmap.md` — what's coming in future versions, organized by version number with descriptions of planned features and future considerations.
- `docs/**.md` — features documented in individual markdown files. Split/group into a logical system.

## Changelog

Update `CHANGELOG.md` at logical milestones — when a feature is complete, a bug is fixed, or a breaking change is introduced. Follow the format defined in that file. If the file doesn't exist yet, create it following [Keep a Changelog](https://keepachangelog.com/) format with [Semantic Versioning](https://semver.org/).

## Git

Commit messages follow voice rules: plain, direct, specific. No conventional-commit prefixes (`feat:`, `fix:`, `chore:`) — just prose.

- **Summary line**: imperative mood, under ~70 characters. "Add LIDAR scan parsing" not "Added LIDAR scan parsing" or "Adding LIDAR scan parsing."
- **Body** (when needed): blank line after the summary, then prose explaining *why*. Skip the body for trivial changes. Include it when the reasoning won't be obvious from the diff.
- **One logical change per commit.** If a commit message needs "and" to describe what it does, it's probably two commits.

Example:

```
Switch buffer pool to fixed-size allocation

The per-frame allocation strategy produced ~3,600 allocations/minute
at 60 fps, which the GC handled visibly poorly. Fixed-size pool of
64 buffers covers worst-case observed load with ~10% headroom.
```

## Dev Notes

During development, write annotated notes in `project/dev_notes.md`. These notes are the raw material for the tech blog — write them as if explaining the work to a curious engineer, not as dry commit logs.

The blog lives in the DEVLOG repository and has its own editorial guidelines, persona system, and frontmatter schema. When an article is written from these notes, the agent will read `project/dev_notes.md` as primary source material and follow the DEVLOG's `EDITORIAL.md` for voice and structure.

### Structure

Each entry follows this template:

```
## YYYY-MM-DD — Feature Name (Short Description)

### Origin (if applicable)

Where the idea or reference came from. Link to prior art, papers, or codebases.

### Design Decisions

One section per significant choice. Use bold headers for the decision, then explain:

- What was decided and why
- What alternatives were considered
- What tradeoffs were accepted

### Tradeoffs (optional)

Limitations of the current approach and what a future version might change.

### Blog-worthy

One paragraph identifying the most interesting angle for a blog post. What would a reader find surprising, useful, or thought-provoking? This is the hook.

Then add these two fields:

- **Persona:** `adams` or `flight-controller` — which voice fits this material? See `project/brand/voice.md` for the full persona definitions. Use `adams` for narrative-driven pieces about why something was built and how it felt. Use `flight-controller` for precise technical breakdowns where completeness matters more than story arc.
- **Scope:** `standalone` or `series:<name>` — is this a one-off article, or does it belong to an ongoing series? If series, name which one (e.g., `series:copypaste`). If the series doesn't exist yet, say `series:new` and suggest a name.
```

### What to include

- **Every architectural choice.** If you chose approach A over B, explain why. These are the most valuable notes.
- **Bugs and fixes.** When a test failure reveals a design issue (like the regex ordering bug in extract.js, or the currency-before-units detection ordering), document the failure, the root cause, and the fix. These make great blog content.
- **Porting decisions.** When adapting code from a reference project, note what was kept, what was changed, and why. The delta is where the insight lives. Add an attribution comment at the top of the ported source file: origin URL, original author, license. If the license isn't MIT-compatible, flag it before porting.
- **Performance or complexity tradeoffs.** "We used X instead of Y because it covers 80% of cases at 10% complexity" — this kind of reasoning is gold.
- **Interesting patterns.** If a pattern emerged during development that could be reused (bus service pattern, graceful AI degradation, profile-based matching), call it out.

### What NOT to include

- Line-by-line code explanations. The code speaks for itself.
- Boilerplate summaries ("added file X, updated file Y"). That's what the changelog is for.
- TODO lists or future work. Put those in GitHub issues.

### Tone

Follow `project/brand/voice.md`. Write in first person singular ("I chose", "I ported", "I fixed") — these are solo-author projects and the dev notes feed directly into the blog without a pronoun translation step. Be opinionated. Capture the thinking, not just the outcome. It's fine to say "this was the wrong call initially" or "this tradeoff bothers me." Authenticity makes better blog posts than polish.

## README.md

Every project must have a `README.md` with:

- One-line description of what the library does
- Install command
- Quick start code example
- Brief rationale ("why this library")
- Platform support
- Documentation links: overview, API, roadmap, changelog
- License

The README links to docs, not to ARCHITECTURE.md (which is internal). Keep it concise — the docs folder has the detail.

## Package Preparation

Before release, ensure `package.json` includes:

- `name`, `version`, `description`
- `author`: `{ "name": "Fredrik Paulin", "email": "fredrik@rymdskepp.com" }`
- `license`: `"MIT"`
- `repository`: git URL
- `keywords`: relevant search terms for npm discoverability
- `os`: target platforms (e.g. `["darwin", "linux"]`)
- `engines`: `{ "bun": ">=1.2.0" }`
- `files`: array of paths to include in the published package (src/, README.md, LICENSE)
- `exports` and `main`: pointing to `src/index.js`

Include a `LICENSE` file (MIT) with the author's name and current year.

## Code Style

- JavaScript (ES modules), not TypeScript unless a package explicitly requires it.
- Concise functions with minimal abstraction.
- Avoid libraries when Bun or the standard platform provides the capability.
- Use JSON Schema (draft 2020-12) to define data structures.
- No classes unless they meaningfully encapsulate state. Prefer plain functions and objects.

## When in doubt

When a decision isn't covered by this file or `project/brand/voice.md`, ask before guessing. Don't pattern-match to common conventions that may contradict the rules above — most online examples assume Node, Express, TypeScript, classes, and heavy dependency use, all of which are rejected here. A short clarifying question is cheaper than a refactor.

## Completion Checklist

Before declaring a task complete, run through this list. Each item has a corresponding section above that defines the *what* — this list enforces the *that it got done*.

1. **Tests pass.** `bun test tests/` runs clean. New features have dedicated tests.
2. **Bun-native APIs used.** Scan the diff for Node-style imports and APIs that have a Bun-native equivalent (see "Bun-native over Node variants" below).
3. **Docs updated.** New features documented under `docs/`. API changes reflected in `docs/api.md`.
4. **Changelog updated** if the change is a logical milestone (feature complete, bug fixed, breaking change).
5. **Dev notes written** if the work involved a non-trivial architectural choice, bug fix, porting decision, or interesting tradeoff. See the Dev Notes section for the entry template.
6. **Architecture aligned.** If structural changes were made, `ARCHITECTURE.md` reflects them.
7. **Tickets moved.** The ticket for this work is moved from `project/tickets/active/` to `project/tickets/done/`. Any new tickets discovered during the work exist in `project/tickets/backlog/`.
8. **Voice check.** Any prose written — docs, comments, dev notes, commit message — follows `project/brand/voice.md`.

### Bun-native over Node variants

Scan the changed files for Node-style imports and APIs that have a Bun-native equivalent. Replace them. This includes, but is not limited to:

- `node:fs` `readFile` / `writeFile` → `Bun.file(path).text()` / `Bun.write(path, data)`
- `node:fs` `existsSync` → `await Bun.file(path).exists()`
- `express`, `http.createServer` → `Bun.serve()`
- `better-sqlite3`, `sqlite3` → `bun:sqlite`
- `ws` → native `WebSocket` (or `Bun.serve()`'s websocket handler)
- `node-fetch`, `axios` → native `fetch`
- `dotenv` → remove; Bun loads `.env` automatically
- `bcrypt` → `Bun.password.hash` / `Bun.password.verify`
- `crypto.randomUUID` → `crypto.randomUUID()` is fine (native), but check that imports from `node:crypto` aren't used for things Bun exposes globally
- Spawning processes via `node:child_process` → `Bun.spawn()`

These slip in easily because muscle memory and most online examples assume Node. Treat the check as mandatory, not aspirational. If a Node import is genuinely needed (some `node:` modules have no Bun equivalent — `node:os`, `node:path`, `node:url` are fine to use), keep it and note why if it's non-obvious.

Note that some replacements are import-level (`node-fetch` → native `fetch`, one-line diff) while others are API-level and easy to miss. For example:

```js
// Node style — still works under Bun, but not what we want
import { readFile, writeFile } from 'node:fs/promises'
const text = await readFile(path, 'utf8')
await writeFile(path, text)

// Bun-native
const text = await Bun.file(path).text()
await Bun.write(path, text)
```

A grep for `node:` imports won't catch the API-level cases on its own — read the diff, don't just scan imports.
