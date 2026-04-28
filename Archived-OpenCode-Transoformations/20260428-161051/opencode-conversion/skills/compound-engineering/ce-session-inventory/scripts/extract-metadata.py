#!/usr/bin/env python3
"""Extract session metadata from Claude Code, OpenCode, Codex, and Cursor files.

Batch mode (preferred — one invocation for all files):
  python3 extract-metadata.py /path/to/dir/*
  python3 extract-metadata.py file1.jsonl file2.json file3.jsonl

Single-file mode (stdin):
  head -20 <session.jsonl> | python3 extract-metadata.py

Auto-detects platform from the file structure.
Outputs one JSON object per file, one per line.
Includes a final _meta line with processing stats.
"""
import sys
import json
import os

MAX_LINES = 25  # Only need first ~25 lines for metadata


def try_claude(lines):
    for line in lines:
        try:
            obj = json.loads(line.strip())
            if obj.get("type") == "user" and "gitBranch" in obj:
                return {
                    "platform": "claude",
                    "branch": obj["gitBranch"],
                    "ts": obj.get("timestamp", ""),
                    "session": obj.get("sessionId", ""),
                }
        except (json.JSONDecodeError, KeyError):
            pass
    return None


def try_codex(lines):
    meta = {}
    for line in lines:
        try:
            obj = json.loads(line.strip())
            if obj.get("type") == "session_meta":
                p = obj.get("payload", {})
                meta["platform"] = "codex"
                meta["cwd"] = p.get("cwd", "")
                meta["session"] = p.get("id", "")
                meta["ts"] = p.get("timestamp", obj.get("timestamp", ""))
                meta["source"] = p.get("source", "")
                meta["cli_version"] = p.get("cli_version", "")
            elif obj.get("type") == "turn_context":
                p = obj.get("payload", {})
                meta["model"] = p.get("model", "")
                meta["cwd"] = meta.get("cwd") or p.get("cwd", "")
        except (json.JSONDecodeError, KeyError):
            pass
    return meta if meta else None


def try_cursor(lines):
    """Cursor agent transcripts: role-based entries, no timestamps or metadata fields."""
    for line in lines:
        try:
            obj = json.loads(line.strip())
            # Cursor entries have 'role' at top level but no 'type'
            if obj.get("role") in ("user", "assistant") and "type" not in obj:
                return {"platform": "cursor"}
        except (json.JSONDecodeError, KeyError):
            pass
    return None


def try_opencode(session_id):
    """OpenCode sessions: Query SQLite database for session metadata.
    
    Session data is stored in:
    ~/.local/share/opencode/opencode.db (session and message tables)
    
    The 'directory' field contains the original working directory path.
    """
    import subprocess
    
    db = os.path.expanduser("~/.local/share/opencode/opencode.db")
    if not os.path.isfile(db):
        return None
    
    try:
        # Query session table for this session ID
        result = subprocess.run(
            ["sqlite3", db, 
             f"SELECT id, directory, title, project_id, parent_id, time_created, time_updated FROM session WHERE id = '{session_id}'"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None
        
        parts = result.stdout.strip().split("|")
        if len(parts) < 2:
            return None
        
        return {
            "platform": "opencode",
            "session": parts[0],
            "directory": parts[1],
            "title": parts[2] if len(parts) > 2 else "",
            "projectID": parts[3] if len(parts) > 3 else "",
            "parentID": parts[4] if len(parts) > 4 else None,
            "time_created": parts[5] if len(parts) > 5 else None,
            "time_updated": parts[6] if len(parts) > 6 else None,
        }
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError, IOError):
        return None


def extract_from_lines(lines):
    return try_claude(lines) or try_codex(lines) or try_cursor(lines)


TAIL_BYTES = 16384  # Read last 16KB to find final timestamp past trailing metadata


def get_last_timestamp(filepath, size):
    """Read the tail of a file to find the last message with a timestamp."""
    try:
        with open(filepath, "rb") as f:
            f.seek(max(0, size - TAIL_BYTES))
            tail = f.read().decode("utf-8", errors="ignore")
            lines = tail.strip().split("\n")
        for line in reversed(lines):
            try:
                obj = json.loads(line.strip())
                if "timestamp" in obj:
                    return obj["timestamp"]
            except (json.JSONDecodeError, KeyError):
                pass
    except (OSError, IOError):
        pass
    return None


def process_file(filepath_or_session_id):
    """Process a file path (JSONL) or session ID (OpenCode from discover).
    
    OpenCode sessions are identified by ses_xxx format (no .json extension).
    """
    # Check if this is an OpenCode session ID (ses_xxx format from discover script)
    if filepath_or_session_id.startswith("ses_"):
        session_id = filepath_or_session_id
        result = try_opencode(session_id)
        if result:
            return result, None
        else:
            return None, session_id
    
    # Otherwise treat as a file path (JSONL for Claude/Codex/Cursor)
    filepath = filepath_or_session_id
    try:
        size = os.path.getsize(filepath)
        
        # JSONL files (Claude Code, Codex, Cursor)
        with open(filepath, "r") as f:
            lines = []
            for i, line in enumerate(f):
                if i >= MAX_LINES:
                    break
                lines.append(line)
        result = extract_from_lines(lines)
        if result:
            result["file"] = filepath
            result["size"] = size
            if result["platform"] == "cursor":
                # Cursor transcripts have no timestamps in JSONL.
                # Use file modification time as the best available signal.
                # Derive session ID from the parent directory name (UUID).
                mtime = os.path.getmtime(filepath)
                from datetime import datetime, timezone

                result["ts"] = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
                result["session"] = os.path.basename(os.path.dirname(filepath))
            else:
                last_ts = get_last_timestamp(filepath, size)
                if last_ts:
                    result["last_ts"] = last_ts
            return result, None
        else:
            return None, filepath
    except (OSError, IOError) as e:
        return None, filepath


# Parse arguments: files and optional --cwd-filter <substring>
files = []
cwd_filter = None
args = sys.argv[1:]
i = 0
while i < len(args):
    if args[i] == "--cwd-filter" and i + 1 < len(args):
        cwd_filter = args[i + 1]
        i += 2
    elif not args[i].startswith("-"):
        files.append(args[i])
        i += 1
    else:
        i += 1

if files:
    # Batch mode: process all files
    processed = 0
    parse_errors = 0
    filtered = 0
    for item in files:
        # Accept: .jsonl (Claude/Codex/Cursor), .json files, or session IDs (ses_xxx)
        # OpenCode session IDs from discover are passed directly
        if item.startswith("ses_"):
            # OpenCode session ID from discover script
            result, error = process_file(item)
        elif item.endswith(".jsonl"):
            result, error = process_file(item)
        else:
            continue
        processed += 1
        if result:
            # Apply CWD filter: skip Codex sessions from other repos
            if cwd_filter:
                # For Codex: check cwd field
                if result.get("cwd") and cwd_filter not in result["cwd"]:
                    filtered += 1
                    continue
                # For OpenCode: check directory field
                if result.get("directory") and cwd_filter not in result["directory"]:
                    filtered += 1
                    continue
            print(json.dumps(result))
        elif error:
            parse_errors += 1

    meta = {"_meta": True, "files_processed": processed, "parse_errors": parse_errors}
    if filtered:
        meta["filtered_by_cwd"] = filtered
    print(json.dumps(meta))
else:
    # No file arguments: either single-file stdin mode or empty xargs invocation.
    # When xargs runs us with no input (e.g., discover found no files), stdin is
    # empty or a TTY — emit a clean zero-file result instead of a false parse error.
    if sys.stdin.isatty():
        lines = []
    else:
        lines = list(sys.stdin)

    if not lines:
        # No input at all — zero-file result (clean exit for empty pipelines)
        print(json.dumps({"_meta": True, "files_processed": 0, "parse_errors": 0}))
    else:
        # Genuine single-file stdin mode (backward compatible)
        result = extract_from_lines(lines)
        if result:
            print(json.dumps(result))
        print(json.dumps({"_meta": True, "files_processed": 1, "parse_errors": 0 if result else 1}))
