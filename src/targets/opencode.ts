import path from "path"
import { promises as fs } from "fs"
import { backupFile, copySkillDir, ensureDir, pathExists, readJson, resolveCommandPath, sanitizePathName, walkFiles, writeJson, writeText } from "../utils/files"
import { createTransformForOpenCode, transformSkillContentForOpenCode } from "../converters/claude-to-opencode"
import type { OpenCodeBundle, OpenCodeConfig } from "../types/opencode"
import { cleanupStaleSkillDirs, cleanupStaleAgents } from "../utils/legacy-cleanup"

// Merges plugin config into existing opencode.json. User keys win on conflict. See ADR-002.
async function mergeOpenCodeConfig(
  configPath: string,
  incoming: OpenCodeConfig,
): Promise<OpenCodeConfig> {
  // If no existing config, write plugin config as-is
  if (!(await pathExists(configPath))) return incoming

  let existing: OpenCodeConfig
  try {
    existing = await readJson<OpenCodeConfig>(configPath)
  } catch {
    // Safety first per AGENTS.md -- do not destroy user data even if their config is malformed.
    // Warn and fall back to plugin-only config rather than crashing.
    console.warn(
      `Warning: existing ${configPath} is not valid JSON. Writing plugin config without merging.`
    )
    return incoming
  }

  // User config wins on conflict -- see ADR-002
  // MCP servers: add plugin entry, skip keys already in user config.
  const mergedMcp = {
    ...(incoming.mcp ?? {}),
    ...(existing.mcp ?? {}), // existing takes precedence (overwrites same-named plugin entry)
  }

  // Permission: add plugin entry, skip keys already in user config.
  const mergedPermission = incoming.permission
    ? {
        ...(incoming.permission),
        ...(existing.permission ?? {}), // existing takes precedence
      }
    : existing.permission

  // Tools: same pattern
  const mergedTools = incoming.tools
    ? {
        ...(incoming.tools),
        ...(existing.tools ?? {}),
      }
    : existing.tools

  return {
    ...existing,                    // all user keys preserved
    $schema: incoming.$schema ?? existing.$schema,
    mcp: Object.keys(mergedMcp).length > 0 ? mergedMcp : undefined,
    permission: mergedPermission,
    tools: mergedTools,
  }
}

function normalizeLf(content: string): string {
  return content.replace(/\r\n/g, "\n")
}

export async function writeOpenCodeBundle(outputRoot: string, bundle: OpenCodeBundle): Promise<void> {
  const openCodePaths = resolveOpenCodePaths(outputRoot)
  await ensureDir(openCodePaths.root)

  const namespace = bundle.namespace ? sanitizePathName(bundle.namespace) : "compound-engineering"

  const hadExistingConfig = await pathExists(openCodePaths.configPath)
  const backupPath = await backupFile(openCodePaths.configPath)
  if (backupPath) {
    console.log(`Backed up existing config to ${backupPath}`)
  }
  const merged = await mergeOpenCodeConfig(openCodePaths.configPath, bundle.config)
  await writeJson(openCodePaths.configPath, merged)
  if (hadExistingConfig) {
    console.log("Merged plugin config into existing opencode.json (user settings preserved)")
  }

  // TODO(cleanup): Remove after v3 transition (circa Q3 2026)
  await cleanupStaleSkillDirs(openCodePaths.skillsDir)
  await cleanupStaleAgents(openCodePaths.agentsDir, ".md")

  // Build transform with indexes for skill content rewriting
  const skillNames = new Set(bundle.skillDirs.map((s) => s.name))
  const agentCategories = new Map<string, string>()
  for (const agent of bundle.agents) {
    if (agent.sourceDir) {
      const category = path.basename(path.dirname(agent.sourceDir))
      if (category && category !== "." && category !== "agents") {
        agentCategories.set(agent.name, category)
      }
    }
  }
  const transform = createTransformForOpenCode({ skillNames, agentCategories })

  // Migrate existing flat files before writing new structure
  await migrateExistingFiles(openCodePaths, bundle, namespace)

  const agentsDir = openCodePaths.agentsDir
  const seenAgents = new Set<string>()
  for (const agent of bundle.agents) {
    const safeName = sanitizePathName(agent.name)
    if (seenAgents.has(safeName)) {
      console.warn(`Skipping agent "${agent.name}": sanitized name "${safeName}" collides with another agent`)
      continue
    }
    seenAgents.add(safeName)

    // Derive category from sourceDir
    let category = ""
    if (agent.sourceDir) {
      category = path.basename(path.dirname(agent.sourceDir))
      if (category === "." || category === "agents") {
        category = ""
      }
    }

    const agentOutputDir = category
      ? path.join(agentsDir, namespace, category, safeName)
      : path.join(agentsDir, namespace, safeName)
    await ensureDir(agentOutputDir)
    await writeText(path.join(agentOutputDir, "AGENT.md"), normalizeLf(agent.content) + "\n")

    // Copy sibling directory if it exists
    if (agent.sourceDir) {
      const sourceFileBase = path.basename(agent.sourceDir).replace(/\.(agent\.md|md)$/i, "")
      const siblingDir = path.join(path.dirname(agent.sourceDir), sourceFileBase)
      if (await pathExists(siblingDir)) {
        const files = await walkFiles(siblingDir)
        for (const file of files) {
          const relativePath = path.relative(siblingDir, file)
          const destPath = path.join(agentOutputDir, relativePath)
          const fileContent = await fs.readFile(file, "utf8")
          await writeText(destPath, fileContent)
        }
      }
    }
  }

  for (const commandFile of bundle.commandFiles) {
    const dest = await resolveCommandPath(openCodePaths.commandDir, commandFile.name, ".md")
    const cmdBackupPath = await backupFile(dest)
    if (cmdBackupPath) {
      console.log(`Backed up existing command file to ${cmdBackupPath}`)
    }
    await writeText(dest, normalizeLf(commandFile.content) + "\n")
  }

  if (bundle.plugins.length > 0) {
    const pluginsDir = openCodePaths.pluginsDir
    for (const plugin of bundle.plugins) {
      await writeText(path.join(pluginsDir, plugin.name), normalizeLf(plugin.content) + "\n")
    }
  }

  if (bundle.skillDirs.length > 0) {
    const skillsRoot = openCodePaths.skillsDir
    for (const skill of bundle.skillDirs) {
      await copySkillDir(
        skill.sourceDir,
        path.join(skillsRoot, namespace, sanitizePathName(skill.name)),
        transform,
        true, // transform all .md files — FQ agent names appear in references too
      )
    }
  }

  // Verification pass
  await verifySkillReferences(openCodePaths, namespace, skillNames)
}

async function migrateExistingFiles(
  openCodePaths: ReturnType<typeof resolveOpenCodePaths>,
  bundle: OpenCodeBundle,
  namespace: string,
): Promise<void> {
  const skillNames = new Set(bundle.skillDirs.map((s) => sanitizePathName(s.name)))
  const agentNames = new Set(bundle.agents.map((a) => sanitizePathName(a.name)))

  // Migrate skills
  try {
    const skillEntries = await fs.readdir(openCodePaths.skillsDir, { withFileTypes: true })
    for (const entry of skillEntries) {
      if (!entry.isDirectory()) continue
      if (entry.name === namespace) continue
      if (!skillNames.has(entry.name)) continue

      const oldPath = path.join(openCodePaths.skillsDir, entry.name)
      const newPath = path.join(openCodePaths.skillsDir, namespace, entry.name)

      if (await pathExists(newPath)) {
        console.warn(`Skipping skill migration: target already exists at ${newPath}`)
        continue
      }

      await ensureDir(path.dirname(newPath))
      await fs.rename(oldPath, newPath)
      console.log(`Migrated skill directory: ${entry.name} -> ${namespace}/${entry.name}`)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Warning: skill migration failed: ${err}`)
    }
  }

  // Migrate agents
  try {
    const agentEntries = await fs.readdir(openCodePaths.agentsDir, { withFileTypes: true })
    for (const entry of agentEntries) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith(".md")) continue

      const baseName = entry.name.slice(0, -3) // remove .md
      if (!agentNames.has(baseName)) continue

      const oldPath = path.join(openCodePaths.agentsDir, entry.name)
      const agent = bundle.agents.find((a) => sanitizePathName(a.name) === baseName)
      let category = ""
      if (agent?.sourceDir) {
        category = path.basename(path.dirname(agent.sourceDir))
        if (category === "." || category === "agents") {
          category = ""
        }
      }

      const newDir = category
        ? path.join(openCodePaths.agentsDir, namespace, category, baseName)
        : path.join(openCodePaths.agentsDir, namespace, baseName)

      if (await pathExists(newDir)) {
        console.warn(`Skipping agent migration: target already exists at ${newDir}`)
        continue
      }

      await ensureDir(newDir)
      await fs.rename(oldPath, path.join(newDir, "AGENT.md"))
      console.log(`Migrated agent file: ${entry.name} -> ${namespace}/${category ? category + "/" : ""}${baseName}/AGENT.md`)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Warning: agent migration failed: ${err}`)
    }
  }
}

async function verifySkillReferences(
  openCodePaths: ReturnType<typeof resolveOpenCodePaths>,
  namespace: string,
  skillNames: Set<string>,
): Promise<void> {
  const violations: Array<{ filePath: string; line: number; text: string }> = []

  const scanDir = async (dir: string) => {
    if (!(await pathExists(dir))) return
    const files = await walkFiles(dir)
    for (const filePath of files) {
      if (!filePath.endsWith(".md")) continue
      const content = await fs.readFile(filePath, "utf8")
      const lines = content.split("\n")

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Skip frontmatter
        if (i === 0 && line.trim() === "---") {
          let j = i + 1
          while (j < lines.length && lines[j].trim() !== "---") j++
          i = j
          continue
        }

        // Skip lines containing URLs to avoid false positives
        if (/https?:\/\//.test(line)) {
          continue
        }

        // Check for remaining FQ colon syntax — only CE-specific patterns
        if (/compound-engineering:[a-z0-9-]+(?::[a-z0-9-]+)*/.test(line)) {
          violations.push({ filePath, line: i + 1, text: line.trim() })
          continue
        }

        // Check for slash commands with CE FQ colon syntax (e.g. /compound-engineering:review:check)
        // Cross-plugin slash commands (/ralph-loop:ralph-loop) are not flagged
        if (/\/compound-engineering:[a-z0-9-]+(?::[a-z0-9-]+)*/.test(line)) {
          violations.push({ filePath, line: i + 1, text: line.trim() })
          continue
        }

        // Check for natural-language invocations with dispatch verbs — only known CE skills
        const nlMatch = line.match(
          /\b(?:invoke|call|use|run|dispatch)\s+(?:the\s+)?([a-z][a-z0-9-]*)\s+(?:skill|agent)\b/i,
        )
        if (nlMatch && skillNames.has(nlMatch[1])) {
          violations.push({ filePath, line: i + 1, text: line.trim() })
          continue
        }
      }
    }
  }

  await scanDir(path.join(openCodePaths.skillsDir, namespace))
  await scanDir(path.join(openCodePaths.agentsDir, namespace))
  await scanDir(openCodePaths.commandDir)

  if (violations.length > 0) {
    const message = [
      "OpenCode verification failed: remaining Claude-style references found in generated files:",
      "",
      ...violations.map((v) => `  ${path.relative(openCodePaths.root, v.filePath)}:${v.line}\n    "${v.text}"`),
      "",
      "Fix these references in the source files or extend the transform to cover the missing pattern.",
    ].join("\n")
    throw new Error(message)
  }
}

function resolveOpenCodePaths(outputRoot: string) {
  const base = path.basename(outputRoot)
  // Global install: ~/.config/opencode (basename is "opencode")
  // Project install: .opencode (basename is ".opencode")
  if (base === "opencode" || base === ".opencode") {
    return {
      root: outputRoot,
      configPath: path.join(outputRoot, "opencode.json"),
      agentsDir: path.join(outputRoot, "agents"),
      pluginsDir: path.join(outputRoot, "plugins"),
      skillsDir: path.join(outputRoot, "skills"),
      // .md command files; alternative to the command key in opencode.json
      commandDir: path.join(outputRoot, "commands"),
    }
  }

  // Custom output directory - nest under .opencode subdirectory
  return {
    root: outputRoot,
    configPath: path.join(outputRoot, "opencode.json"),
    agentsDir: path.join(outputRoot, ".opencode", "agents"),
    pluginsDir: path.join(outputRoot, ".opencode", "plugins"),
    skillsDir: path.join(outputRoot, ".opencode", "skills"),
    // .md command files; alternative to the command key in opencode.json
    commandDir: path.join(outputRoot, ".opencode", "commands"),
  }
}