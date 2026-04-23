import path from "path"
import { formatFrontmatter, parseFrontmatter } from "../utils/frontmatter"
import { normalizeModelWithProvider } from "../utils/model"
import {
  type ClaudeAgent,
  type ClaudeCommand,
  type ClaudeHooks,
  type ClaudePlugin,
  type ClaudeMcpServer,
  filterSkillsByPlatform,
} from "../types/claude"
import type {
  OpenCodeBundle,
  OpenCodeCommandFile,
  OpenCodeConfig,
  OpenCodeMcpServer,
} from "../types/opencode"

export type PermissionMode = "none" | "broad" | "from-commands"

export type ClaudeToOpenCodeOptions = {
  agentMode: "primary" | "subagent"
  inferTemperature: boolean
  permissions: PermissionMode
}

const TOOL_MAP: Record<string, string> = {
  bash: "bash",
  read: "read",
  write: "write",
  edit: "edit",
  grep: "grep",
  glob: "glob",
  list: "list",
  webfetch: "webfetch",
  skill: "skill",
  patch: "patch",
  task: "task",
  question: "question",
  todowrite: "todowrite",
  todoread: "todoread",
}

type HookEventMapping = {
  events: string[]
  type: "tool" | "session" | "permission" | "message"
  requireError?: boolean
  note?: string
}

const HOOK_EVENT_MAP: Record<string, HookEventMapping> = {
  PreToolUse: { events: ["tool.execute.before"], type: "tool" },
  PostToolUse: { events: ["tool.execute.after"], type: "tool" },
  PostToolUseFailure: { events: ["tool.execute.after"], type: "tool", requireError: true, note: "Claude PostToolUseFailure" },
  SessionStart: { events: ["session.created"], type: "session" },
  SessionEnd: { events: ["session.deleted"], type: "session" },
  Stop: { events: ["session.idle"], type: "session" },
  PreCompact: { events: ["experimental.session.compacting"], type: "session" },
  PermissionRequest: { events: ["permission.requested", "permission.replied"], type: "permission", note: "Claude PermissionRequest" },
  UserPromptSubmit: { events: ["message.created", "message.updated"], type: "message", note: "Claude UserPromptSubmit" },
  Notification: { events: ["message.updated"], type: "message", note: "Claude Notification" },
  Setup: { events: ["session.created"], type: "session", note: "Claude Setup" },
  SubagentStart: { events: ["message.updated"], type: "message", note: "Claude SubagentStart" },
  SubagentStop: { events: ["message.updated"], type: "message", note: "Claude SubagentStop" },
}

export function convertClaudeToOpenCode(
  plugin: ClaudePlugin,
  options: ClaudeToOpenCodeOptions,
): OpenCodeBundle {
  // Build indexes for reference rewriting
  const skillNames = new Set<string>()
  for (const skill of filterSkillsByPlatform(plugin.skills, "opencode")) {
    if (skill.name) skillNames.add(skill.name)
  }

  const agentCategories = new Map<string, string>()
  for (const agent of plugin.agents) {
    const category = path.basename(path.dirname(agent.sourcePath))
    if (category && category !== "." && category !== "agents") {
      agentCategories.set(agent.name, category)
    }
  }

  const transform = createTransformForOpenCode({ skillNames, agentCategories })

  const agentFiles = plugin.agents.map((agent) => convertAgent(agent, options, transform))
  const cmdFiles = convertCommands(plugin.commands, transform)
  const mcp = plugin.mcpServers ? convertMcp(plugin.mcpServers) : undefined
  const plugins = plugin.hooks ? [convertHooks(plugin.hooks)] : []

  const config: OpenCodeConfig = {
    $schema: "https://opencode.ai/config.json",
    mcp: mcp && Object.keys(mcp).length > 0 ? mcp : undefined,
  }

  applyPermissions(config, plugin.commands, options.permissions)

  return {
    config,
    agents: agentFiles,
    commandFiles: cmdFiles,
    plugins,
    skillDirs: filterSkillsByPlatform(plugin.skills, "opencode").map((skill) => ({ sourceDir: skill.sourceDir, name: skill.name })),
    namespace: plugin.manifest.name,
  }
}

function convertAgent(agent: ClaudeAgent, options: ClaudeToOpenCodeOptions, transform: (content: string) => string) {
  const frontmatter: Record<string, unknown> = {
    description: agent.description,
    mode: options.agentMode,
  }

  // Only write model for primary agents. Subagents inherit from the parent
  // session, making them provider-agnostic. Writing an explicit model like
  // "anthropic/claude-haiku-4-5" on a subagent causes ProviderModelNotFoundError
  // when the user's OpenCode env uses a different provider. See #477.
  if (agent.model && agent.model !== "inherit" && options.agentMode === "primary") {
    frontmatter.model = normalizeModelWithProvider(agent.model)
  }

  if (options.inferTemperature) {
    const temperature = inferTemperature(agent)
    if (temperature !== undefined) {
      frontmatter.temperature = temperature
    }
  }

  const content = transform(formatFrontmatter(frontmatter, agent.body))

  return {
    name: agent.name,
    content,
    sourceDir: agent.sourcePath,
  }
}

// Commands are written as individual .md files rather than entries in opencode.json.
// Chosen over JSON map because opencode resolves commands by filename at runtime (ADR-001).
function convertCommands(commands: ClaudeCommand[], transform: (content: string) => string): OpenCodeCommandFile[] {
  const files: OpenCodeCommandFile[] = []
  for (const command of commands) {
    if (command.disableModelInvocation) continue
    const frontmatter: Record<string, unknown> = {
      description: command.description,
    }
    if (command.model && command.model !== "inherit") {
      frontmatter.model = normalizeModelWithProvider(command.model)
    }
    const content = transform(formatFrontmatter(frontmatter, command.body))
    files.push({ name: command.name, content })
  }
  return files
}

function convertMcp(servers: Record<string, ClaudeMcpServer>): Record<string, OpenCodeMcpServer> {
  const result: Record<string, OpenCodeMcpServer> = {}
  for (const [name, server] of Object.entries(servers)) {
    if (server.command) {
      result[name] = {
        type: "local",
        command: [server.command, ...(server.args ?? [])],
        environment: server.env,
        enabled: true,
      }
      continue
    }

    if (server.url) {
      result[name] = {
        type: "remote",
        url: server.url,
        headers: server.headers,
        enabled: true,
      }
    }
  }
  return result
}

function convertHooks(hooks: ClaudeHooks) {
  const handlerBlocks: string[] = []
  const hookMap = hooks.hooks
  const unmappedEvents: string[] = []

  for (const [eventName, matchers] of Object.entries(hookMap)) {
    const mapping = HOOK_EVENT_MAP[eventName]
    if (!mapping) {
      unmappedEvents.push(eventName)
      continue
    }
    if (matchers.length === 0) continue
    for (const event of mapping.events) {
      handlerBlocks.push(
        renderHookHandlers(event, matchers, {
          useToolMatcher: mapping.type === "tool" || mapping.type === "permission",
          requireError: mapping.requireError ?? false,
          note: mapping.note,
        }),
      )
    }
  }

  const unmappedComment = unmappedEvents.length > 0
    ? `// Unmapped Claude hook events: ${unmappedEvents.join(", ")}\n`
    : ""

  const content = `${unmappedComment}import type { Plugin } from "@opencode-ai/plugin"\n\nexport const ConvertedHooks: Plugin = async ({ $ }) => {\n  return {\n${handlerBlocks.join(",\n")}\n  }\n}\n\nexport default ConvertedHooks\n`

  return {
    name: "converted-hooks.ts",
    content,
  }
}

function renderHookHandlers(
  event: string,
  matchers: ClaudeHooks["hooks"][string],
  options: { useToolMatcher: boolean; requireError: boolean; note?: string },
) {
  const statements: string[] = []
  for (const matcher of matchers) {
    statements.push(...renderHookStatements(matcher, options.useToolMatcher))
  }
  const rendered = statements.map((line) => `    ${line}`).join("\n")
  const wrapped = options.requireError
    ? `    if (input?.error) {\n${statements.map((line) => `      ${line}`).join("\n")}\n    }`
    : rendered

  // Wrap tool.execute.before handlers in try-catch to prevent a failing hook
  // from crashing parallel tool call batches (causes API 400 errors).
  // See: https://github.com/EveryInc/compound-engineering-plugin/issues/85
  const isPreToolUse = event === "tool.execute.before"
  const note = options.note ? `    // ${options.note}\n` : ""
  if (isPreToolUse) {
    return `    "${event}": async (input) => {\n${note}    try {\n  ${wrapped}\n    } catch (err) {\n      console.error("[hook] ${event} error (non-fatal):", err)\n    }\n    }`
  }
  return `    "${event}": async (input) => {\n${note}${wrapped}\n    }`
}

function renderHookStatements(
  matcher: ClaudeHooks["hooks"][string][number],
  useToolMatcher: boolean,
): string[] {
  if (!matcher.hooks || matcher.hooks.length === 0) return []
  const tools = matcher.matcher
    ? matcher.matcher
        .split("|")
        .map((tool) => tool.trim().toLowerCase())
        .filter(Boolean)
    : []

  const useMatcher = useToolMatcher && tools.length > 0 && !tools.includes("*")
  const condition = useMatcher
    ? tools.map((tool) => `input.tool === "${tool}"`).join(" || ")
    : null
  const statements: string[] = []

  for (const hook of matcher.hooks) {
    if (hook.type === "command") {
      if (condition) {
        statements.push(`if (${condition}) { await $\`${hook.command}\` }`)
      } else {
        statements.push(`await $\`${hook.command}\``)
      }
      if (hook.timeout) {
        statements.push(`// timeout: ${hook.timeout}s (not enforced)`)
      }
      continue
    }
    if (hook.type === "prompt") {
      statements.push(`// Prompt hook for ${matcher.matcher ?? "*"}: ${hook.prompt.replace(/\n/g, " ")}`)
      continue
    }
    statements.push(`// Agent hook for ${matcher.matcher ?? "*"}: ${hook.agent}`)
  }

  return statements
}

function rewriteClaudePaths(body: string): string {
  return body
    .replace(/~\/\.claude\//g, "~/.config/opencode/")
    .replace(/\.claude\//g, ".opencode/")
}

export type TransformIndexes = {
  skillNames: Set<string>
  agentCategories: Map<string, string>
}

/**
 * Factory that creates a content transform function with access to skill and
 * agent indexes. The transform rewrites agent references to
 * `@compound-engineering/category/agentname`, skill references to
 * `skill({ name: "..." })`, cleans frontmatter of model/temperature/provider
 * fields, and preserves existing path rewriting.
 */
export function createTransformForOpenCode(indexes: TransformIndexes): (content: string) => string {
  const { skillNames, agentCategories } = indexes

  return (content: string): string => {
    // Parse and clean frontmatter
    const { data, body: rawBody } = parseFrontmatter(content)
    const cleanedData = { ...data }
    delete cleanedData.model
    delete cleanedData.temperature
    // Remove any provider-related fields
    for (const key of Object.keys(cleanedData)) {
      if (key.toLowerCase().includes("provider")) {
        delete cleanedData[key]
      }
    }

    // Apply body transforms in order
    let body = rewriteClaudePaths(rawBody)

    // 3-segment FQ agent refs: compound-engineering:cat:agent -> @compound-engineering/cat/agent
    body = body.replace(
      /(?<![a-z0-9:/-])compound-engineering:([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)(?![a-z0-9:-])/g,
      "@compound-engineering/$1/$2",
    )

    // 2-segment category-qualified agent refs: cat:ce-agent -> @compound-engineering/cat/ce-agent
    // Only when category exists in agentCategories map
    body = body.replace(
      /(?<![a-z0-9:/-])([a-z][a-z0-9-]*):(ce-[a-z][a-z0-9-]*)(?![a-z0-9:-])/g,
      (match, category, agentName) => {
        const knownCategory = agentCategories.get(agentName)
        if (knownCategory && knownCategory === category) {
          return `@compound-engineering/${category}/${agentName}`
        }
        return match
      },
    )

    // Bare agent names in backticks that are known agents
    const agentNames = Array.from(agentCategories.keys())
    for (const agentName of agentNames) {
      const category = agentCategories.get(agentName)!
      // Match backtick-wrapped agent name with word boundaries
      const regex = new RegExp(`\\\`${agentName}\\\``, "g")
      body = body.replace(regex, `@compound-engineering/${category}/${agentName}`)
    }

    // Skill FQ refs: compound-engineering:skill-name -> skill({ name: "skill-name" })
    body = body.replace(
      /(?<![a-z0-9:/-])compound-engineering:([a-z][a-z0-9-]*)(?![a-z0-9-:])/g,
      (match, skillName) => {
        if (skillNames.has(skillName)) {
          return `skill({ name: "${skillName}" })`
        }
        return match
      },
    )

    // Natural-language skill invocations
    const skillPattern = Array.from(skillNames).filter((n) => n.startsWith("ce-")).join("|")
    if (skillPattern) {
      // "invoke the ce-plan skill" / "call ce-work agent" / "use ce-compound"
      body = body.replace(
        new RegExp(
          `\\b(?:invoke|call|use|run|dispatch)\\s+(?:the\\s+)?(${skillPattern})\\s+(?:skill|agent)\\b`,
          "gi",
        ),
        (match, skillName) => `skill({ name: "${skillName}" })`,
      )
      // Same without "skill"/"agent" suffix
      body = body.replace(
        new RegExp(
          `\\b(?:invoke|call|use|run|dispatch)\\s+(?:the\\s+)?(${skillPattern})\\b`,
          "gi",
        ),
        (match, skillName) => `skill({ name: "${skillName}" })`,
      )
      // Parenthetical form: (ce-plan skill)
      body = body.replace(
        new RegExp(`\\((${skillPattern})\\s+skill\\)`, "gi"),
        (match, skillName) => `(skill({ name: "${skillName}" }))`,
      )
    }

    return formatFrontmatter(cleanedData, body)
  }
}

/**
 * Backward-compatible wrapper around createTransformForOpenCode.
 * Preserves the original signature for callers that don't need indexes.
 */
export function transformSkillContentForOpenCode(body: string): string {
  const transform = createTransformForOpenCode({ skillNames: new Set(), agentCategories: new Map() })
  return transform(body)
}

function inferTemperature(agent: ClaudeAgent): number | undefined {
  const sample = `${agent.name} ${agent.description ?? ""}`.toLowerCase()
  if (/(review|audit|security|sentinel|oracle|lint|verification|guardian)/.test(sample)) {
    return 0.1
  }
  if (/(plan|planning|architecture|strategist|analysis|research)/.test(sample)) {
    return 0.2
  }
  if (/(doc|readme|changelog|editor|writer)/.test(sample)) {
    return 0.3
  }
  if (/(brainstorm|creative|ideate|design|concept)/.test(sample)) {
    return 0.6
  }
  return 0.3
}

function applyPermissions(
  config: OpenCodeConfig,
  commands: ClaudeCommand[],
  mode: PermissionMode,
) {
  if (mode === "none") return

  const sourceTools = [
    "read",
    "write",
    "edit",
    "bash",
    "grep",
    "glob",
    "list",
    "webfetch",
    "skill",
    "patch",
    "task",
    "question",
    "todowrite",
    "todoread",
  ]
  let enabled = new Set<string>()
  const patterns: Record<string, Set<string>> = {}

  if (mode === "broad") {
    enabled = new Set(sourceTools)
  } else {
    for (const command of commands) {
      if (!command.allowedTools) continue
      for (const tool of command.allowedTools) {
        const parsed = parseToolSpec(tool)
        if (!parsed.tool) continue
        enabled.add(parsed.tool)
        if (parsed.pattern) {
          const normalizedPattern = normalizePattern(parsed.tool, parsed.pattern)
          if (!patterns[parsed.tool]) patterns[parsed.tool] = new Set()
          patterns[parsed.tool].add(normalizedPattern)
        }
      }
    }
  }

  const permission: Record<string, "allow" | "deny" | Record<string, "allow" | "deny">> = {}
  const tools: Record<string, boolean> = {}

  for (const tool of sourceTools) {
    tools[tool] = mode === "broad" ? true : enabled.has(tool)
  }

  if (mode === "broad") {
    for (const tool of sourceTools) {
      permission[tool] = "allow"
    }
  } else {
    for (const tool of sourceTools) {
      const toolPatterns = patterns[tool]
      if (toolPatterns && toolPatterns.size > 0) {
        const patternPermission: Record<string, "allow" | "deny"> = { "*": "deny" }
        for (const pattern of toolPatterns) {
          patternPermission[pattern] = "allow"
        }
        ;(permission)[tool] = patternPermission
      } else {
        permission[tool] = enabled.has(tool) ? "allow" : "deny"
      }
    }
  }

  if (mode !== "broad") {
    for (const [tool, toolPatterns] of Object.entries(patterns)) {
      if (!toolPatterns || toolPatterns.size === 0) continue
      const patternPermission: Record<string, "allow" | "deny"> = { "*": "deny" }
      for (const pattern of toolPatterns) {
        patternPermission[pattern] = "allow"
      }
      ;(permission)[tool] = patternPermission
    }
  }

  if (enabled.has("write") || enabled.has("edit")) {
    if (typeof permission.edit === "string") permission.edit = "allow"
    if (typeof permission.write === "string") permission.write = "allow"
  }
  if (patterns.write || patterns.edit) {
    const combined = new Set<string>()
    for (const pattern of patterns.write ?? []) combined.add(pattern)
    for (const pattern of patterns.edit ?? []) combined.add(pattern)
    const combinedPermission: Record<string, "allow" | "deny"> = { "*": "deny" }
    for (const pattern of combined) {
      combinedPermission[pattern] = "allow"
    }
    ;(permission).edit = combinedPermission
    ;(permission).write = combinedPermission
  }

  config.permission = permission
  config.tools = tools
}

function normalizeTool(raw: string): string | null {
  return parseToolSpec(raw).tool
}

function parseToolSpec(raw: string): { tool: string | null; pattern?: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { tool: null }
  const [namePart, patternPart] = trimmed.split("(", 2)
  const name = namePart.trim().toLowerCase()
  const tool = TOOL_MAP[name] ?? null
  if (!patternPart) return { tool }
  const normalizedPattern = patternPart.endsWith(")")
    ? patternPart.slice(0, -1).trim()
    : patternPart.trim()
  return { tool, pattern: normalizedPattern }
}

function normalizePattern(tool: string, pattern: string): string {
  if (tool === "bash") {
    return pattern.replace(/:/g, " ").trim()
  }
  return pattern
}
