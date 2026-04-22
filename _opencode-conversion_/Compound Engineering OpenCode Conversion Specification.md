# Compound Engineering OpenCode Conversion Specification

**Implementation Constraint**  
All changes are restricted exclusively to these three files:  
`src/types/opencode.ts`, `src/converters/claude-to-opencode.ts`, and `src/targets/opencode.ts`.  
No modifications are allowed in any other files.

**Canonical Sources**  
- OpenCode Skills documentation[](https://opencode.ai/docs/skills/): The frontmatter `name:` field is the canonical identifier. Directory names exist only for organization and may differ from the frontmatter name.  
- OpenCode Agents documentation[](https://opencode.ai/docs/agents/): Subagents are invoked using the @-mention syntax with the full path.  
- CE repository AGENTS.md: Each skill directory is a self-contained unit. All internal references use relative paths within `references/`, `assets/`, `scripts/`, and any deeper files. Agent references in skills use the bare form when possible. Output for OpenCode is placed in `.opencode/{agents,skills,plugins}`.  
- CE source files (plugins/compound-engineering/): Agent references appear as the colon-separated fully-qualified name `compound-engineering:category:agentname`. The lfg skill (directory `lfg`, frontmatter name exactly `lfg`) serves as the canonical viewpoint for all skills.

---

**1. Skills**

The converter preserves the original source directory structure under the `compound-engineering` namespace. The shortcut name in the frontmatter is completely independent of the directory name or filename. The model invokes skills exclusively by the frontmatter `name:` value.

**Invocation rule**  
Invoke every skill only with:  
`skill({ name: "exact-value-from-frontmatter-name" })`  

This rule applies identically to every skill, including the lfg skill whose frontmatter name is `lfg`. Never use slash syntax, dollar syntax, full paths, or any other form.

**Output structure produced by the converter**  
`~/.config/opencode/skills/compound-engineering/<original-source-skill-directory-name>/SKILL.md`  

The converter copies the entire original skill directory (including `references/`, `assets/`, `scripts/`, and any additional files or subfolders) into the target location. Organizational subfolders up to three levels deep under `compound-engineering/` are permitted for grouping only. All internal references inside `SKILL.md` remain relative to the skill root directory.

**Skill-reference rewriting (mandatory)**  
In the original Claude Code `.md` files, other skills are referenced in natural language (e.g. “Invoke the ce-plan skill”, “call ce-work”, “use ce-compound”, or occasionally the FQ form “compound-engineering:ce-plan”).  
The converter **must** rewrite every such reference in the final `.md` content so that the OpenCode model receives explicit, unambiguous instructions using the exact OpenCode syntax:  
`skill({ name: "exact-value-from-frontmatter-name" })`  
Use the `transformSkillContentForOpenCode` (or equivalent) function for this purpose on **all** `.md` files (skills and agents). This ensures the final *.md files contain the correct invocation method even after the original Claude-style instructions are removed or adapted.  
This rewriting ensures that every final `.md` file is fully self-describing for the OpenCode model: the model immediately recognizes `skill({ name: "exact-value-from-frontmatter-name" })` as the canonical native tool invocation syntax and never falls back to Claude-style natural-language references.

**Frontmatter handling**  
Retain the `name:` and `description:` fields exactly as they appear. Remove any hardcoded `model:`, `temperature:`, or provider fields so that OpenCode provider defaults are used.

---

**2. Agents / Subagents**

The converter preserves the original source directory structure under the `compound-engineering` namespace. Agents become full directories in the output (not flat `.md` files).

**Source reference format in Claude Code .md files**  
`compound-engineering:category:agentname` (colon-separated fully-qualified name)

**OpenCode invocation (mandatory transformation)**  
Convert every occurrence to:  
`@compound-engineering/category/agentname`  

Replace each `:` with `/` and prefix the entire path with `@`. Keep the leading `compound-engineering` as the top-level namespace.

**Invocation rule**  
Use the full converted path exactly as shown above. Never use a bare agent name, colon syntax, or any shortened form.

**Output structure produced by the converter**  
`~/.config/opencode/agents/compound-engineering/[category]/[subcategory]/<agent-directory-name>/`  

The converter writes the main agent `.md` file (after transformation) and copies every other file and subdirectory from the source (scripts, references, assets, images, configs, etc.) exactly as they exist. Organizational depth is limited to three subfolder levels under `compound-engineering/`.

**Skill-reference rewriting (mandatory)**  
Apply the same rewriting rule as for skills (see section 1) to any internal skill references inside agent `.md` files.

**Frontmatter handling**  
Retain `description:` and any mode fields. Remove any hardcoded `model:`, `temperature:`, or provider fields so that OpenCode provider defaults are used.

---

**3. Converter Implementation Rules**

**`src/types/opencode.ts`**  
Extend the `OpenCodeAgentFile` interface:  

    export interface OpenCodeAgentFile {
      name: string;
      content: string;
      sourceDir?: string;  // populated from the agent's original sourcePath
    }

**`src/converters/claude-to-opencode.ts`**  
- For every agent, set `sourceDir = agent.sourcePath`.  
- Apply the transformation function to the main agent `.md` content: replace every `compound-engineering:category:agentname` with `@compound-engineering/category/agentname`.  
- For **all** `.md` files (skills and agents): also rewrite every skill reference in the prompt content to the exact OpenCode form `skill({ name: "exact-value-from-frontmatter-name" })` using the frontmatter `name:` value.  
- For skills, leave the frontmatter `name:` field completely unchanged.  
- Clean only model and provider hardcodes from frontmatter. Never alter shortcut names or insert any conversion markers.

**`src/targets/opencode.ts` (writer logic)**  
- Skills: Write to `skills/compound-engineering/<original-source-directory-name>/` and perform a full directory copy of the source skill folder (including the three standard subfolders and any deeper content).  
- Agents: Treat the agent as a directory. Write the transformed main `.md` file and copy every file and subdirectory from `sourceDir`.  
- Run a final verification pass: scan the source directory and copy any files that were not handled during the initial copy.  
- Enforce Linux-style line endings (LF only, no CRLF) on all written files.  
- Migration of existing flat files: Scan root `skills/` and `agents/` directories. Move only CE files (matched by plugin manifest name) into the `compound-engineering/` subfolder structure. Skip all non-CE files to avoid overwriting user content. Fail fast on any error with a clear message.

**Skill Reference Verification (mandatory final step)**  
After all rewriting and writing is complete, perform a verification pass on **every** generated `.md` file (skills and agents). Collect the complete list of canonical skill names from all frontmatter `name:` fields. Scan each file for any remaining Claude-style skill references (slash, dollar, FQ colon, bare names, or natural-language patterns). Any unmatched reference must trigger a clear, descriptive error (fail-fast) with the exact file path and offending line. This guarantees that every skill reference in every final `.md` file uses only the canonical OpenCode syntax.

---

**4. Post-Conversion Guarantees**  
- Skill invocation always uses the exact frontmatter `name:` value, regardless of the final directory name or filename.  
- Agent invocation always uses the full `@compound-engineering/...` path derived from the original colon FQ name.  
- All `.md` files now contain explicit, correct OpenCode invocation instructions for both skills and agents.  
- All relative references inside copied subfolders resolve correctly.  
- The resulting structure is self-contained and matches OpenCode expectations exactly.

This specification is complete and authoritative. Implement it precisely in the three permitted files.