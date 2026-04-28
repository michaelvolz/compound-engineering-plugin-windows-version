#!/usr/bin/env python3
"""Extract error signals from a Claude Code, OpenCode, Codex, or Cursor session.

Usage (JSONL files - Claude/Codex/Cursor):
  cat <session.jsonl> | python3 extract-errors.py

Usage (OpenCode - session ID):
  python3 extract-errors.py <session-id>
  python3 extract-errors.py ses_xxx --db ~/.local/share/opencode/opencode.db

Auto-detects platform from input.
Note: Cursor agent transcripts do not log tool results, so no errors can be extracted.
Finds failed tool calls / commands and outputs them with timestamps.
Outputs a _meta line at the end with processing stats.
"""
import sys
import json
import os
import subprocess

stats = {"lines": 0, "parse_errors": 0, "errors_found": 0}


def summarize_error(raw):
    """Extract a short error summary instead of dumping the full payload."""
    text = str(raw).strip()
    # Take the first non-empty line as the error message
    for line in text.split("\n"):
        line = line.strip()
        if line:
            return line[:200]
    return text[:200]


def handle_claude(obj):
    if obj.get("type") == "user":
        content = obj.get("message", {}).get("content", [])
        if isinstance(content, list):
            for block in content:
                if block.get("type") == "tool_result" and block.get("is_error"):
                    ts = obj.get("timestamp", "")[:19]
                    summary = summarize_error(block.get("content", ""))
                    print(f"[{ts}] [error] {summary}")
                    print("---")
                    stats["errors_found"] += 1


def handle_codex(obj):
    if obj.get("type") == "event_msg":
        p = obj.get("payload", {})
        if p.get("type") == "exec_command_end":
            output = p.get("aggregated_output", "")
            stderr = p.get("stderr", "")
            command = p.get("command", [])
            cmd_str = command[-1] if command else ""

            exit_match = None
            if "Process exited with code " in output:
                try:
                    code_str = output.split("Process exited with code ")[1].split("\n")[0]
                    exit_code = int(code_str)
                    if exit_code != 0:
                        exit_match = exit_code
                except (IndexError, ValueError):
                    pass

            if exit_match is not None or stderr:
                ts = obj.get("timestamp", "")[:19]
                error_summary = summarize_error(stderr if stderr else output)
                print(f"[{ts}] [error] exit={exit_match} cmd={cmd_str[:120]}: {error_summary}")
                print("---")
                stats["errors_found"] += 1


def handle_opencode(session_id, db_path=None):
    """OpenCode: Query SQLite for message errors.
    
    Messages are stored in the message table as JSON in the data column.
    """
    import sqlite3
    
    db = db_path or os.path.expanduser("~/.local/share/opencode/opencode.db")
    if not os.path.isfile(db):
        return
    
    try:
        conn = sqlite3.connect(db)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Get messages for this session
        cursor.execute("""
            SELECT id, data FROM message 
            WHERE session_id = ? 
            ORDER BY time_created
        """, (session_id,))
        
        for row in cursor.fetchall():
            stats["lines"] += 1
            try:
                data = json.loads(row["data"])
                
                # Check for tool_result parts with is_error
                parts = data.get("parts", [])
                if isinstance(parts, list):
                    for block in parts:
                        if block.get("type") == "tool_result" and block.get("is_error"):
                            ts = ""
                            if "time" in data and "created" in data["time"]:
                                import datetime
                                try:
                                    ts = datetime.datetime.fromtimestamp(
                                        data["time"]["created"] / 1000
                                    ).strftime("%Y-%m-%d %H:%M:%S")[:19]
                                except (ValueError, OSError):
                                    pass
                            summary = summarize_error(block.get("content", ""))
                            print(f"[{ts}] [error] {summary}")
                            print("---")
                            stats["errors_found"] += 1
                            
            except (json.JSONDecodeError, KeyError):
                stats["parse_errors"] += 1
        
        conn.close()
    except (sqlite3.Error, OSError, IOError):
        pass


# Parse arguments: session ID (OpenCode) or stdin (JSONL)
args = sys.argv[1:]

if args and args[0].startswith("ses_"):
    # OpenCode session ID mode
    db_path = None
    session_id = args[0]
    
    # Check for --db flag
    if "--db" in args:
        idx = args.index("--db")
        if idx + 1 < len(args):
            db_path = args[idx + 1]
    
    handle_opencode(session_id, db_path)
    print(json.dumps({"_meta": True, **stats}))
elif args:
    print(json.dumps({"_meta": True, "error": "Usage: extract-errors.py <session-id> OR cat file.jsonl | extract-errors.py"}))
else:
    # JSONL stdin mode (Claude/Codex/Cursor)
    detected = None
    buffer = []

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        buffer.append(line)
        stats["lines"] += 1

        if not detected and len(buffer) <= 10:
            try:
                obj = json.loads(line)
                if obj.get("type") in ("user", "assistant"):
                    detected = "claude"
                elif obj.get("type") in ("session_meta", "turn_context", "response_item", "event_msg"):
                    detected = "codex"
                elif obj.get("role") in ("user", "assistant") and "type" not in obj:
                    detected = "cursor"
            except (json.JSONDecodeError, KeyError):
                pass

    # Cursor transcripts don't log tool results — no errors to extract
    def handle_noop(obj):
        pass

    handlers = {"claude": handle_claude, "codex": handle_codex, "cursor": handle_noop}
    handler = handlers.get(detected, handle_noop)

    for line in buffer:
        try:
            handler(json.loads(line))
        except (json.JSONDecodeError, KeyError):
            stats["parse_errors"] += 1

    print(json.dumps({"_meta": True, **stats}))
