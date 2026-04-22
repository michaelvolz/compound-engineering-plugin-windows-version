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
- For skills, leave the frontmatter `name:` field completely unchanged.  
- Clean only model and provider hardcodes from frontmatter. Never alter shortcut names or insert any conversion markers.

**`src/targets/opencode.ts` (writer logic)**  
- Skills: Write to `skills/compound-engineering/<original-source-directory-name>/` and perform a full directory copy of the source skill folder (including the three standard subfolders and any deeper content).  
- Agents: Treat the agent as a directory. Write the transformed main `.md` file and copy every file and subdirectory from `sourceDir`.  
- Run a final verification pass: scan the source directory and copy any files that were not handled during the initial copy.  
- Enforce Linux-style line endings (LF only, no CRLF) on all written files.  
- Migration of existing flat files: Scan root `skills/` and `agents/` directories. Move only CE files (matched by plugin manifest name) into the `compound-engineering/` subfolder structure. Skip all non-CE files to avoid overwriting user content. Fail fast on any error with a clear message.

---

**4. Post-Conversion Guarantees**  
- Skill invocation always uses the exact frontmatter `name:` value, regardless of the final directory name or filename.  
- Agent invocation always uses the full `@compound-engineering/...` path derived from the original colon FQ name.  
- All relative references inside copied subfolders resolve correctly.  
- The resulting structure is self-contained and matches OpenCode expectations exactly.

This specification is complete and authoritative. Implement it precisely in the three permitted files.