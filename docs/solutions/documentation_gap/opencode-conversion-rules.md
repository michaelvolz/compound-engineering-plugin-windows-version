---
name: opencode-conversion-rules
description: Documented decisions and rules for converting compound-engineering CE files to OpenCode format
problem_type: documentation_gap
tags: [opencode, conversion, compound-engineering, skill, agent]
module: compound-engineering
component: conversion-spec
---

# OpenCode Conversion Rules

## What We Learned

### Scope: Only transform .agent.md and SKILL.md files

Files in `references/` subdirectories are NEVER touched. Files with random names like README.md are also untouched.

### Transformations Applied

| FROM                                       | TO                                               |
| ------------------------------------------ | ------------------------------------------------ |
| `/ce-xxx` (anywhere including code blocks) | `skill({ name: "ce-xxx" })`                      |
| `Task category:ce-agent(...)`              | `Task @compound-engineering/category/agent(...)` |
| `compound-engineering:category:ce-agent`   | `@compound-engineering/category/agent`           |

### Do NOT transform

- `name:` field in frontmatter (stays exactly as-is)
- `description:` field in frontmatter (stays as-is)
- Shell variables: `SCRATCH_DIR=".../ce-plan-..."` (or any variable name pattern)

### Why code blocks should transform

Code blocks (fenced with backticks) containing slash commands like `/ce-code-review` are actionable invocations the AI should follow. They are not documentation - they are instructions like "step 2 runs ce-plan".

### Agent file extension preserved

The source files are `.agent.md` - not renamed to `.md`. The spec says replicate exact folder structure.

---

## Key Decisions Summary

1. **Scope**: Only `.agent.md` and `SKILL.md` files
2. **Transform ALL locations**: prose, code blocks, examples - everything except excluded items
3. **Preserve extensions**: `.agent.md` stays `.agent.md`
4. **Skip references/**: Never touch files in references/ subdirectories
5. **Transform agents first** before skills to avoid conflicts
6. **Skip shell variables**: Variables with skill names like `SCRATCH_DIR` don't transform

---

## Files Generated

Output location: `.context/opencode-conversion/`

```
skills/compound-engineering/
├── ce-plan/SKILL.md
├── ce-work/SKILL.md
├── ce-code-review/SKILL.md
... (43 total)

agents/compound-engineering/
├── review/ce-correctness-reviewer.agent.md
├── research/ce-learnings-researcher.agent.md
... (50 total)
```

---

## When This Applies

This conversion is needed when distributing the compound-engineering plugin to other agent platforms that require different invocation syntax than Claude Code's `/command` format.

- OpenCode uses `skill({ name: "xxx" })`
- Agents use `@compound-engineering/category/name` format
- The original CE format uses `/ce-command` syntax

---

## Related Files

- Specification: `_opencode-conversion_/Compound Engineering OpenCode Conversion Specification.md`
- Test output: `.context/opencode-conversion/` (generated files)
