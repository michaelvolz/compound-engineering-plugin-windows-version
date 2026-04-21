# CE in OpenCode with Proper Subfolder Structure

## Summary of Conversion Process: Claude Code to OpenCode with Correct Subfolders

To convert a Claude Code plugin into an OpenCode-compatible version while ensuring proper subfolder handling and functionality, the following general steps are required:

1. **Inline File References**: During conversion, automatically embed any referenced files (like schemas or documentation) directly into the skill content using a special syntax, making each skill self-contained and eliminating runtime file access dependencies.

2. **Update Agent Path References**: Rewrite FQ names in skills:
   - 3-level (`compound-engineering:category:agent` → `compound-engineering/category/agent`)
   - 2-level skills (`compound-engineering:skill` → `skill`)
   - `ce:*` shortcuts unchanged.
     Use regex with boundaries: `/(?<![a-z0-9:/-])([a-z][a-z0-9-]*):([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)(?![a-z0-9:-])/g` → `$1/$2/$3`.
     Rewrite all agent file paths in the skill templates from the original format (e.g., `@agents/document-review/coherence-reviewer.md`) to the correct OpenCode subfolder structure (e.g., `@agents/compound-engineering/document-review/coherence-reviewer.md`), ensuring that subagent dispatches can locate and load the appropriate persona files in the installed environment.

3. **Maintain Output Structure**: Ensure the converter writes the modified skill files directly to the appropriate OpenCode output directories (e.g., `~/.config/opencode/skills/compound-engineering/skill-name/` and `~/.config/opencode/agents/compound-engineering/`), preserving the hierarchical organization without altering source files. For agents with subdirectories (e.g., scripts/, references/), copy the full directory structure to the subfolder (e.g., `agents/compound-engineering/research/session-history-scripts/`), similar to skill directory copying. Agents are no longer written as flat .md files—treat agent directories like skills for complete structure preservation.

4. **Handle Asynchronous Operations**: Update the conversion process to support asynchronous file reading and writing, allowing for reliable inlining and path rewriting without blocking other operations.

5. **Validate and Test**: Confirm that all file paths resolve correctly in the target environment, and run tests to ensure skills dispatch agents properly and access inlined content without errors.

6. **Preserve Line Endings**: Ensure all converted files maintain Linux-style line endings (LF only, no CRLF) to avoid compatibility issues on Unix-like systems (Linux, macOS, WSL). Configure the converter or post-process with tools like `dos2unix` to normalize line endings during the write operation.

7. **Migrate Existing Flat Files**: Scan root `skills/` and `agents/` for CE files (match names against plugin manifest). Move them to subfolders (e.g., root `ce-plan/SKILL.md` → `skills/compound-engineering/ce-plan/SKILL.md`). Skip/ignore non-CE files to avoid overwriting user content. No backups; fail-fast on errors with clear messages.

8. **Clean Frontmatter**: Remove hardcoded model fields/names from agents/skills. Let OpenCode providers inherit defaults. Identify CE files via manifest name matches only (no conversion markers).

**Prevention**:

- Test on Windows paths; strict name matching for migration; boundary regexes; no user file overwrites.

This approach resolves issues where skills fail due to unresolved file references or incorrect subfolder paths, ensuring the converted plugin works seamlessly in OpenCode while keeping the original Claude Code source intact. The process is backward-compatible and applies across all supported target platforms. File inlining behavior is verified through automated tests to prevent regressions.

## Technical Implementation: Agent Directory Copy

The OpenCode bundle type differs from Claude Code — agents return only `{ name, content }` while skills return `{ sourceDir, name }`. Without sourceDir, the writer cannot copy agent subdirectories.

**Solution:** Add `sourceDir` field to `OpenCodeAgentFile` interface in `src/types/opencode.ts`, populate from `agent.sourcePath` in the converter. This mirrors the existing skill pattern and keeps the converter/writer contract consistent.

**Agent copy logic:**

1. Convert the main agent `.md` file (apply transformSkillContentForOpenCode for FQ agent name rewriting)
2. Copy ALL other files in the agent directory to the target — scripts, documents, images, configs, any filetype. Do NOT transform non-.md files.
3. Preserve the exact folder structure under `compound-engineering/` namespace
4. Final verify pass: scan source directory for any files missed during conversion, copy them to the target location

## Development Notes

**CLI Flag Syntax**: Use `--output` (or `-o`), not `--output-dir`. The CLI ignores unrecognized flags silently and defaults to current working directory if not provided. Example: `bun src/index.ts convert plugins/compound-engineering --to opencode --output ./temp-opencode-test`.
