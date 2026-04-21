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
- R2. FQ agent references in skill AND agent content must be rewritten to subfolder paths (transformSkillContentForOpenCode applies to both)
- R3. Migration: move any existing flat CE files to namespaced subfolders
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

- Happy path: Agent `ce-session-historian` in category `research` becomes `compound-engineering/research/ce-session-historian/` — complete folder copy including all files

**Verification:**

- Agent files written to `agents/compound-engineering/research/session-history/*.md` (not flat)

---

- [ ] **Unit 2: Copy full agent directories in writer**

**Goal:** Copy agent subdirectories alongside the agent `.md` file

**Requirements:** R1

**Dependencies:** Unit 1

**Files:**

- Modify: `src/targets/opencode.ts`

**Approach:**

- Add `sourceDir` to agent entries in bundle (from `agent.sourcePath`)
- Convert main agent `.md` file (apply `transformSkillContentForOpenCode`)
- Copy ALL other files in the agent directory — scripts, documents, images, configs, any filetype. Do NOT transform non-.md files.
- Preserve exact folder structure under `compound-engineering/` namespace
- **Final verify pass:** Scan source directory for any files missed during conversion, copy them to the target location

**Patterns to follow:**

- `copySkillDir(skill.sourceDir, path.join(skillsRoot, sanitizePathName(skill.name)), transformSkillContentForOpenCode, true)`

**Test scenarios:**

- Happy path: Source directory `plugins/compound-engineering/agents/research/session-history-scripts/` copied to output with ALL files (scripts, docs, images, configs — any filetype)
- Happy path: Agent markdown file (`ce-session-historian.agent.md`) transformed and present alongside supporting files

**Verification:**

- `session-history-scripts/` directory exists in output with all files preserved exactly
- All file types copied, not just .md

---

- [ ] **Unit 3: Add migration for flat CE agents**

**Goal:** Move existing flat CE agent files to namespaced subfolders

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
- Happy path: Final verify pass detects and copies any missed files
- Edge case: Agent with no subdirectories works (writes only .md file)
- Edge case: Verify pass handles empty directories gracefully

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
2. Verify `temp-opencode-test/.opencode/agents/compound-engineering/research/session-history-scripts/` contains all scripts
3. Verify `temp-opencode-test/.opencode/skills/compound-engineering/` exists with skills
4. Run `bun test`

## Sources & References

- Origin document: [_opencode-conversion_/CE-in-OpenCode-with-proper-subfolder-structure.md](../_opencode-conversion_/CE-in-OpenCode-with-proper-subfolder-structure.md)
- Related code: `src/converters/claude-to-opencode.ts`, `src/targets/opencode.ts`
