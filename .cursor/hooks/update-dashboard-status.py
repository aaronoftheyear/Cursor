#!/usr/bin/env python3
"""Write live agent status for the GBA dashboard from Cursor hook events."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STATUS_DIR = PROJECT_ROOT / ".dashboard"
STATUS_FILE = STATUS_DIR / "live-status.json"
PUBLIC_MIRROR = PROJECT_ROOT / "public" / "live-status.json"
LINKS_FILE = PROJECT_ROOT / "public" / "assets" / "agent-links.json"

DEFAULT_AGENTS = ("jarvis", "friday", "bumblebee")

ACTIVITY_LABELS = {
    "planning": "Planning",
    "editing": "Editing",
    "running": "Running",
    "thinking": "Thinking",
    "reading": "Reading",
    "researching": "Researching",
    "github": "GitHub",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_agent_link_specs() -> dict[str, dict[str, list[str]]]:
    empty = {
        "markers": [],
        "workspaces": [],
        "agent_names": [],
    }
    out: dict[str, dict[str, list[str]]] = {
        agent_id: dict(empty) for agent_id in DEFAULT_AGENTS
    }
    if not LINKS_FILE.is_file():
        return out
    try:
        data = json.loads(LINKS_FILE.read_text(encoding="utf-8"))
        for agent_id, spec in (data.get("agents") or {}).items():
            cursor = spec.get("cursor") if isinstance(spec, dict) else None
            if not isinstance(cursor, dict):
                continue
            out[agent_id] = {
                "markers": [
                    str(m).lower() for m in cursor.get("payloadContains") or []
                ],
                "workspaces": [
                    str(w).lower() for w in cursor.get("workspaceContains") or []
                ],
                "agent_names": [
                    str(n).lower() for n in cursor.get("agentNameContains") or []
                ],
            }
    except (json.JSONDecodeError, OSError):
        pass
    return out


def payload_blob(hook: object) -> str:
    return json.dumps(hook, default=str).lower()


def is_dashboard_workspace(hook: dict) -> bool:
    """Only true when the active workspace root is the Dashboard repo (not cwd/file paths)."""
    ws = primary_workspace_root(hook)
    if not ws:
        return False
    root_hint = str(PROJECT_ROOT).lower().replace("\\", "/")
    return "cursor projects/dashboard" in ws or ws == root_hint or ws.endswith("/dashboard")


def primary_workspace_root(hook: dict) -> str:
    roots = hook.get("workspace_roots") or hook.get("workspace_root") or []
    if isinstance(roots, str):
        roots = [roots]
    if roots:
        return str(roots[0]).lower().replace("\\", "/")
    for key in ("workspace_folder", "project_path", "root_path", "rootPath"):
        val = hook.get(key)
        if val:
            return str(val).lower().replace("\\", "/")
    return ""


def workspace_blob(hook: dict) -> str:
    roots = hook.get("workspace_roots") or hook.get("workspace_root") or []
    if isinstance(roots, str):
        roots = [roots]
    parts = [str(r).lower().replace("\\", "/") for r in roots]
    primary = primary_workspace_root(hook)
    if primary and primary not in parts:
        parts.append(primary)
    for key in ("file_path", "path", "filePath"):
        val = hook.get(key)
        if val:
            parts.append(str(val).lower().replace("\\", "/"))
    return " ".join(parts)


def agent_name_blob(hook: dict) -> str:
    parts: list[str] = []
    for key in ("agent_name", "agent", "subagent_type", "name", "composer"):
        val = hook.get(key)
        if val:
            parts.append(str(val).lower())
    return " ".join(parts)


def agents_from_workspaces(
    hook: dict, specs: dict[str, dict[str, list[str]]]
) -> list[str]:
    ws = workspace_blob(hook)
    if not ws.strip():
        return []
    matched: list[str] = []
    for agent_id, spec in specs.items():
        for fragment in spec.get("workspaces") or []:
            if fragment and fragment in ws:
                matched.append(agent_id)
                break
    return matched


def agents_matching_hook(
    hook: dict,
    specs: dict[str, dict[str, list[str]]],
    *,
    allow_cloud_payload: bool = True,
) -> list[str]:
    blob = payload_blob(hook)
    names = agent_name_blob(hook)
    matched: list[str] = []
    for agent_id, spec in specs.items():
        if not allow_cloud_payload and agent_id in ("friday", "bumblebee"):
            name_hints = spec.get("agent_names") or []
            if name_hints and names and any(hint in names for hint in name_hints):
                matched.append(agent_id)
            continue
        markers = spec.get("markers") or []
        if markers and any(marker in blob for marker in markers):
            matched.append(agent_id)
            continue
        name_hints = spec.get("agent_names") or []
        if name_hints and names:
            if any(hint in names for hint in name_hints):
                matched.append(agent_id)
    return matched


def is_bumblebee_subagent(hook: dict) -> bool:
    names = agent_name_blob(hook)
    blob = payload_blob(hook)
    if "bumblebee" in names:
        return True
    for hint in ("bumblebee", "cloud-worker", "cloud worker"):
        if hint in names or hint in blob:
            return True
    return False


def bumblebee_protocol_requested(hook: dict) -> bool:
    blob = payload_blob(hook)
    triggers = (
        "bumblebee protocol",
        "bumblebeeprot",
        "run bumblebee",
        "activate bumblebee",
        "deploy bumblebee",
        "bumblebee subagent",
    )
    return any(t in blob for t in triggers)


def augment_cloud_agents(
    hook: dict, agent_ids: list[str], specs: dict[str, dict[str, list[str]]]
) -> list[str]:
    expanded = set(agent_ids)
    from_ws = set(agents_from_workspaces(hook, specs))
    if bumblebee_protocol_requested(hook) or is_bumblebee_subagent(hook):
        expanded.add("bumblebee")
        if from_ws & {"friday"}:
            expanded.add("friday")
        elif "friday" in expanded:
            pass
        elif from_ws:
            expanded.update(from_ws & {"friday"})
    return sorted(expanded)


def resolve_matched_agents(hook: dict, specs: dict[str, dict[str, list[str]]]) -> list[str]:
    from_ws = set(agents_from_workspaces(hook, specs))
    dashboard = is_dashboard_workspace(hook)

    if dashboard:
        # Dashboard repo text mentions F.R.I.D.A.Y. / Bumblebee — ignore payload cloud markers.
        if from_ws & {"friday", "bumblebee"}:
            return sorted(from_ws)
        return ["jarvis"]

    from_payload = set(
        agents_matching_hook(hook, specs, allow_cloud_payload=True)
    )
    return augment_cloud_agents(hook, sorted(from_ws | from_payload), specs)


def is_relevant_session(hook: dict, specs: dict[str, dict[str, list[str]]]) -> bool:
    if resolve_matched_agents(hook, specs):
        return True
    return is_dashboard_workspace(hook)


def default_agent_status(agent_id: str) -> dict:
    labels = {
        "jarvis": "Waiting for Cursor session",
        "friday": "Waiting for F.R.I.D.A.Y. session",
        "bumblebee": "Waiting for Bumblebee session",
    }
    return {
        "status": "idle",
        "source": "cursor",
        "detail": labels.get(agent_id, "Idle"),
    }


def load_state() -> dict:
    if STATUS_FILE.is_file():
        try:
            state = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
            agents = state.setdefault("agents", {})
            for agent_id in DEFAULT_AGENTS:
                agents.setdefault(agent_id, default_agent_status(agent_id))
            return state
        except json.JSONDecodeError:
            pass
    return {
        "updatedAt": None,
        "activeSessions": 0,
        "agents": {agent_id: default_agent_status(agent_id) for agent_id in DEFAULT_AGENTS},
    }


def save_state(state: dict) -> None:
    publish_active_terminals(state)
    state["updatedAt"] = utc_now()
    STATUS_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps(state, indent=2) + "\n"
    STATUS_FILE.write_text(text, encoding="utf-8")
    PUBLIC_MIRROR.write_text(text, encoding="utf-8")


def set_agent(
    state: dict,
    agent_id: str,
    status: str,
    detail: str,
    activity: str | None = None,
    activity_depth: str | None = "brief",
) -> None:
    agents = state.setdefault("agents", {})
    entry: dict = {
        "status": status,
        "source": "cursor",
        "detail": detail,
    }
    if activity and activity in ACTIVITY_LABELS:
        entry["activity"] = activity
    if activity_depth in ("brief", "deep"):
        entry["activityDepth"] = activity_depth
    agents[agent_id] = entry


def resolve_activity_depth(
    event: str, hook: dict, activity: str, state: dict, agent_id: str
) -> str:
    """Brief → computer desk; deep → planning / research markers."""
    tool = tool_name(hook)
    blob = payload_blob(hook)

    if activity in ("editing", "running"):
        return "brief"

    if activity == "planning":
        if event in ("subagentStart",):
            return "deep"
        if event in ("preToolUse", "postToolUse") and tool in (
            "task",
            "switchmode",
            "todo_write",
            "creategoal",
            "updategoal",
        ):
            return "deep"
        if event == "beforeSubmitPrompt" and (
            "plan mode" in blob or '"mode":"plan"' in blob or "switchmode" in blob
        ):
            return "deep"
        return "brief"

    if activity == "thinking":
        if event == "afterAgentThought":
            return "deep"
        return "brief"

    if activity == "reading":
        streaks = state.setdefault("readStreakByAgent", {})
        if event in ("preToolUse", "postToolUse", "beforeReadFile"):
            streaks[agent_id] = int(streaks.get(agent_id, 0)) + 1
        else:
            streaks[agent_id] = 0
        if tool in ("semanticsearch", "task"):
            return "deep"
        if int(streaks.get(agent_id, 0)) >= 4:
            return "deep"
        return "brief"

    if activity == "researching":
        return "deep"

    if activity == "github":
        return "deep"

    return "brief"


def set_idle_agents(state: dict, agent_ids: tuple[str, ...]) -> None:
    for agent_id in agent_ids:
        set_agent(state, agent_id, "idle", default_agent_status(agent_id)["detail"])


def tool_name(hook: dict) -> str:
    raw = hook.get("tool_name") or hook.get("toolName") or ""
    return str(raw).lower()


def is_github_shell_command(cmd: str) -> bool:
    """Check if shell command is a GitHub/git operation."""
    if not cmd or not isinstance(cmd, str):
        return False
    cmd = cmd.strip().lower()
    if cmd.startswith("gh "):
        return True
    git_remote_ops = ("git push", "git pull", "git fetch", "git clone")
    return any(cmd.startswith(op) for op in git_remote_ops)


def activity_from_hook(event: str, hook: dict) -> tuple[str, str]:
    """Return (activity_id, detail_label)."""
    blob = payload_blob(hook)
    tool = tool_name(hook)

    if event == "afterAgentThought":
        return "thinking", ACTIVITY_LABELS["thinking"]

    if event == "beforeReadFile":
        return "reading", ACTIVITY_LABELS["reading"]

    if event == "afterFileEdit":
        return "editing", ACTIVITY_LABELS["editing"]

    if event in ("beforeShellExecution", "afterShellExecution"):
        cmd = hook.get("command") or ""
        if isinstance(cmd, str) and cmd.strip():
            short = cmd.strip().replace("\n", " ")[:48]
            if is_github_shell_command(cmd):
                return "github", f"{ACTIVITY_LABELS['github']}: {short}"
            return "running", f"{ACTIVITY_LABELS['running']}: {short}"
        return "running", ACTIVITY_LABELS["running"]

    if event in ("preToolUse", "postToolUse"):
        if tool in ("shell",) or tool.endswith("shell"):
            cmd = hook.get("command") or hook.get("input", {}).get("command") or ""
            if is_github_shell_command(cmd):
                return "github", ACTIVITY_LABELS["github"]
            return "running", ACTIVITY_LABELS["running"]
        if tool in ("webfetch", "websearch"):
            return "researching", ACTIVITY_LABELS["researching"]
        if tool in (
            "read",
            "grep",
            "glob",
            "list_dir",
            "semanticsearch",
        ):
            return "reading", ACTIVITY_LABELS["reading"]
        if tool in (
            "write",
            "strreplace",
            "search_replace",
            "edit",
            "applypatch",
            "delete",
            "editnotebook",
        ):
            return "editing", ACTIVITY_LABELS["editing"]
        if tool in ("task", "switchmode", "todo_write", "creategoal", "updategoal"):
            return "planning", ACTIVITY_LABELS["planning"]
        if "github" in tool or tool.startswith("github_"):
            return "github", ACTIVITY_LABELS["github"]
        if "mcp" in tool or tool.startswith("call"):
            tool_args = hook.get("input") or hook.get("args") or {}
            tool_str = str(tool_args).lower()
            if "github" in tool_str or "gh " in tool_str:
                return "github", ACTIVITY_LABELS["github"]
            return "running", ACTIVITY_LABELS["running"]
        return "editing", ACTIVITY_LABELS["editing"]

    if event == "beforeSubmitPrompt":
        if "plan mode" in blob or '"mode":"plan"' in blob or "switchmode" in blob:
            return "planning", ACTIVITY_LABELS["planning"]
        return "thinking", ACTIVITY_LABELS["thinking"]

    if event == "sessionStart":
        return "planning", ACTIVITY_LABELS["planning"]

    return "thinking", ACTIVITY_LABELS["thinking"]


def target_agents(hook: dict, specs: dict[str, dict[str, list[str]]]) -> list[str]:
    matched = resolve_matched_agents(hook, specs)
    if matched:
        return matched
    if is_dashboard_workspace(hook):
        return ["jarvis"]
    return []


def detail_for_agent(agent_id: str, activity: str, detail: str) -> str:
    if agent_id == "friday":
        label = ACTIVITY_LABELS.get(activity, detail)
        return f"Cloud troubleshooting — {label}"
    if agent_id == "bumblebee":
        label = ACTIVITY_LABELS.get(activity, detail)
        return f"Cloud worker — {label}"
    return detail


def adjust_shell_in_flight(state: dict, delta: int) -> None:
    state["shellInFlight"] = max(0, int(state.get("shellInFlight", 0)) + delta)


def touch_local_cursor_terminal(state: dict, hook: dict, agents: list[str]) -> None:
    """IDE terminal is present while a local Dashboard / JARVIS session is active."""
    if is_dashboard_workspace(hook) or "jarvis" in agents:
        state["localCursorSessions"] = max(1, int(state.get("localCursorSessions", 0)))


def publish_active_terminals(state: dict) -> None:
    state["activeTerminals"] = max(0, int(state.get("shellInFlight", 0)))


def bump_agent_sessions(state: dict, agent_ids: list[str], delta: int) -> None:
    sessions = state.setdefault(
        "agentSessions", {agent_id: 0 for agent_id in DEFAULT_AGENTS}
    )
    for agent_id in agent_ids:
        if agent_id not in sessions:
            continue
        sessions[agent_id] = max(0, int(sessions.get(agent_id, 0)) + delta)


def main() -> int:
    event = sys.argv[1] if len(sys.argv) > 1 else "unknown"
    try:
        raw = sys.stdin.read()
        hook = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        hook = {}

    if not isinstance(hook, dict):
        hook = {"payload": hook}

    state = load_state()

    # Integrated terminal — count from every workspace (not only Dashboard / cloud matchers).
    if event == "beforeShellExecution":
        adjust_shell_in_flight(state, 1)
        save_state(state)
    elif event == "afterShellExecution":
        adjust_shell_in_flight(state, -1)
        save_state(state)

    specs = load_agent_link_specs()
    if not is_relevant_session(hook, specs):
        return 0

    agents = target_agents(hook, specs)

    if event == "sessionEnd":
        if agents:
            bump_agent_sessions(state, agents, -1)
        sessions = state.setdefault(
            "agentSessions", {agent_id: 0 for agent_id in DEFAULT_AGENTS}
        )
        for agent_id in DEFAULT_AGENTS:
            if int(sessions.get(agent_id, 0)) <= 0:
                set_agent(
                    state,
                    agent_id,
                    "idle",
                    default_agent_status(agent_id)["detail"],
                )
        if not any(int(sessions.get(a, 0)) > 0 for a in DEFAULT_AGENTS):
            state["localCursorSessions"] = 0
            state["shellInFlight"] = 0
        save_state(state)
        return 0

    if event == "stop":
        if agents:
            bump_agent_sessions(state, agents, -1)
            for agent_id in agents:
                sessions = state.get("agentSessions") or {}
                if int(sessions.get(agent_id, 0)) > 0:
                    continue
                set_agent(
                    state,
                    agent_id,
                    "idle",
                    default_agent_status(agent_id)["detail"],
                )
        save_state(state)
        return 0

    if event == "sessionStart":
        if not agents:
            return 0
        touch_local_cursor_terminal(state, hook, agents)
        bump_agent_sessions(state, agents, 1)
        activity, detail = activity_from_hook(event, hook)
        for agent_id in agents:
            depth = resolve_activity_depth(event, hook, activity, state, agent_id)
            set_agent(
                state,
                agent_id,
                "working",
                detail_for_agent(agent_id, activity, detail),
                activity,
                depth,
            )
        save_state(state)
        return 0

    if event in (
        "beforeSubmitPrompt",
        "afterAgentThought",
        "beforeReadFile",
        "afterFileEdit",
        "beforeShellExecution",
        "afterShellExecution",
        "preToolUse",
        "postToolUse",
        "subagentStart",
        "subagentStop",
    ):
        activity, detail = activity_from_hook(event, hook)
        if event == "subagentStart":
            activity = "planning"
            detail = ACTIVITY_LABELS["planning"]
        if agents:
            touch_local_cursor_terminal(state, hook, agents)
        if not agents:
            if event in ("beforeShellExecution", "afterShellExecution"):
                save_state(state)
            return 0
        for agent_id in agents:
            depth = resolve_activity_depth(event, hook, activity, state, agent_id)
            set_agent(
                state,
                agent_id,
                "working",
                detail_for_agent(agent_id, activity, detail),
                activity,
                depth,
            )
        save_state(state)
        return 0

    if event in ("beforeShellExecution", "afterShellExecution"):
        save_state(state)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
