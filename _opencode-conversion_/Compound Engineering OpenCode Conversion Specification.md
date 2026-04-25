# Compound Engineering OpenCode Conversion Specification

**PRIORITY REQUIREMENT - MUST BE FOLLOWED ABOVE ALL ELSE**  
The converter MUST replicate the exact folder structure from the source, including all files, subdirectories, and names, with the only modification being the addition of the `compound-engineering` namespace folder. Under this namespace, the folder structure and file names must be identical to the source. This is non-negotiable and takes precedence over all other requirements.

---

**Output Structure**

**Skills:** `~/.config/opencode/skills/compound-engineering/<skill-directory-name>/SKILL.md`  
The converter copies the entire original skill directory (all subfolders and files). All internal references remain relative to the skill root directory. The frontmatter `name:` value is the canonical identifier — independent of the directory name.

**Agents:** `~/.config/opencode/agents/compound-engineering/[category]/<agent-directory-name>/`  
The converter writes the transformed main `.md` file and copies all other files and subdirectories from the source.

**Frontmatter:**  
Retain `name:`, `description:`, and mode fields exactly. Remove hardcoded `model:`, `temperature:`, or provider fields.

---

**Invocation Syntax**

**Agents:** `compound-engineering:category:agentname` → `@compound-engineering/category/agentname`  
Use the full path exactly. Never use bare agent names, colon syntax, or any shortened form.

**Skills:** All skill references (natural language, FQ form, bare names) → `skill({ name: "exact-value-from-frontmatter-name" })`  
Never use slash syntax, dollar syntax, or any other form.

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
@compound-engineering/research/ce-learnings-researcher
@compound-engineering/workflow/ce-pr-comment-resolver
@compound-engineering/research/ce-slack-researcher
@compound-engineering/review/ce-architecture-strategist
@compound-engineering/review/ce-performance-oracle
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
2. Backtick-enclosed bare names adjacent to action verbs: "load ce-X", "call ce-X", "invoke ce-X", "use ce-X", "run ce-X"
3. Slash syntax in prose: `/ce-plan`, `/ce-work`
4. Frontmatter `name:` field values used in prose as instructions

**Build the canonical list first:** Collect all `name:` values from all frontmatter in skill SKILL.md files. Then scan each generated `.md` file for each canonical name. Any match outside fenced code blocks = fail-fast with file and line.

**Do NOT transform:**

- References inside fenced code blocks (\`\`\`) or inline code (\`\`\`)
- Shell variable names that happen to contain skill names (e.g., `SCRATCH_DIR=".../ce-plan-..."`)
- The `name:` field itself in frontmatter
- The frontmatter `description:` field (natural language is acceptable there)
- References in `references/` files that are data paths or cache keys, not invocation instructions

---

**Verification**

After conversion, verify all generated `.md` files contain only the canonical invocation syntax:

- Agents: `@compound-engineering/...` format only
- Skills: `skill({ name: "..." })` format only
- No slash syntax, dollar syntax, colon syntax, bare names, or natural language references remain

This specification is complete and authoritative.
