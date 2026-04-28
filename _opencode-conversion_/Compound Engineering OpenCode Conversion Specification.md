# Compound Engineering OpenCode Conversion Specification

## CONVERSION MANDATE (AI Understanding Requirements)

**This specification is written FOR YOU - the AI model performing the conversion. Human readability is NOT the priority.**

When converting the compound-engineering plugin from Claude Code format to OpenCode format, you MUST follow these rules without exception:

1. **Path Transformations (MANDATORY):**
   - `~/.claude/` → `~/.config/opencode/`
   - `.claude/` → `.opencode/`

2. **Command/Skill Slash Syntax (MANDATORY):**
   - CE commands: `/ce-plan`, `/ce-work`, `/ce-debug`, `/ce-ideate`, `/ce-sessions` etc.
   - Transform TO: `skill({ name: "ce-plan" })`, `skill({ name: "ce-work" })`
   - This applies to slash commands AND skill-internal references: "run /ce-compound" → `skill({ name: "ce-compound" })`

3. **Agent Dispatch via Task/Agent Tool (MANDATORY):**
   - Skills dispatch agents using Task/Agent tool with bare names
   - CE reference: `ce-session-historian`, `ce-learnings-researcher`, `ce-adversarial-reviewer`
   - Transform TO: `@compound-engineering/ce-session-historian`, `@compound-engineering/ce-learnings-researcher`
   - Preserve `ce-` prefix, agent becomes flat `.agent.md` under compound-engineering namespace

4. **Sub-Agent Dispatch via Skill Tool (MANDATORY):**
   - Skills invoke other skills via Skill tool for nested workflows
   - Nested skill invocation: `skill({ name: "ce-plan" })` → same format (skills call skills)
   - This is used when one skill orchestrates another skill

5. **Session Historian Scripts (MANDATORY):**
   - OpenCode 1.14+ uses SQLite database, NOT JSON files
   - Database location: `~/.local/share/opencode/opencode.db`
   - Session table fields: `id`, `project_id`, `directory`, `title`, `slug`, `time_created` (milliseconds), `time_updated`
   - Message table fields: `id`, `session_id`, `time_created`, `data` (JSON blob)
   - Session IDs follow format: `ses_xxx` (e.g., `ses_249b86ed2ffeL7F1UidF1iMi2f`)
   - Message IDs follow format: `msg_xxx` (e.g., `msg_dd23fe8ef002xugBF854qKmDjQ`)
   - Timestamps are in MILLISECONDS - divide by 1000 for Unix epoch
   - Scripts MUST query SQLite, NOT scan filesystem for OpenCode sessions

6. **Prose/Reference Patterns (MANDATORY):**
   - "use ce-X" in text -> `skill({ name: "ce-X" })`
   - "invoke ce-X" in text -> `skill({ name: "ce-X" })`
   - "run /ce-X" in text -> `skill({ name: "ce-X" })`
   - "call ce-X" in text -> `skill({ name: "ce-X" })`
   - Backtick-wrapped `ce-X` -> `skill({ name: "ce-X" })`
   - Colon syntax `compound-engineering:ce-X` (if exists) -> `@compound-engineering/ce-X`

7. **Line Endings (MANDATORY):**
   - Enforce LF (Unix) line endings on ALL written files
   - Convert CRLF to LF if detected

8. **DO NOT TRANSFORM:**
   - `name:` and `description:` fields in frontmatter
   - Platform variable placeholders like `${CLAUDE_PLUGIN_ROOT}`
   - Shell variables containing skill names

9. **Frontmatter Transformations:**
   - Remove: `model:`, `temperature:`, `color:`, `provider` fields
   - Transform: `tools: Read, Grep, Glob, Bash` → `tools:\n  read: true\n  grep: true\n  ...`
   - **CRITICAL: Always ensure proper YAML frontmatter formatting:**
     - Add a blank line **before** the closing `---`
     - The closing `---` must be on its own line, NOT on the same line as the last field
     - After any transformation that modifies frontmatter, verify the format:

       ```
       # BROKEN (YAML parsing error):
       name: ce-plan
       description: "..."---

       # CORRECT:
       name: ce-plan
       description: "..."
       ---
       ```

10. **Output Structure:**
    - Skills: `~/.config/opencode/skills/compound-engineering/<skill-dir>/SKILL.md`
    - Agents: `~/.config/opencode/agents/compound-engineering/<agent-name>.agent.md`
    - Preserve exact folder structure under `compound-engineering/` namespace

11. **Naming Convention:**
    - All skills: prefix `ce-` (e.g., `ce-plan`, `ce-compound`, `ce-session-inventory`)
    - All agents: prefix `ce-` (e.g., `ce-session-historian`, `ce-learnings-researcher`)
    - Preserve prefixes exactly as-is in frontmatter `name:` field

12. **Cross-Reference Patterns (MUST TRANSFORM):**
    - `Task tool: ce-X` → `@compound-engineering/ce-X` (agent dispatch)
    - `load ce-X skill` → `skill({ name: "ce-X" })` (skill invocation)
    - `Spawn ce-X agent` → `@compound-engineering/ce-X` (agent spawn)
    - `/ce-plan` slash command → `skill({ name: "ce-plan" })` (command invocation)

---

**Output Structure**

**Skills:** `~/.config/opencode/skills/compound-engineering/<skill-directory-name>/SKILL.md`  
The converter copies the entire original skill directory (all subfolders and files). All internal references remain relative to the skill root directory. The frontmatter `name:` value is the canonical identifier — independent of the directory name.

**Agents:** `~/.config/opencode/agents/compound-engineering/<agent-name>.agent.md`
The converter writes each agent as a `.agent.md` file (flat structure, no category subfolders, original filename preserved).

**Frontmatter:**  
Retain `name:`, `description:`, and mode fields exactly. Remove hardcoded `model:`, `temperature:`, or provider fields.

---

**Invocation Syntax**

**Agents:** All agent references including bare names (`` `ce-xxx` ``) → `@compound-engineering/ce-xxx`

**Skills:** All skill references including bare names (`` `ce-xxx` ``) → `skill({ name: "ce-xxx" })`

---

**Requirements**

- Replicate exact source directory structure under `compound-engineering/` namespace
- Copy all source files and subdirectories maintaining original names and structure
- Enforce LF line endings on all written files
- Migrate existing CE files from root `skills/` and `agents/` into the `compound-engineering/` subfolder structure before conversion

---

**Reference Detection**

The converter must find and transform all skill and agent references across every `.md` file. References appear in multiple forms.

**Agent reference patterns (from source):**

```
Task research:ce-learnings-researcher(planning context summary)
Spawn a `workflow:ce-pr-comment-resolver` agent per item.
Dispatch `research:ce-slack-researcher` with the user's topic as the task prompt.
- `review:ce-architecture-strategist` for design integrity
- `review:ce-performance-oracle` for scalability
```

**Transform to:**

```
@compound-engineering/ce-learnings-researcher
@compound-engineering/ce-pr-comment-resolver
@compound-engineering/ce-slack-researcher
@compound-engineering/ce-architecture-strategist
@compound-engineering/ce-performance-oracle
```

**Skill reference patterns (from source):**

```
Load the `ce-compound` skill to document what was learned.
recommend `ce-brainstorm` as a suggestion
Inform the user this would benefit from `/ce-brainstorm` or `/ce-plan`
Invoke `ce-work-beta` manually when you want to trial Codex delegation.
```

**Transform to:**

```
skill({ name: "ce-compound" })
skill({ name: "ce-brainstorm" })
skill({ name: "ce-plan" })
skill({ name: "ce-work-beta" })
```

**Search priority:**

1. Unambiguous FQ forms: `compound-engineering:`, `research:`, `document-review:`, `review:`, `workflow:`, `design:`, `docs:` (in agents/skills context)
2. Slash syntax anywhere `/ce-plan`, `/ce-work`
3. Bare names in prose: "load ce-X", "call ce-X", "invoke ce-X"
4. Backtick-enclosed bare names: `ce-X`

**Build the canonical list first:** Collect all `name:` values from all frontmatter in skill SKILL.md files and agent .agent.md files. Then scan each transformed file for references. Any untransformed reference = fail-fast.

**CRITICAL: The canonical lists must be used during transformation, not after.** The transformation logic must check each `/ce-xxx` reference against both lists to determine the correct output format:

```
# Pseudocode for transformation (must use this logic):
for each /ce-xxx reference in source:
    if xxx is in AGENT_CANONICAL_LIST:
        output = @compound-engineering/ce-xxx
    else if xxx is in SKILL_CANONICAL_LIST:
        output = skill({ name: "ce-xxx" })
    else:
        fail-fast (unknown reference!)
```

**Where to get canonical lists:**

```
# From agents/ directory (51 agents):
ls plugins/compound-engineering/agents/*.agent.md | xargs -I{} yq '.name' {}
# Produces: ce-session-historian, ce-pr-comment-resolver, ce-correctness-reviewer, etc.

# From skills/ directory (35 skills):
ls plugins/compound-engineering/skills/*/SKILL.md | xargs -I{} yq '.name' {}
# Produces: ce-plan, ce-work, ce-debug, ce-sessions, etc.
```

**DO NOT infer agent vs skill from suffix patterns alone.** This is error-prone. Always use the canonical lists. The suffix heuristic fails when:

- `ce-pr-comment-resolver` looks like an agent but is actually invoked as a skill
- `ce-session-historian` has `-historian` suffix but is an agent
- New components may have non-standard names

**Validation checklist after conversion:**

1. ❌ Do NOT grep for patterns - use the canonical lists to verify
2. Use transformed output to query: any `@compound-engineering/` that maps to a skill (not agent) = bug
3. Use transformed output to query: any `skill({ name: "ce-xxx" })` where xxx is an agent = bug
4. **Grep for `@compound-engineeringskill`** - this garbled pattern indicates the exact bug we had
5. Grep for `/ce-` - should find zero instances

6. **Grep for `@compound-engineeringskill`** - this garbled pattern indicates the exact bug we had
7. Grep for `/ce-` in SKILL.md only (not references/) - should find zero instances

**Scope:** Only `.agent.md` and `SKILL.md` files are transformed. All files in `references/` subdirectories are **never touched** - they contain documentation, examples, and user-facing instructions that should remain unchanged.

**What TO transform:** All skill/agent references anywhere in these files — including provenance, code blocks, and examples — because they represent actionable invocations the AI should follow.

**Do NOT transform:**

- The `name:` field in frontmatter (stays exactly as-is)
- The `description:` field in frontmatter (stays as-is)
- Shell variable names containing skill names (e.g., `SCRATCH_DIR=".../ce-plan-..."` stays)
- **Remove from agents**: `model:`, `temperature:`, `color:` fields (invalid for target)
- **Transform `tools:` field**: Convert comma-separated list to OpenCode YAML object format

  ```
  # compound-engineering source (invalid)
  tools: Read, Grep, Glob, Bash

  # OpenCode target (valid)
  tools:
    read: true
    grep: true
    glob: true
    bash: true
  ```

---

**Verification**

After conversion, verify all `.agent.md` and `SKILL.md` files contain only the canonical invocation syntax:

- Agents: `@compound-engineering/xxx` format (original filename preserved, including prefix if present)
- Skills: `skill({ name: "..." })` format only
- No slash syntax (`/ce-xxx`), colon syntax (`xxx:ce-yyy`), bare names, or backtick-enclosed names remain

---

## Conversion Rules

### Path Transformations

- `~/.claude/` → `~/.config/opencode/`
- `.claude/` → `.opencode/`

### Tool Name Mapping (TOOL_MAP)

```
todowrite → todowrite
todoread → todoread
(question, task, skill, grep, glob, etc. - unchanged)
```

### Reference Syntax Transformations

| Source Pattern                        | OpenCode Target                           |
| ------------------------------------- | ----------------------------------------- |
| `compound-engineering:cat:agent`      | `@compound-engineering/cat/agent`         |
| `compound-engineering:skill-name`     | `skill({ name: "skill-name" })`           |
| Backtick-wrapped `` `ce-agent` ``     | `@compound-engineering/category/ce-agent` |
| Natural language: "invoke ce-X skill" | `skill({ name: "ce-X" })`                 |

### DO NOT TRANSFORM

- Cross-platform tool documentation (e.g., "`AskUserQuestion` in Claude Code, `request_user_input` in Codex") — preserve as-is
- `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` — no OpenCode equivalent exists, leave unchanged
- Shell variables containing skill names (e.g., `SCRATCH_DIR=".../ce-plan-..."`)

### Pre-Resolution Patterns

Patterns using `!**`command`**` syntax are resolved at runtime. The converter does not transform the content inside backticks — they remain as authored.

### Session Historian Support (OpenCode)

**Critical: OpenCode 1.14+ uses SQLite database, NOT JSON files or JSONL.**

| Platform    | Path                                                  | Format | Key Fields                                                                       |
| ----------- | ----------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| Claude Code | `~/.claude/projects/<encoded-cwd>/`                   | JSONL  | `type`, `content[]`, `gitBranch`, `cwd`                                          |
| OpenCode    | `~/.local/share/opencode/opencode.db`                 | SQLite | `session` table: `id`, `directory`, `title`, `time_created` (ms), `time_updated` |
| OpenCode    | `~/.local/share/opencode/opencode.db`                 | SQLite | `message` table: `id`, `session_id`, `time_created`, `data` (JSON blob)          |
| Codex       | `~/.codex/sessions/YYYY/MM/DD/`                       | JSONL  | `session_meta`, `turn_context`                                                   |
| Cursor      | `~/.cursor/projects/<encoded-cwd>/agent-transcripts/` | JSONL  | `role`, `content[]`                                                              |

**OpenCode SQLite key information:**

- Database: `~/.local/share/opencode/opencode.db`
- Session table: `id` (format: `ses_xxx`), `directory`, `title`, `project_id`, `slug`, `time_created` (MILLISECONDS), `time_updated`
- Message table: `id` (format: `msg_xxx`), `session_id`, `time_created` (MILLISECONDS), `data` (JSON blob)
- Session discovery: Query by directory path substring match
- Message extraction: Query by session_id, parse JSON from data column
- Timestamps: MILLISECONDS - divide by 1000 for Unix epoch

---

_This specification is an LLM prompt reference for transforming Claude Code plugin source files into OpenCode format. It provides transformation rules without implementation code. All rules apply to conversion output only — source files remain unchanged._
