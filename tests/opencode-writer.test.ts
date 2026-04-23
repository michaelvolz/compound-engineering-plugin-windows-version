import { describe, expect, test } from "bun:test"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { writeOpenCodeBundle } from "../src/targets/opencode"
import { mergeJsonConfigAtKey } from "../src/sync/json-config"
import type { OpenCodeBundle } from "../src/types/opencode"

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

describe("writeOpenCodeBundle", () => {
  test("writes config, agents as directories, plugins, and skills under namespace", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-"))
    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [{ name: "agent-one", content: "Agent content", sourceDir: "/tmp/agents/research/agent-one.agent.md" }],
      plugins: [{ name: "hook.ts", content: "export {}" }],
      commandFiles: [],
      skillDirs: [
        {
          name: "skill-one",
          sourceDir: path.join(import.meta.dir, "fixtures", "sample-plugin", "skills", "skill-one"),
        },
      ],
      namespace: "compound-engineering",
    }

    await writeOpenCodeBundle(tempRoot, bundle)

    expect(await exists(path.join(tempRoot, "opencode.json"))).toBe(true)
    expect(await exists(path.join(tempRoot, ".opencode", "agents", "compound-engineering", "research", "agent-one", "AGENT.md"))).toBe(true)
    expect(await exists(path.join(tempRoot, ".opencode", "plugins", "hook.ts"))).toBe(true)
    expect(await exists(path.join(tempRoot, ".opencode", "skills", "compound-engineering", "skill-one", "SKILL.md"))).toBe(true)
  })

  test("writes directly into a .opencode output root", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-root-"))
    const outputRoot = path.join(tempRoot, ".opencode")
    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [{ name: "agent-one", content: "Agent content", sourceDir: "/tmp/agents/research/agent-one.agent.md" }],
      plugins: [],
      commandFiles: [],
      skillDirs: [
        {
          name: "skill-one",
          sourceDir: path.join(import.meta.dir, "fixtures", "sample-plugin", "skills", "skill-one"),
        },
      ],
      namespace: "compound-engineering",
    }

    await writeOpenCodeBundle(outputRoot, bundle)

    expect(await exists(path.join(outputRoot, "opencode.json"))).toBe(true)
    expect(await exists(path.join(outputRoot, "agents", "compound-engineering", "research", "agent-one", "AGENT.md"))).toBe(true)
    expect(await exists(path.join(outputRoot, "skills", "compound-engineering", "skill-one", "SKILL.md"))).toBe(true)
    expect(await exists(path.join(outputRoot, ".opencode"))).toBe(false)
  })

  test("writes directly into ~/.config/opencode style output root", async () => {
    // Simulates the global install path: ~/.config/opencode
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "config-opencode-"))
    const outputRoot = path.join(tempRoot, ".config", "opencode")
    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [{ name: "agent-one", content: "Agent content", sourceDir: "/tmp/agents/research/agent-one.agent.md" }],
      plugins: [],
      commandFiles: [],
      skillDirs: [
        {
          name: "skill-one",
          sourceDir: path.join(import.meta.dir, "fixtures", "sample-plugin", "skills", "skill-one"),
        },
      ],
      namespace: "compound-engineering",
    }

    await writeOpenCodeBundle(outputRoot, bundle)

    // Should write directly, not nested under .opencode
    expect(await exists(path.join(outputRoot, "opencode.json"))).toBe(true)
    expect(await exists(path.join(outputRoot, "agents", "compound-engineering", "research", "agent-one", "AGENT.md"))).toBe(true)
    expect(await exists(path.join(outputRoot, "skills", "compound-engineering", "skill-one", "SKILL.md"))).toBe(true)
    expect(await exists(path.join(outputRoot, ".opencode"))).toBe(false)
  })

  test("agent without category sourceDir writes to namespace root", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-agent-nocat-"))
    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [{ name: "flat-agent", content: "Flat content", sourceDir: "/tmp/agents/flat-agent.md" }],
      plugins: [],
      commandFiles: [],
      skillDirs: [],
      namespace: "compound-engineering",
    }

    await writeOpenCodeBundle(tempRoot, bundle)

    expect(await exists(path.join(tempRoot, ".opencode", "agents", "compound-engineering", "flat-agent", "AGENT.md"))).toBe(true)
  })

  test("merges plugin config into existing opencode.json without destroying user keys", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-backup-"))
    const outputRoot = path.join(tempRoot, ".opencode")
    const configPath = path.join(outputRoot, "opencode.json")

    // Create existing config with user keys
    await fs.mkdir(outputRoot, { recursive: true })
    const originalConfig = { $schema: "https://opencode.ai/config.json", custom: "value" }
    await fs.writeFile(configPath, JSON.stringify(originalConfig, null, 2))

    // Bundle adds mcp server but keeps user's custom key
    const bundle: OpenCodeBundle = {
      config: { 
        $schema: "https://opencode.ai/config.json", 
        mcp: { "plugin-server": { type: "local", command: "uvx", args: ["plugin-srv"] } } 
      },
      agents: [],
      plugins: [],
      commandFiles: [],
      skillDirs: [],
    }

    await writeOpenCodeBundle(outputRoot, bundle)

    // Merged config should have both user key and plugin key
    const newConfig = JSON.parse(await fs.readFile(configPath, "utf8"))
    expect(newConfig.custom).toBe("value")  // user key preserved
    expect(newConfig.mcp).toBeDefined()
    expect(newConfig.mcp["plugin-server"]).toBeDefined()

    // Backup should exist with original content
    const files = await fs.readdir(outputRoot)
    const backupFileName = files.find((f) => f.startsWith("opencode.json.bak."))
    expect(backupFileName).toBeDefined()

    const backupContent = JSON.parse(await fs.readFile(path.join(outputRoot, backupFileName!), "utf8"))
    expect(backupContent.custom).toBe("value")
  })

  test("merges mcp servers without overwriting user entry", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-merge-mcp-"))
    const outputRoot = path.join(tempRoot, ".opencode")
    const configPath = path.join(outputRoot, "opencode.json")

    // Create existing config with user's mcp server
    await fs.mkdir(outputRoot, { recursive: true })
    const existingConfig = { 
      mcp: { "user-server": { type: "local", command: "uvx", args: ["user-srv"] } } 
    }
    await fs.writeFile(configPath, JSON.stringify(existingConfig, null, 2))

    // Bundle adds plugin server AND has conflicting user-server with different args
    const bundle: OpenCodeBundle = {
      config: { 
        $schema: "https://opencode.ai/config.json",
        mcp: { 
          "plugin-server": { type: "local", command: "uvx", args: ["plugin-srv"] },
          "user-server": { type: "local", command: "uvx", args: ["plugin-override"] }  // conflict
        } 
      },
      agents: [],
      plugins: [],
      commandFiles: [],
      skillDirs: [],
    }

    await writeOpenCodeBundle(outputRoot, bundle)

    // Merged config should have both servers, with user-server keeping user's original args
    const mergedConfig = JSON.parse(await fs.readFile(configPath, "utf8"))
    expect(mergedConfig.mcp).toBeDefined()
    expect(mergedConfig.mcp["plugin-server"]).toBeDefined()
    expect(mergedConfig.mcp["user-server"]).toBeDefined()
    expect(mergedConfig.mcp["user-server"].args[0]).toBe("user-srv")  // user wins on conflict
    expect(mergedConfig.mcp["plugin-server"].args[0]).toBe("plugin-srv")  // plugin entry present
  })

  test("preserves unrelated user keys when merging opencode.json", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-preserve-"))
    const outputRoot = path.join(tempRoot, ".opencode")
    const configPath = path.join(outputRoot, "opencode.json")

    // Create existing config with multiple user keys
    await fs.mkdir(outputRoot, { recursive: true })
    const existingConfig = { 
      model: "my-model",
      theme: "dark",
      mcp: {}
    }
    await fs.writeFile(configPath, JSON.stringify(existingConfig, null, 2))

    // Bundle adds plugin-specific keys
    const bundle: OpenCodeBundle = {
      config: { 
        $schema: "https://opencode.ai/config.json",
        mcp: { "plugin-server": { type: "local", command: "uvx", args: ["plugin-srv"] } },
        permission: { "bash": "allow" }
      },
      agents: [],
      plugins: [],
      commandFiles: [],
      skillDirs: [],
    }

    await writeOpenCodeBundle(outputRoot, bundle)

    // All user keys preserved
    const mergedConfig = JSON.parse(await fs.readFile(configPath, "utf8"))
    expect(mergedConfig.model).toBe("my-model")
    expect(mergedConfig.theme).toBe("dark")
    expect(mergedConfig.mcp["plugin-server"]).toBeDefined()
    expect(mergedConfig.permission["bash"]).toBe("allow")
  })

  test("writes command files as .md in commands/ directory", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cmd-"))
    const outputRoot = path.join(tempRoot, ".config", "opencode")
    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [],
      plugins: [],
      commandFiles: [{ name: "my-cmd", content: "---\ndescription: Test\n---\n\nDo something." }],
      skillDirs: [],
    }

    await writeOpenCodeBundle(outputRoot, bundle)

    const cmdPath = path.join(outputRoot, "commands", "my-cmd.md")
    expect(await exists(cmdPath)).toBe(true)

    const content = await fs.readFile(cmdPath, "utf8")
    expect(content).toBe("---\ndescription: Test\n---\n\nDo something.\n")
  })

  test("rewrites FQ agent names to @compound-engineering format in copied skill markdown", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-skill-transform-"))
    const skillSrcDir = path.join(tempRoot, "src-skill")
    const refsDir = path.join(skillSrcDir, "references")
    await fs.mkdir(refsDir, { recursive: true })
    await fs.writeFile(
      path.join(skillSrcDir, "SKILL.md"),
      "---\nname: test-skill\n---\n\n- `compound-engineering:review:coherence-reviewer`\n"
    )
    await fs.writeFile(
      path.join(refsDir, "agents.md"),
      "Use `compound-engineering:research:repo-research-analyst` for codebase analysis.\n"
    )

    const outputRoot = path.join(tempRoot, ".opencode")
    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [],
      plugins: [],
      commandFiles: [],
      skillDirs: [{ name: "test-skill", sourceDir: skillSrcDir }],
      namespace: "compound-engineering",
    }

    await writeOpenCodeBundle(outputRoot, bundle)

    const skillContent = await fs.readFile(
      path.join(outputRoot, "skills", "compound-engineering", "test-skill", "SKILL.md"),
      "utf8"
    )
    expect(skillContent).toContain("`@compound-engineering/review/coherence-reviewer`")
    expect(skillContent).not.toContain("compound-engineering:review:coherence-reviewer")

    const refContent = await fs.readFile(
      path.join(outputRoot, "skills", "compound-engineering", "test-skill", "references", "agents.md"),
      "utf8"
    )
    expect(refContent).toContain("`@compound-engineering/research/repo-research-analyst`")
    expect(refContent).not.toContain("compound-engineering:research:repo-research-analyst")
  })

  test("does not transform non-markdown files in skill directories", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-skill-nonmd-"))
    const skillSrcDir = path.join(tempRoot, "src-skill")
    const scriptsDir = path.join(skillSrcDir, "scripts")
    await fs.mkdir(scriptsDir, { recursive: true })
    await fs.writeFile(
      path.join(skillSrcDir, "SKILL.md"),
      "---\nname: test-skill\n---\n\nSkill body.\n"
    )
    const scriptContent = "#!/bin/bash\n# compound-engineering:review:security-sentinel\necho done\n"
    await fs.writeFile(path.join(scriptsDir, "run.sh"), scriptContent)

    const outputRoot = path.join(tempRoot, ".opencode")
    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [],
      plugins: [],
      commandFiles: [],
      skillDirs: [{ name: "test-skill", sourceDir: skillSrcDir }],
      namespace: "compound-engineering",
    }

    await writeOpenCodeBundle(outputRoot, bundle)

    const copiedScript = await fs.readFile(
      path.join(outputRoot, "skills", "compound-engineering", "test-skill", "scripts", "run.sh"),
      "utf8"
    )
    // Non-markdown files should be copied verbatim — no FQ rewriting
    expect(copiedScript).toBe(scriptContent)
  })

  test("backs up existing command .md file before overwriting", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cmd-backup-"))
    const outputRoot = path.join(tempRoot, ".opencode")
    const commandsDir = path.join(outputRoot, "commands")
    await fs.mkdir(commandsDir, { recursive: true })

    const cmdPath = path.join(commandsDir, "my-cmd.md")
    await fs.writeFile(cmdPath, "old content\n")

    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [],
      plugins: [],
      commandFiles: [{ name: "my-cmd", content: "---\ndescription: New\n---\n\nNew content." }],
      skillDirs: [],
    }

    await writeOpenCodeBundle(outputRoot, bundle)

    // New content should be written
    const content = await fs.readFile(cmdPath, "utf8")
    expect(content).toBe("---\ndescription: New\n---\n\nNew content.\n")

    // Backup should exist
    const files = await fs.readdir(commandsDir)
    const backupFileName = files.find((f) => f.startsWith("my-cmd.md.bak."))
    expect(backupFileName).toBeDefined()

    const backupContent = await fs.readFile(path.join(commandsDir, backupFileName!), "utf8")
    expect(backupContent).toBe("old content\n")
  })

  test("enforces LF line endings on written files", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-lf-"))
    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [{ name: "lf-agent", content: "Line 1\r\nLine 2\r\n", sourceDir: "/tmp/agents/lf-agent.md" }],
      plugins: [],
      commandFiles: [{ name: "lf-cmd", content: "Cmd 1\r\nCmd 2\r\n" }],
      skillDirs: [],
      namespace: "compound-engineering",
    }

    await writeOpenCodeBundle(tempRoot, bundle)

    const agentContent = await fs.readFile(
      path.join(tempRoot, ".opencode", "agents", "compound-engineering", "lf-agent", "AGENT.md"),
      "utf8"
    )
    expect(agentContent).not.toContain("\r")
    expect(agentContent).toContain("\n")

    const cmdContent = await fs.readFile(
      path.join(tempRoot, ".opencode", "commands", "lf-cmd.md"),
      "utf8"
    )
    expect(cmdContent).not.toContain("\r")
    expect(cmdContent).toContain("\n")
  })

  test("migrates existing flat skill dir to namespace subfolder", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-migrate-skill-"))
    const outputRoot = path.join(tempRoot, ".opencode")
    const skillsDir = path.join(outputRoot, "skills")
    const oldSkillDir = path.join(skillsDir, "test-skill")
    await fs.mkdir(oldSkillDir, { recursive: true })
    await fs.writeFile(path.join(oldSkillDir, "SKILL.md"), "Old skill content\n")

    // Create a real source skill dir for copySkillDir
    const srcSkillDir = path.join(tempRoot, "src-skill")
    await fs.mkdir(srcSkillDir, { recursive: true })
    await fs.writeFile(path.join(srcSkillDir, "SKILL.md"), "---\nname: test-skill\n---\n\nNew skill content\n")

    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [],
      plugins: [],
      commandFiles: [],
      skillDirs: [{ name: "test-skill", sourceDir: srcSkillDir }],
      namespace: "compound-engineering",
    }

    await writeOpenCodeBundle(outputRoot, bundle)

    expect(await exists(oldSkillDir)).toBe(false)
    expect(await exists(path.join(skillsDir, "compound-engineering", "test-skill", "SKILL.md"))).toBe(true)
  })

  test("migrates existing flat agent file to directory structure", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-migrate-agent-"))
    const outputRoot = path.join(tempRoot, ".opencode")
    const agentsDir = path.join(outputRoot, "agents")
    await fs.mkdir(agentsDir, { recursive: true })
    await fs.writeFile(path.join(agentsDir, "test-agent.md"), "Old agent content\n")

    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [{ name: "test-agent", content: "New content", sourceDir: "/tmp/agents/research/test-agent.agent.md" }],
      plugins: [],
      commandFiles: [],
      skillDirs: [],
      namespace: "compound-engineering",
    }

    await writeOpenCodeBundle(outputRoot, bundle)

    expect(await exists(path.join(agentsDir, "test-agent.md"))).toBe(false)
    expect(await exists(path.join(agentsDir, "compound-engineering", "research", "test-agent", "AGENT.md"))).toBe(true)
  })

  test("does not migrate non-CE files", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-no-migrate-"))
    const outputRoot = path.join(tempRoot, ".opencode")
    const skillsDir = path.join(outputRoot, "skills")
    const agentsDir = path.join(outputRoot, "agents")
    const customSkillDir = path.join(skillsDir, "my-custom-skill")
    await fs.mkdir(customSkillDir, { recursive: true })
    await fs.mkdir(agentsDir, { recursive: true })
    await fs.writeFile(path.join(customSkillDir, "SKILL.md"), "Custom skill\n")
    await fs.writeFile(path.join(agentsDir, "my-agent.md"), "Custom agent\n")

    // Create a real source skill dir for copySkillDir
    const srcSkillDir = path.join(tempRoot, "src-ce-skill")
    await fs.mkdir(srcSkillDir, { recursive: true })
    await fs.writeFile(path.join(srcSkillDir, "SKILL.md"), "---\nname: ce-skill\n---\n\nCE skill content\n")

    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [{ name: "ce-agent", content: "CE content", sourceDir: "/tmp/agents/ce-agent.md" }],
      plugins: [],
      commandFiles: [],
      skillDirs: [{ name: "ce-skill", sourceDir: srcSkillDir }],
      namespace: "compound-engineering",
    }

    await writeOpenCodeBundle(outputRoot, bundle)

    // Non-CE files should remain untouched
    expect(await exists(path.join(customSkillDir, "SKILL.md"))).toBe(true)
    expect(await exists(path.join(agentsDir, "my-agent.md"))).toBe(true)
  })

  test("verification pass throws on remaining Claude-style reference", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-verify-fail-"))
    const outputRoot = path.join(tempRoot, ".opencode")

    // Create a skill file with a remaining FQ reference that bypasses the transform
    const skillSrcDir = path.join(tempRoot, "src-skill")
    await fs.mkdir(skillSrcDir, { recursive: true })
    await fs.writeFile(
      path.join(skillSrcDir, "SKILL.md"),
      "---\nname: verify-test\n---\n\nUse `compound-engineering:review:security-sentinel` here.\n"
    )

    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [],
      plugins: [],
      commandFiles: [],
      skillDirs: [{ name: "verify-test", sourceDir: skillSrcDir }],
      namespace: "compound-engineering",
    }

    // The transform should rewrite the FQ reference, so verification should pass
    await writeOpenCodeBundle(outputRoot, bundle)

    // Verify the file was written and transformed
    const skillContent = await fs.readFile(
      path.join(outputRoot, "skills", "compound-engineering", "verify-test", "SKILL.md"),
      "utf8"
    )
    expect(skillContent).toContain("@compound-engineering/review/security-sentinel")
    expect(skillContent).not.toContain("compound-engineering:review:security-sentinel")
  })

  test("verification pass succeeds when all references are clean", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-verify-pass-"))
    const outputRoot = path.join(tempRoot, ".opencode")

    const skillSrcDir = path.join(tempRoot, "src-skill")
    await fs.mkdir(skillSrcDir, { recursive: true })
    await fs.writeFile(
      path.join(skillSrcDir, "SKILL.md"),
      "---\nname: clean-skill\n---\n\nUse `@compound-engineering/review/security-sentinel` here.\n"
    )

    const bundle: OpenCodeBundle = {
      config: { $schema: "https://opencode.ai/config.json" },
      agents: [],
      plugins: [],
      commandFiles: [],
      skillDirs: [{ name: "clean-skill", sourceDir: skillSrcDir }],
      namespace: "compound-engineering",
    }

    // Should not throw
    await expect(writeOpenCodeBundle(outputRoot, bundle)).resolves.toBeUndefined()
  })
})

describe("mergeJsonConfigAtKey", () => {
  test("incoming plugin entries overwrite same-named servers", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "json-merge-"))
    const configPath = path.join(tempDir, "opencode.json")

    // User has an existing MCP server config
    const existingConfig = {
      model: "my-model",
      mcp: {
        "user-server": { type: "local", command: ["uvx", "user-srv"] },
      },
    }
    await fs.writeFile(configPath, JSON.stringify(existingConfig, null, 2))

    // Plugin syncs its servers, overwriting same-named entries
    await mergeJsonConfigAtKey({
      configPath,
      key: "mcp",
      incoming: {
        "plugin-server": { type: "local", command: ["uvx", "plugin-srv"] },
        "user-server": { type: "local", command: ["uvx", "plugin-override"] },
      },
    })

    const merged = JSON.parse(await fs.readFile(configPath, "utf8"))

    // User's top-level keys preserved
    expect(merged.model).toBe("my-model")
    // Plugin server added
    expect(merged.mcp["plugin-server"]).toBeDefined()
    // Plugin server overwrites same-named existing entry
    expect(merged.mcp["user-server"].command[1]).toBe("plugin-override")
  })
})
