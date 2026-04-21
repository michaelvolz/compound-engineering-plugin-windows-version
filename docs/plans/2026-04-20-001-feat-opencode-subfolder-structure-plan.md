---
title: feat: OpenCode Subfolder Structure and Agent Directory Copies
type: feat
status: active
date: 2026-04-20
origin: _opencode-conversion_/CE-in-OpenCode-with-proper-subfolder-structure.md
---

# feat: OpenCode Subfolder Structure and Agent Directory Copies

## Overview

Implement proper subfolder structure for OpenCode conversion, matching Claude Code's hierarchical layout. Agents with subdirectories (like `session-history-scripts/`) must be fully copied, not flattened to single `.md` files.

## Problem Frame

The current OpenCode converter writes agents as flat `.md` files directly in `agents/`, losing subdirectory structures like `session-history-scripts/` that contain supporting scripts. Skills are correctly copied as full directories, but agents are not.

## Requirements Trace

- R1. Agents with subdirectories must copy the full directory structure
- R2. FQ agent references in skill AND agent content must be rewritten to subfolder paths (already handled by converter)
- R3. Migration: move any existing flat CE files to namespaced subfolders (DEFERRED to v2)
- R4. Test to temp folder only (no global config during development)

## Scope Boundaries

- This plan covers OpenCode target only (not Codex, Gemini, etc.)
- File inlining (referenced files embedded in skill content) is deferred to a separate implementation unit
- Line ending normalization is deferred (assumes Unix tooling)

## Context & Research

### Relevant Code and Patterns

- `src/converters/claude-to-opencode.ts` — agent conversion, path rewriting
- `src/targets/opencode.ts` — file writing, `copySkillDir` pattern to follow
- Skills already copy full directories via `copySkillDir` — agents should use the same pattern

### Existing Behavior

- Skills: full directory copied via `copySkillDir` (lines 107-117 in opencode.ts)
- Agents: flat `.md` file written via `writeText` (lines 79-89 in opencode.ts)
- Agent names sanitized but no subdirectory handling

## Key Technical Decisions

- Copy agent directories the same way skills are copied (reuse `copySkillDir`)
- Add subfolder prefix during name generation (e.g., `research/session-history` -> `agents/compound-engineering/research/session-history/`)
- No conversion markers — identify CE files by manifest name matching only
- **Add `sourceDir` field to `OpenCodeAgentFile` type** — same pattern as skills, enables directory copying

## Implementation Units

- [ ] **Unit 1: Add subfolder prefix to agent names in converter**

**Goal:** Generate agent names with namespace prefix matching skill behavior

**Requirements:** R1

**Dependencies:** None

**Files:**

- Modify: `src/types/opencode.ts` (add `sourceDir` to `OpenCodeAgentFile` interface)
- Modify: `src/converters/claude-to-opencode.ts`

**Approach:**

- Add `sourceDir` field to `OpenCodeAgentFile` type in `src/types/opencode.ts`
- In converter, populate `sourceDir` from `agent.sourcePath` (derive parent directory path)
- Prepend plugin namespace to agent output names for subfolder placement (e.g., `ce-session-historian` -> `compound-engineering/research/ce-session-historian`)

**Test scenarios:**

- Happy path: Source directory `agents/research/session-history-scripts/` copied AS IS (exact name preserved) to `agents/compound-engineering/research/session-history-scripts/` with all 4 files

**Verification:**

- Agent files written to `agents/compound-engineering/research/session-history-scripts/` with exact source directory name preserved

---

- [ ] **Unit 2: Copy full agent directories in writer**

**Goal:** Copy agent subdirectories alongside the agent `.md` file

**Requirements:** R1

**Dependencies:** Unit 1

**Files:**

- Modify: `src/targets/opencode.ts`

**Approach:**

- Add `sourceDir` to agent entries in bundle (from `agent.sourcePath`)
- Copy entire agent directory from source to output (preserving exact folder name)
- Transform only `.md` files with `transformSkillContentForOpenCode`
- Copy all other file types as-is (scripts, docs, images, configs — any filetype)
- Preserve exact folder structure under `compound-engineering/` namespace

**Patterns to follow:**

- Reuse `copySkillDir` utility from `src/utils/files.ts` for agent directories (same signature as skills)

**Test scenarios:**

- Happy path: Entire `session-history-scripts/` directory copied to output with ALL files preserved exactly
- Happy path: Agent `.md` file transformed, other files copied as-is

**Verification:**

- `session-history-scripts/` directory exists in output with all files preserved exactly
- All file types copied, not just .md

---

- [ ] **Unit 3: Add migration for flat CE agents (DEFERRED to v2)**

**Goal:** Move existing flat CE agent files to namespaced subfolders

**Rationale:** Most users will re-run the converter fresh to get correct output. Migration is needed only for users who ran the old converter and modified their local files. Defer to v2.

**Requirements:** R3

**Dependencies:** Unit 2 complete

**Files:**

- Modify: `src/targets/opencode.ts` or new migration module

**Approach:**

- Scan root `agents/` for CE files (match names against plugin manifest)
- Move to `agents/compound-engineering/<category>/<name>/`
- **Collision handling:** If target exists and content differs, rename source with `-migrated` suffix instead of overwriting
- No backups — fail-fast on errors with clear messages

**Test scenarios:**

- Edge case: Non-CE files in root `agents/` are skipped (not moved)

**Verification:**

- Only CE files are migrated; user files untouched

---

- [ ] **Unit 4: Integration test**

**Goal:** Verify end-to-end conversion produces correct structure

**Requirements:** R4

**Dependencies:** Unit 2 complete

**Files:**

- Add: `tests/opencode-subfolder.test.ts`

**Approach:**

- Run converter with `--output ./temp-opencode-test`
- Verify structure: `agents/compound-engineering/research/session-history-scripts/` exists with scripts
- Verify flat output no longer present

**Test scenarios:**

- Happy path: Full directory structure (`session-history-scripts/`) copied with ALL file types
- Edge case: Agent with no subdirectories (e.g., `ce-best-practices-researcher/`) works — writes only .md file

**Verification:**

- `bun test` passes

## Risks & Dependencies

| Risk                                   | Mitigation                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Breaking existing installations        | Test to temp folder only during dev; add migration path for existing flat agents |
| Agent name conflicts after namespacing | Sanitize + collision detection already present                                   |

## Verification

After all units complete:

1. Run `bun src/index.ts convert plugins/compound-engineering --to opencode --output ./temp-opencode-test`
2. Verify `temp-opencode-test/.opencode/agents/compound-engineering/research/session-history-scripts/` contains all 4 files (exact source copy)
3. Verify `temp-opencode-test/.opencode/skills/compound-engineering/` exists with skill directories
4. Run `bun test`

## Sources & References

- Origin document: [_opencode-conversion_/CE-in-OpenCode-with-proper-subfolder-structure.md](../_opencode-conversion_/CE-in-OpenCode-with-proper-subfolder-structure.md)
- Related code: `src/converters/claude-to-opencode.ts`, `src/targets/opencode.ts`

## Post-Implementation Cleanup

**Remove all debug logging statements** added during development before final commit. Search for patterns like `[DEBUG`, `console.log`, or any temporary logging and remove them.
