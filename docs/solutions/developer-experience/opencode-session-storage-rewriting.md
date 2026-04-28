---
module: compound-engineering
date: 2026-04-28
problem_type: tooling_decision
component: tooling
severity: medium
root_cause: incomplete_setup
resolution_type: tooling_addition
tags:
  - opencode
  - session-storage
  - sqlite
  - conversion
  - session-historian
related_components:
  - ce-session-inventory
  - ce-session-extract
---

# Context

The compound-engineering plugin's session historian scripts needed to support OpenCode sessions. OpenCode 1.14+ uses SQLite for session storage, not JSON files like Claude Code, Codex, or Cursor. This required rewriting the discovery and extraction scripts to query SQLite instead of scanning the filesystem.

# Guidance

## OpenCode Session Storage Format

OpenCode 1.14+ stores all session and message data in a SQLite database:

```
~/.local/share/opencode/opencode.db
```

### Database Schema

```sql
-- session table
CREATE TABLE session (
  id TEXT PRIMARY KEY,          -- e.g., "ses_249b86ed2ffeL7F1UidF1iMi2f"
  project_id TEXT NOT NULL,
  parent_id TEXT,
  slug TEXT NOT NULL,         -- e.g., "curious-cactus"
  directory TEXT NOT NULL,   -- e.g., "/home/user/my-repo"
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  time_created INTEGER NOT NULL,  -- Unix timestamp in milliseconds
  time_updated INTEGER NOT NULL
);

-- message table
CREATE TABLE message (
  id TEXT PRIMARY KEY,          -- e.g., "msg_dd23fe8ef002xugBF854qKmDjQ"
  session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  data TEXT NOT NULL);        -- JSON blob with message content
```

### Message Data Format

Messages are stored as JSON in the `data` column. The format differs from Claude Code:

```json
// User message
{
  "role": "user",
  "time": {"created": 1776879636791},
  "agent": "build",
  "model": {"providerID": "opencode", "modelID": "big-pickle"},
  "summary": {"diffs": [{"file": "...", "status": "modified", "additions": 10, "deletions": 5}]}
}

// Assistant message
{
  "role": "assistant",
  "time": {"created": 1776879636800, "completed": 1776879637000},
  "mode": "rm-strategist",
  "path": {"cwd": "/home/user/my-repo", "root": "/home/user/my-repo"},
  "tokens": {"input": 1000, "output": 500, "reasoning": 0, "cache": {"read": 0, "write": 0}},
  "cost": 0.025,
  "modelID": "moonshotai/kimi-k2.6",
  "providerID": "openrouter"
}
```

## Key Differences from Other Platforms

| Aspect     | Claude Code         | OpenCode             | Codex          | Cursor            |
| ---------- | ------------------- | -------------------- | -------------- | ----------------- |
| Storage    | JSONL files         | SQLite               | JSONL files    | JSONL files       |
| Session ID | Base64-encoded path | `ses_xxx`            | YYYY/MM/DD/    | UUID dir          |
| Messages   | `content[]` array   | `data` JSON blob     | `turn_context` | `role` entries    |
| Tool calls | `tool_use` blocks   | No tool call history | exec pairs     | `tool_use` blocks |
| File diffs | In messages         | In `summary.diffs`   | N/A            | N/A               |

## Implementation Pattern

### Discovery Script (discover-sessions.sh)

```bash
discover_opencode() {
    local db="$HOME/.local/share/opencode/opencode.db"
    [ -f "$db" ] || return 0

    # Query SQLite for sessions matching repo name
    sqlite3 "$db" "
        SELECT id FROM session
        WHERE directory LIKE '%${REPO_NAME}%'
        AND datetime(time_created/1000, 'unixepoch') >= datetime('now', '-${DAYS} days')
        ORDER BY time_created DESC
    " 2>/dev/null
}
```

### Metadata Extraction (extract-metadata.py)

```python
def try_opencode(session_id):
    """Query session table for metadata."""
    import subprocess

    db = os.path.expanduser("~/.local/share/opencode/opencode.db")
    result = subprocess.run(
        ["sqlite3", db,
         f"SELECT id, directory, title, project_id, parent_id, time_created, time_updated FROM session WHERE id = '{session_id}'"],
        capture_output=True, text=True, timeout=5
    )
    if result.returncode == 0 and result.stdout.strip():
        parts = result.stdout.strip().split("|")
        return {
            "platform": "opencode",
            "session": parts[0],
            "directory": parts[1],
            "title": parts[2],
            "projectID": parts[3],
            "parentID": parts[4] if len(parts) > 4 else None,
        }
```

### Skeleton Extraction (extract-skeleton.py)

```python
def handle_opencode_session(session_id):
    """Query message table for conversation."""
    import sqlite3

    conn = sqlite3.connect(db)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, data FROM message
        WHERE session_id = ?
        ORDER BY time_created
    """, (session_id,))

    for row in cursor.fetchall():
        data = json.loads(row["data"])
        # Extract: role, time, agent, summary/diffs, tokens, cost
        handle_opencode(data)
```

## When to Apply

This applies when:

- Rewriting session-historian scripts for OpenCode compatibility
- Converting plugin skills/agents from Claude Code format to OpenCode
- Building tools that read OpenCode session data
- Understanding OpenCode's storage for debugging

This does NOT apply when:

- Working with Claude Code, Codex, or Cursor (they use JSONL)
- Needing tool-level detail (OpenCode doesn't store individual tool calls)
- Looking for conversation text (OpenCode stores metadata, not message content)

## Examples

### Finding all sessions for a repo

```bash
# Via discover-sessions.sh
bash discover-sessions.sh "my-repo" 30 --platform opencode

# Via sqlite3 directly
sqlite3 ~/.local/share/opencode/opencode.db \
  "SELECT id, title, directory FROM session WHERE directory LIKE '%/my-repo%'"
```

### Getting session metadata

```bash
# Via extract-metadata.py
python3 extract-metadata.py ses_xxx

# Via sqlite3 directly
sqlite3 ~/.local/share/opencode/opencode.db \
  "SELECT id, title, directory, time_created FROM session WHERE id = 'ses_xxx'"
```

### Extracting conversation skeleton

```bash
# Via extract-skeleton.py
python3 extract-skeleton.py ses_xxx

# Understanding output:
# - User messages: agent name + file diffs (from summary.diffs)
# - Assistant messages: mode, tokens in/out, cost, cwd
```
