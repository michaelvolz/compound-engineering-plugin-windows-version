# Compound Engineering OpenCode Conversion Specification

**PRIORITY REQUIREMENT - MUST BE FOLLOWED ABOVE ALL ELSE**  
The converter MUST replicate the exact folder structure from the source, including all files, subdirectories, and names, with the only modification being the addition of the `compound-engineering` namespace folder. Under this namespace, the folder structure and file names must be identical to the source. This is non-negotiable and takes precedence over all other requirements.

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

**Scope:** Only `.agent.md` and `SKILL.md` files are transformed. All files in `references/` subdirectories are NEVER touched.

**What TO transform:** All skill/agent references anywhere in these files — including prose, code blocks, and examples — because they represent actionable invocations the AI should follow.

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

This specification is complete and authoritative.
