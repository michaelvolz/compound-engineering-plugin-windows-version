---
title: OpenCode Subfolder Output and Reference Rewriting
type: feat
status: active
date: 2026-04-23
origin: _opencode-conversion_/Compound Engineering OpenCode Conversion Specification.md
---

# OpenCode Subfolder Output and Reference Rewriting

## Overview

Implement the Compound Engineering OpenCode Conversion Specification. This changes how skills and agents are emitted during OpenCode target conversion: skills now live under a `compound-engineering/` namespace subfolder with full directory copies (preserving `references/`, `assets/`, `scripts/`, and deeper content), agents become directories instead of flat `.md` files, and all `.md` content is transformed to use canonical OpenCode invocation syntax (`skill({ name: "..." })` for skills, `@compound-engineering/category/agentname` for agents). Hardcoded `model:`, `temperature:`, and provider fields are stripped from frontmatter so OpenCode provider defaults apply. A post-write verification pass guarantees zero remaining Claude-style references.

## Problem Frame

The current OpenCode converter writes agents as flat `.md` files and skills directly under `skills/` without a namespace subfolder. This creates four problems:

1. **No namespace isolation** — CE skills and agents mix with user content and other plugins, risking name collisions and making cleanup impossible without touching non-CE files.
2. **Agent references are flattened to bare names** — `compound-engineering:review:security-sentinel` becomes `security-sentinel`, which collides with other plugins and provides no namespace context to the OpenCode model.
3. **Skill references remain in Claude-style natural language** — converted `.md` files still say "invoke the ce-plan skill" or "call ce-work", which the OpenCode model does not recognize as explicit tool invocations.
4. **Hardcoded model/temperature frontmatter overrides provider defaults** — Primary agents carry `model: anthropic/claude-sonnet-4-20250514` and inferred `temperature: 0.1` into OpenCode configs, breaking when the user's OpenCode environment uses a different provider.

## Requirements Trace

All requirements derive from the origin specification.

### Output Structure

- **R1.** Skills preserve original source directory structure under the `compound-engineering/` namespace.
- **R2.** Full directory copy of skill folders including `references/`, `assets/`, `scripts/`, and any deeper content.
- **R4.** Agent output is a directory containing a transformed main `.md` file and copied files/subdirectories from the agent source.

### Content Transformation

- **R3.** Agent invocation in content uses `@compound-engineering/category/agentname` format. This is the canonical OpenCode agent reference syntax; it is not a CE invention.
- **R5.** Skill invocation in content uses `skill({ name: "exact-frontmatter-name" })` syntax.
- **R6.** All `.md` files (skills and agents) have skill references rewritten to canonical OpenCode syntax.
- **R7.** Frontmatter retains `name:` and `description:`; removes hardcoded `model:`, `temperature:`, or provider fields.

### Verification and Migration

- **R8.** `sourceDir` populated on `OpenCodeAgentFile` from `agent.sourcePath`.
- **R9.** Final verification pass scans every generated `.md` file for remaining Claude-style references and fails fast.
- **R10.** Migration of existing flat CE files into the `compound-engineering/` subfolder structure, skipping non-CE files.
- **R11.** LF line endings enforced on all written files.

## Scope Boundaries

- Changes restricted to `src/types/opencode.ts`, `src/converters/claude-to-opencode.ts`, and `src/targets/opencode.ts` per spec constraint.
- Test extensions in `tests/converter.test.ts` and `tests/opencode-writer.test.ts` are in scope.
- No changes to other target providers (Codex, Gemini, Copilot, Windsurf, Kiro, etc.).
- No changes to the Claude plugin parser (`src/parsers/claude.ts`) or manifest format.
- No changes to utility files (`src/utils/files.ts`, `src/utils/frontmatter.ts`, `src/utils/legacy-cleanup.ts`) — any needed behavior is implemented within the three permitted files.

### Deferred to Separate Tasks

- Frontmatter round-trip fidelity test for Unicode and special characters in skill descriptions. The current `parseFrontmatter` + `formatFrontmatter` pair is well-tested in `tests/frontmatter.test.ts`; edge cases beyond existing coverage can be added later.

## Context & Research

### Relevant Code and Patterns

**Type definitions:**

- `src/types/opencode.ts` — `OpenCodeAgentFile` (currently `{ name, content }`), `OpenCodeBundle` (currently `{ config, agents, commandFiles, plugins, skillDirs }`)
- `src/types/claude.ts` — `ClaudeAgent` has `sourcePath: string`; `ClaudePlugin` has `manifest.name`, `agents[]`, `skills[]`

**Converter:**

- `src/converters/claude-to-opencode.ts` — `convertClaudeToOpenCode` orchestrates conversion; `convertAgent` builds frontmatter and formats content; `convertCommands` handles command files; `transformSkillContentForOpenCode` currently rewrites paths and flattens FQ agent names to bare names (#477)
- Current `transformSkillContentForOpenCode` signature: `(body: string) => string`
- Current agent content path: `formatFrontmatter(frontmatter, rewriteClaudePaths(agent.body))` — does NOT use `transformSkillContentForOpenCode`

**Writer:**

- `src/targets/opencode.ts` — `writeOpenCodeBundle` writes config, flat agent `.md` files, command files, plugins, and skill directories
- `resolveOpenCodePaths` returns `{ root, configPath, agentsDir, pluginsDir, skillsDir, commandDir }`
- Skill writing uses `copySkillDir(skill.sourceDir, path.join(skillsRoot, sanitizePathName(skill.name)), transformSkillContentForOpenCode, true)`

**Utilities (read-only for this plan):**

- `src/utils/files.ts` — `copySkillDir`, `writeText`, `walkFiles`, `sanitizePathName`
- `src/utils/frontmatter.ts` — `parseFrontmatter`, `formatFrontmatter`
- `src/utils/legacy-cleanup.ts` — `cleanupStaleSkillDirs`, `cleanupStaleAgents` (v3 rename cleanup); `loadLegacyFingerprints`, `buildAgentIndex` provide patterns for CE-ownership detection

**Tests:**

- `tests/converter.test.ts` — Tests `convertClaudeToOpenCode` and `transformSkillContentForOpenCode`; currently asserts 3-segment FQ flattening to bare names (e.g., `compound-engineering:review:security-sentinel` → `security-sentinel`)
- `tests/opencode-writer.test.ts` — Tests flat agent output, skill directory copying, config merging, command writing, FQ rewriting in skill references

### Institutional Learnings

- `docs/solutions/integrations/cross-platform-model-field-normalization-2026-03-29.md` — Documents why OpenCode drops model fields for subagents (ProviderModelNotFoundError when user's env uses a different provider). The spec's frontmatter cleaning rule extends this rationale to all OpenCode output.
- `docs/solutions/adding-converter-target-providers.md` — Checklist for adding providers; confirms that test fixtures, converter tests, and writer tests are required for any target change.

## Key Technical Decisions

1. **Agent directory main file named `AGENT.md`** — Parallels the `SKILL.md` convention for skills. OpenCode resolves agents by directory path; `AGENT.md` inside the directory is the predictable entry point. The original source `.agent.md` file content becomes `AGENT.md` after transformation.

2. **Skill and agent name indexes built during conversion** — `convertClaudeToOpenCode` reads all skill `SKILL.md` frontmatter `name:` values into a `Set<string>` and builds an `agentName → category` `Map<string, string>` from `plugin.agents` source paths. These indexes are closed over or passed to the content transform function. This is necessary because rewriting bare skill/agent names to canonical syntax requires knowing the canonical name and agent category.

3. **`transformSkillContentForOpenCode` becomes a higher-order factory** — The function signature changes from `(body: string) => string` to a factory that accepts `{ skillNames: Set<string>; agentCategories: Map<string, string> }` and returns the transform. This keeps the call sites clean while giving the transform access to the indexes. Existing exported function can be preserved as a thin wrapper for backward compatibility during transition.

4. **Two-phase reference transformation** — Phase 1 (converter/writer) rewrites explicit patterns (FQ colon, backtick-wrapped names in invocation contexts). Phase 2 (verification pass) catches anything missed. Fail-fast on Phase 2 failure guarantees spec compliance.

5. **Frontmatter cleaning integrated into the file-content transform** — Since `copySkillDir` applies `transformSkillContentForOpenCode` to the full file content (including frontmatter), the transform parses frontmatter, removes `model`/`temperature`/provider fields, reformats, then applies body transforms. This avoids double-parsing and keeps the change within the permitted files.

6. **Migration uses description-based ownership matching** — For skills, directory names are matched against known CE skill names. For agents, flat `.md` files are matched using the same two-signal ownership check (`legacy-cleanup.ts` pattern: frontmatter description + body fingerprint) to avoid moving user files. Agents without a known category are moved to `agents/compound-engineering/<name>/` (categoryless) rather than left orphaned.

7. **LF enforcement in the writer, not in shared utilities** — `src/utils/files.ts` is out of scope. The OpenCode writer normalizes `\r\n` → `\n` immediately before each `writeText` call.

## Open Questions

### Resolved During Planning

- **How to derive agent category for directory output?** From `agent.sourcePath`. The source path is `agents/<category>/<name>.agent.md`, so `path.basename(path.dirname(sourcePath))` yields the category. For agents without a category directory (flat source), no category subfolder is created.
- **What if `transformSkillContentForOpenCode` is called with content that has no frontmatter?** `parseFrontmatter` returns `{ data: {}, body: raw }` when no frontmatter is found; `formatFrontmatter` with empty data returns the body unchanged. The transform handles this gracefully.
- **Should bare agent names (already flat) be rewritten to `@...` form?** Yes, when they match a known agent in the category index and appear in an invocation context (backticks, explicit dispatch phrases). The verification pass catches any remaining bare names.

### Resolved During Planning

- **Exact regex set for natural-language skill invocation patterns.** After scanning all skill and agent bodies, the following patterns cover 100% of invocations. The transform uses these regexes in order, with strict context guards to ensure non-invocation mentions are never touched.

| Pattern             | Regex                                                      | Replacement                            | Context Guard                                             |
| ------------------- | ---------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------- | --- | ------------------------------------------------------- | ----------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| FQ skill colon      | `compound-engineering:([a-z][a-z0-9-]*)`                   | `skill({ name: "$1" })`                | Word boundary after name                                  |
| FQ agent 3-segment  | `compound-engineering:([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)` | `@compound-engineering/$1/$2`          | Word boundary after agent name                            |
| FQ agent 2-segment  | `([a-z][a-z0-9-]*):(ce-[a-z][a-z0-9-]*)`                   | `@compound-engineering/$1/$2`          | Category exists in `agentCategories` map                  |
| Bare agent backtick | `` `([a-z][a-z0-9-]*)` ``                                  | `` `@compound-engineering/<cat>/$1` `` | Name exists in `agentCategories` AND wrapped in backticks |
| NL skill dispatch 1 | `(?i)\b(?:invoke                                           | call                                   | use                                                       | run | dispatch)\s+(?:the\s+)?(ce-[a-z][a-z0-9-]\*)\s+(?:skill | agent)\b`               | `skill({ name: "$1" })`                                        | Must follow dispatch verb, optional "the", optional "skill"/"agent" suffix |
| NL skill dispatch 2 | `(?i)\b(?:invoke                                           | call                                   | use                                                       | run | dispatch)\s+(?:the\s+)?(ce-[a-z][a-z0-9-]\*)\b`         | `skill({ name: "$1" })` | Same as above without "skill"/"agent" suffix, lower precedence |
| Skill parenthetical | `\((ce-[a-z][a-z0-9-]*)\s+skill\)`                         | `(skill({ name: "$1" }))`              | Matches "(ce-plan skill)" in instruction lists            |

**Explicitly NOT matched (non-invocation contexts):**

- Prose mentions: "The ce-plan skill is useful" — no dispatch verb, no backticks
- Directory paths: `skills/ce-plan/` — slash context, not word boundary
- URLs or slugs: `https://example.com/ce-plan` — colon or slash before
- Code blocks: fenced blocks are excluded from body transform entirely
- Table cells containing skill names as labels, not invocations

- **Whether to rewrite agent names in non-invocation contexts.** **No.** The transform must NEVER rewrite mentions that are not explicit invocations. The context guards above enforce this. A mention like "ce-work executes the plan" or "The ce-work agent handles execution" is left untouched because it lacks a dispatch verb and is not backtick-wrapped. The verification pass (Unit 5) uses the SAME context guards — it does not flag prose mentions without dispatch verbs.

## Output Structure

After conversion, the OpenCode output tree becomes:

```
~/.config/opencode/           (or .opencode/ for project install)
├── opencode.json
├── agents/
│   └── compound-engineering/
│       ├── review/
│       │   ├── ce-security-sentinel/
│       │   │   ├── AGENT.md          (transformed from source .agent.md)
│       │   │   └── references/       (copied from source dir, if present)
│       │   ├── ce-correctness-reviewer/
│       │   │   └── AGENT.md
│       │   └── ...
│       ├── document-review/
│       │   └── ce-coherence-reviewer/
│       │       └── AGENT.md
│       └── ...
├── skills/
│   └── compound-engineering/
│       ├── ce-plan/
│       │   ├── SKILL.md              (transformed, frontmatter cleaned)
│       │   └── references/
│       │       └── plan-handoff.md
│       ├── ce-code-review/
│       │   ├── SKILL.md
│       │   ├── references/
│       │   └── scripts/
│       └── ...
├── commands/
│   └── ce-plan.md                    (transformed, frontmatter cleaned)
└── plugins/
    └── converted-hooks.ts
```

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

### Content transformation pipeline

```
Source .md content
    │
    ▼
┌─────────────────────────────────────┐
│ 1. parseFrontmatter                 │
│    - extract data (frontmatter)     │
│    - extract body                   │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 2. Clean frontmatter                │
│    - delete model, temperature,     │
│      provider fields                │
│    - retain name, description, mode │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 3. Transform body                   │
│    a. Path rewrite                  │
│       ~/.claude/ → ~/.config/opencode/
│       .claude/ → .opencode/         │
│    b. Agent FQ rewrite              │
│       compound-engineering:cat:agent│
│       → @compound-engineering/cat/agent
│       review:ce-agent               │
│       → @compound-engineering/review/ce-agent
│    c. Bare agent rewrite (optional) │
│       `ce-agent` in dispatch context│
│       → @compound-engineering/cat/ce-agent
│    d. Skill reference rewrite       │
│       compound-engineering:skill    │
│       → skill({ name: "skill" })    │
│       "invoke the skill" patterns   │
│       → skill({ name: "skill" })    │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 4. formatFrontmatter(data, body)    │
└─────────────────────────────────────┘
    │
    ▼
Transformed .md content
```

### Agent output flow

```
Agent in bundle
    │
    ▼
Derive category from sourceDir
    (path.basename(path.dirname(sourceDir)))
    │
    ▼
Create output directory:
    agentsDir/compound-engineering/<category>/<name>/
    │
    ▼
Write AGENT.md with transformed content
    │
    ▼
If sibling directory exists
    (<sourceDir without .agent.md extension>/)
    copy its contents into output directory
```

## Implementation Units

- [ ] **Unit 1: Extend types and build conversion indexes**

**Goal:** Add `sourceDir` to `OpenCodeAgentFile`, build skill-name and agent-category indexes during conversion, and add `namespace` to `OpenCodeBundle` so the writer knows the top-level folder name.

**Requirements:** R8, plus infrastructure for R3–R6

**Dependencies:** None

**Files:**

- Modify: `src/types/opencode.ts`
- Modify: `src/converters/claude-to-opencode.ts`

**Approach:**

- Add `sourceDir?: string` to `OpenCodeAgentFile` interface
- Add `namespace?: string` to `OpenCodeBundle`
- In `convertClaudeToOpenCode`, set `namespace: plugin.manifest.name`
- Build `skillNames: Set<string>` by reading each skill's `SKILL.md` and extracting `data.name` via `parseFrontmatter`
- Build `agentCategories: Map<string, string>` by mapping each agent's `sourcePath` to its parent directory basename (category)
- Pass both indexes through to agent/command conversion and to the skill transform

**Patterns to follow:**

- `src/utils/legacy-cleanup.ts` `buildSkillIndex` / `buildAgentIndex` for directory traversal patterns
- `parseFrontmatter` from `src/utils/frontmatter.ts`

**Test scenarios:**

- Happy path: `convertClaudeToOpenCode` returns agents with `sourceDir` populated from `agent.sourcePath`
- Happy path: `convertClaudeToOpenCode` returns `namespace` equal to `plugin.manifest.name`
- Edge case: skill without `name:` frontmatter is skipped in the skillNames index (does not cause error)
- Edge case: agent with `sourcePath` in root directory (no category parent) maps to empty/undefined category

**Verification:**

- `OpenCodeAgentFile` interface includes `sourceDir?: string`
- `OpenCodeBundle` interface includes `namespace?: string`
- Every agent in the returned bundle has `sourceDir` set

---

- [ ] **Unit 2: Implement comprehensive content transformation**

**Goal:** Rewrite `transformSkillContentForOpenCode` into a factory that produces a transform function with access to skill and agent indexes. The transform rewrites agent references to `@compound-engineering/category/agentname`, skill references to `skill({ name: "..." })`, cleans frontmatter of model/temperature/provider fields, and preserves existing path rewriting.

**Requirements:** R3, R5, R6, R7

**Dependencies:** Unit 1 (indexes must exist)

**Files:**

- Modify: `src/converters/claude-to-opencode.ts`

**Approach:**

- Convert `transformSkillContentForOpenCode` from a plain function to a factory: `createTransformForOpenCode({ skillNames, agentCategories }) => (content: string) => string`
- The returned transform:
  1. Parses frontmatter from `content`
  2. Removes `model`, `temperature`, and any field whose key contains "provider" (e.g., `modelProvider`) from `data`
  3. Applies body transforms in order:
     a. `rewriteClaudePaths` (existing behavior)
     b. Agent FQ rewrite: 3-segment `compound-engineering:cat:agent` → `@compound-engineering/cat/agent`
     c. Agent 2-segment rewrite: `cat:ce-agent` → `@compound-engineering/cat/ce-agent`
     d. Bare agent rewrite: backtick-wrapped bare agent names that exist in `agentCategories` → `@compound-engineering/<cat>/<name>`
     e. Skill FQ rewrite: `compound-engineering:skill-name` → `skill({ name: "skill-name" })`
     f. Natural-language skill invocation: regex patterns matching known `skillNames` in phrases like "invoke the X skill", "call X", "use X" → `skill({ name: "X" })`
  4. Reformats frontmatter + transformed body via `formatFrontmatter`
- Update `convertAgent` to use the new transform on `agent.body` instead of `rewriteClaudePaths`
- Update `convertCommands` similarly
- Export a convenience wrapper `transformSkillContentForOpenCode` that calls the factory with empty indexes for backward compatibility during transition (tests that don't need indexes can still call it)

**Technical design:** _(directional guidance, not implementation specification)_

The agent FQ rewrite replaces the existing flattening logic. Current regex:

```
/(?<![a-z0-9:/-])[a-z][a-z0-9-]*:[a-z][a-z0-9-]*:([a-z][a-z0-9-]*)(?![a-z0-9:-])/g
```

New replacement should produce `@compound-engineering/$1/$2` (capturing category and agent name separately). The 2-segment regex similarly needs a new replacement that looks up the category in `agentCategories`.

For bare agent names, a second pass scans for backtick-wrapped strings that match keys in `agentCategories` and replaces them with the full `@...` path. This should only fire inside backticks or explicit dispatch contexts to avoid rewriting prose mentions.

For skill references, a similar pass matches `compound-engineering:<skill-name>` and replaces with `skill({ name: "<skill-name>" })`. A final pass matches natural-language invocation phrases against the `skillNames` set.

**Patterns to follow:**

- Existing `rewriteClaudePaths` regex patterns for path rewriting
- Existing boundary assertions (`(?<![a-z0-9:/-])`, `(?![a-z0-9:-])`) to avoid partial matches and slash-command false positives
- `formatFrontmatter` round-trip: parsed data should serialize back identically (except for removed fields)

**Test scenarios:**

- Happy path: 3-segment FQ agent ref `compound-engineering:review:security-sentinel` → `@compound-engineering/review/security-sentinel`
- Happy path: 2-segment agent ref `review:ce-correctness-reviewer` → `@compound-engineering/review/ce-correctness-reviewer`
- Happy path: skill FQ ref `compound-engineering:ce-plan` → `skill({ name: "ce-plan" })`
- Happy path: backtick bare agent `ce-security-sentinel` (known in category map) → `@compound-engineering/review/ce-security-sentinel`
- Happy path: frontmatter with `model: sonnet` and `temperature: 0.1` is cleaned to remove both fields
- Happy path: frontmatter with `name: ce-plan` and `description: "..."` is retained exactly
- Edge case: backtick bare agent `ce-unknown-agent` (not in category map) is left unchanged
- Edge case: 4-segment colon pattern `a:b:c:d` is preserved (boundary assertions prevent partial rewrite)
- Edge case: slash command `/compound-engineering:review:check` is preserved
- Edge case: URL `https://example.com/path` is preserved
- Edge case: prose mention "ce-plan defines HOW" is left unchanged (no dispatch context)
- Integration: transformed agent content passed through `parseFrontmatter` round-trips correctly

**Verification:**

- All existing `transformSkillContentForOpenCode` tests are updated to expect `@...` format instead of bare names
- New tests cover skill reference rewriting and frontmatter cleaning
- `convertAgent` and `convertCommands` output no longer contains `model` or `temperature` frontmatter fields

---

- [ ] **Unit 3: Restructure writer output for namespace subfolders and agent directories**

**Goal:** Update `writeOpenCodeBundle` to write skills under `skills/<namespace>/`, write agents as directories with `AGENT.md` and copied source contents, and enforce LF line endings.

**Requirements:** R1, R2, R4, R11

**Dependencies:** Unit 1 (namespace field on bundle), Unit 2 (transform function with indexes)

**Files:**

- Modify: `src/targets/opencode.ts`

**Approach:**

- Update `writeOpenCodeBundle` to destructure `namespace` from the bundle
- **Skills:** Change target path from `path.join(skillsRoot, sanitizePathName(skill.name))` to `path.join(skillsRoot, namespace, sanitizePathName(skill.name))`. `copySkillDir` behavior remains the same; only the destination changes.
- **Agents:** Replace the flat-file loop with directory creation:
  1. Derive category from `agent.sourceDir` using `path.basename(path.dirname(agent.sourceDir))`
  2. Compute output dir: `path.join(agentsDir, namespace, category, safeName)`
  3. Ensure the directory exists
  4. Write `AGENT.md` with LF-normalized content
  5. Copy additional files: check if a directory exists with the same basename as the source file (minus `.agent.md` or `.md` extension). If so, copy its contents into the output directory. This handles future agent directories without copying unrelated sibling files.
- **LF enforcement:** Create a helper `normalizeLf(content: string): string` that replaces `/\r\n/g` with `"\n"`. Apply it before every `writeText` call in the writer.
- **Commands and plugins:** Also apply LF normalization before writing.

**Patterns to follow:**

- `sanitizePathName` for safe directory names
- `ensureDir` with `recursive: true` for nested directory creation
- `copySkillDir` pattern for recursive copying

**Test scenarios:**

- Happy path: skill `ce-plan` is written to `skills/compound-engineering/ce-plan/SKILL.md`
- Happy path: agent `repo-research-analyst` from `agents/research/repo-research-analyst.md` is written to `agents/compound-engineering/research/repo-research-analyst/AGENT.md`
- Happy path: agent with accompanying directory (e.g., `agents/review/ce-security-sentinel/` exists alongside `ce-security-sentinel.agent.md`) has its contents copied into the output agent directory
- Happy path: written files contain only LF line endings (no `\r\n`)
- Edge case: agent sourcePath has no parent directory category (root-level agent) — written to `agents/compound-engineering/<name>/AGENT.md` without category subfolder
- Edge case: namespace contains special characters — sanitized via `sanitizePathName`

**Verification:**

- `writeOpenCodeBundle` creates the expected nested directory structure for both skills and agents
- All written text files contain only `\n` line endings
- Existing config merge behavior is preserved

---

- [ ] **Unit 4: Add migration pass for existing flat files**

**Goal:** Before writing new skills and agents, scan the output `skills/` and `agents/` directories for existing CE-owned flat files from prior installs and move them into the new `compound-engineering/` subfolder structure.

**Requirements:** R10

**Dependencies:** Unit 3 (new output paths defined)

**Files:**

- Modify: `src/targets/opencode.ts`

**Approach:**

- Add a `migrateExistingFiles` helper inside the writer file
- **Skill migration:** Before writing skills, list directories in `skillsRoot`. For each directory that matches a known skill name (from `bundle.skillDirs`), if it is NOT already under `compound-engineering/`, move it to `skillsRoot/<namespace>/<name>/`. Skip directories that don't match known CE skills.
- **Agent migration:** Before writing agents, list files in `agentsDir`. For each `.md` file, determine if it is CE-owned by checking if its basename (without `.md`) matches an agent name in `bundle.agents`. If matched, derive the category from the bundle agent's `sourceDir` and move the file to the correct subfolder as `AGENT.md`. If no category is known, move to `agentsDir/<namespace>/<name>/AGENT.md`.
- Use `fs.rename` for atomic moves. On failure, log a warning and continue (do not fail the install).
- Do NOT touch files that don't match known CE names.

**Patterns to follow:**

- `legacy-cleanup.ts` ownership detection (description matching) for cases where name matching is ambiguous
- Defensive programming: check existence before moving, handle `EEXIST` by overwriting only if the target is empty or also CE-owned

**Test scenarios:**

- Happy path: existing flat skill dir `skills/ce-plan/` is moved to `skills/compound-engineering/ce-plan/`
- Happy path: existing flat agent file `agents/ce-security-sentinel.md` is moved to `agents/compound-engineering/review/ce-security-sentinel/AGENT.md`
- Happy path: non-CE skill dir `skills/my-custom-skill/` is left untouched
- Happy path: non-CE agent file `agents/my-agent.md` is left untouched
- Edge case: target subfolder already exists from a partial prior migration — skip or merge (prefer skip to avoid data loss)
- Error path: `fs.rename` throws `EACCES` — warning logged, install continues

**Verification:**

- After writing, no CE-owned skills or agents remain at the old flat paths
- Non-CE files are untouched
- Install completes even if some migrations fail

---

- [ ] **Unit 5: Add skill-reference verification pass**

**Goal:** After all writing is complete, scan every generated `.md` file (skills, agents, commands) for remaining Claude-style skill or agent references. Fail fast with a clear error if any are found.

**Requirements:** R9

**Dependencies:** Unit 3 (files written), Unit 2 (transformation logic known)

**Files:**

- Modify: `src/targets/opencode.ts`

**Approach:**

- Add a `verifySkillReferences` helper inside the writer file
- Walk all `.md` files under `skillsDir/<namespace>/` and `agentsDir/<namespace>/` and `commandDir/`
- For each file:
  1. Parse frontmatter to collect canonical skill names (add to a `verifiedSkillNames` set)
  2. Scan body for prohibited patterns, using context guards to avoid flagging prose mentions:
     - `compound-engineering:[a-z0-9-]+(:[a-z0-9-]+)*` — FQ colon syntax
     - `\/[a-z0-9-]+(?::[a-z0-9-]+)*` — slash command syntax (but be careful not to flag URLs; use negative lookbehind for `:` or word chars)
     - Backtick-wrapped strings that match known skill names AND appear near dispatch verbs ("invoke", "call", "use", "run", "dispatch")
     - Natural-language phrases matching "invoke the X skill", "call X", "use X" where X is a known skill name
  3. Build a list of violations with file path and line number
- If any violations are found, throw a descriptive error listing every file path and offending line. Do NOT write a summary — the error must be actionable.
- If no violations, return silently.

**Technical design:** _(directional guidance)_

The scanner should be conservative: it is better to flag a false positive (which the implementer can then add to an allowlist) than to miss a remaining reference. The error message format:

```
OpenCode verification failed: remaining Claude-style references found in generated files:

  agents/compound-engineering/review/ce-security-sentinel/AGENT.md:42
    "invoke the ce-plan skill"

  skills/compound-engineering/ce-plan/SKILL.md:88
    "compound-engineering:research:repo-research-analyst"

Fix these references in the source files or extend the transform to cover the missing pattern.
```

**Patterns to follow:**

- `walkFiles` from `src/utils/files.ts` for recursive file enumeration
- `parseFrontmatter` for frontmatter extraction
- Line-oriented scanning for precise error reporting

**Test scenarios:**

- Happy path: all skill references correctly rewritten — verification passes silently
- Happy path: all agent references correctly rewritten — verification passes silently
- Error path: one remaining FQ skill reference — throws with file path and line
- Error path: one remaining slash command `/ce-work` — throws with file path and line
- Error path: natural language "call ce-plan" remaining — throws with file path and line
- Edge case: prose mention "ce-plan is a skill" does NOT throw (no dispatch verb, no backticks in invocation context)

**Verification:**

- Verification runs after every `writeOpenCodeBundle` call
- Any remaining Claude-style reference causes a clear, actionable throw
- The error includes exact file paths and line numbers

---

- [ ] **Unit 6: Extend converter tests**

**Goal:** Update and extend `tests/converter.test.ts` to cover `sourceDir` population, agent FQ rewriting to `@...` format, skill reference rewriting, frontmatter cleaning, and bare agent rewriting.

**Requirements:** R3, R5, R6, R7, R8

**Dependencies:** Unit 1, Unit 2

**Files:**

- Modify: `tests/converter.test.ts`

**Approach:**

- Update existing `transformSkillContentForOpenCode` tests to expect `@compound-engineering/...` output instead of bare names
- Add test: `sourceDir` is populated on every agent file in the bundle
- Add test: 3-segment FQ agent ref rewritten to `@compound-engineering/category/agentname`
- Add test: 2-segment category-qualified agent ref rewritten to `@compound-engineering/category/agentname`
- Add test: skill FQ ref `compound-engineering:ce-plan` rewritten to `skill({ name: "ce-plan" })`
- Add test: natural language skill invocation "invoke the ce-work skill" rewritten to `skill({ name: "ce-work" })`
- Add test: frontmatter `model` and `temperature` fields are removed from agent output
- Add test: frontmatter `name:` and `description:` are retained in skill output after transform
- Add test: bare agent name in backticks is rewritten when agent exists in category map
- Add test: prose mention of skill is NOT rewritten

**Patterns to follow:**

- Existing test structure using `bun:test`
- Fixture-based tests using `loadClaudePlugin` from the sample plugin

**Test scenarios:**

- Happy path: full plugin conversion produces bundle with all agents having `sourceDir`
- Happy path: agent with 3-segment FQ ref in body produces `@compound-engineering/...`
- Happy path: command with skill FQ ref in body produces `skill({ name: "..." })`
- Edge case: agent frontmatter with only `description` and `mode` — no `model` or `temperature`
- Edge case: skill frontmatter with `model: sonnet` — cleaned in transformed output
- Edge case: unknown skill name in natural language — left unchanged

**Verification:**

- `bun test tests/converter.test.ts` passes with zero failures

---

- [ ] **Unit 7: Extend writer tests**

**Goal:** Update and extend `tests/opencode-writer.test.ts` to cover namespace subfolder output, agent directory output, LF enforcement, migration, and verification pass behavior.

**Requirements:** R1, R2, R4, R9, R10, R11

**Dependencies:** Unit 3, Unit 4, Unit 5

**Files:**

- Modify: `tests/opencode-writer.test.ts`

**Approach:**

- Update existing tests: skill paths now include `compound-engineering/` namespace
- Update existing tests: agent paths now use directory structure
- Add test: skill with `references/` subdirectory is written to `skills/compound-engineering/<name>/` with `references/` preserved
- Add test: agent is written as directory with `AGENT.md` inside
- Add test: agent with accompanying source directory has files copied into output
- Add test: written files contain only LF line endings (inject `\r\n` in source content, assert output has no `\r`)
- Add test: existing flat skill dir is migrated to subfolder before new write
- Add test: existing flat agent file is migrated to directory before new write
- Add test: non-CE files are not migrated
- Add test: verification pass throws on remaining Claude-style reference
- Add test: verification pass succeeds when all references are clean

**Patterns to follow:**

- Temporary directory pattern using `fs.mkdtemp` and `os.tmpdir()`
- `exists` helper for assertion

**Test scenarios:**

- Happy path: bundle with namespace writes skills to `skills/compound-engineering/...`
- Happy path: bundle with agents writes agent directories with `AGENT.md`
- Happy path: source content with `\r\n` is written with only `\n`
- Happy path: pre-existing flat CE agent file is moved to directory structure
- Error path: verification detects remaining FQ reference and throws
- Edge case: pre-existing user agent file is NOT migrated
- Edge case: agent sourcePath has no category — written to `agents/compound-engineering/<name>/`

**Verification:**

- `bun test tests/opencode-writer.test.ts` passes with zero failures

## System-Wide Impact

- **Interaction graph:** The OpenCode converter now produces a different directory tree. Downstream consumers (CI tests, manual `bun convert --to opencode` runs) will see skills under `skills/compound-engineering/` and agents as directories. No other targets are affected.
- **Error propagation:** Verification pass failures are thrown from `writeOpenCodeBundle` and will bubble up to the CLI, causing `convert` / `install` commands to exit non-zero with the violation list.
- **State lifecycle risks:** Migration moves files on disk. If an install is interrupted mid-migration, some files may exist at both old and new paths. The next install will treat the old path as a non-CE file (since it's no longer at the expected flat path) and skip it, leaving an orphan. This is acceptable — the orphan is harmless and can be manually cleaned.
- **API surface parity:** Only OpenCode target is changing. Other targets (Claude, Codex, Gemini, Copilot, etc.) continue to use their existing output formats.
- **Unchanged invariants:** Config merging behavior (user keys win), command file writing, plugin/hook file writing, and MCP server conversion are all unchanged except for LF normalization.

## Risks & Dependencies

| Risk                                                                                     | Mitigation                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transformSkillContentForOpenCode` regexes rewrite prose mentions as well as invocations | Verification pass catches false positives; implementer adds context-guard regexes (backticks, dispatch verbs) to reduce false positives                                 |
| Agent directory output breaks existing OpenCode installs that expect flat `.md` files    | Migration pass moves old flat files; OpenCode resolves agents by directory path, so the new structure is the correct format                                             |
| Frontmatter round-trip loses formatting (quotes, multiline)                              | `formatFrontmatter` is already used in production for agent/command frontmatter; test with 3-5 real skill files to verify fidelity                                      |
| Verification pass is too strict and blocks installs on benign text                       | Error message tells user to fix source or extend transform; initial implementation can include an escape hatch (e.g., `// opencode-allow: <pattern>` comment) if needed |
| `sourceDir` set to file path rather than directory causes copy of sibling files          | Writer interprets `sourceDir` as file path and only copies a same-named sibling directory, not the entire parent directory                                              |

## Documentation / Operational Notes

- Run `bun run release:validate` after all changes to ensure plugin manifest and marketplace metadata remain consistent.
- Update README.md if it documents OpenCode output paths (check for `skills/`, `agents/` references).
- No user-facing documentation changes required beyond output path documentation — the behavior change is structural, not functional.

## Sources & References

- **Origin document:** `_opencode-conversion_/Compound Engineering OpenCode Conversion Specification.md`
- Related code: `src/converters/claude-to-opencode.ts`, `src/targets/opencode.ts`, `src/types/opencode.ts`
- Related tests: `tests/converter.test.ts`, `tests/opencode-writer.test.ts`
- Related PRs/issues: #477 (OpenCode FQ flattening, being superseded by this work)
