#!/usr/bin/env bash
# setup.sh — one-shot setup for the OpenClaw WeCom plugin.
#
# Walks the user through writing the recommended config values into
# ~/.openclaw/openclaw.json:
#   - channels.wecom.{botId, secret, dmPolicy=open, groupPolicy=open, allowFrom=["*"]}
#   - plugins.entries.wecom.enabled = true
#   - agents.defaults.thinkingDefault = medium
#   - tools.profile = full
#
# Re-running is safe: existing values are preserved unless explicitly
# overridden via flags.
#
# Usage:
#   bash scripts/setup.sh                                    # interactive (single-account)
#   bash scripts/setup.sh --bot-id <id> --secret <s>         # non-interactive single-account
#   bash scripts/setup.sh --account-name sales \
#                            --bot-id <id> --secret <s>      # add a named account (multi-account mode)
#   bash scripts/setup.sh --openclaw-config <path>           # custom config path
#   bash scripts/setup.sh --reset-wecom                     # clear wecom channel block first

set -euo pipefail

CONFIG_PATH="${HOME}/.openclaw/openclaw.json"
BOT_ID=""
SECRET=""
ACCOUNT_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bot-id)        BOT_ID="$2"; shift 2 ;;
    --secret)        SECRET="$2"; shift 2 ;;
    --account-name)  ACCOUNT_NAME="$2"; shift 2 ;;
    --openclaw-config) CONFIG_PATH="$2"; shift 2 ;;
    --reset-wecom)   RESET_WECOM=1; shift ;;
    -h|--help)
      sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required for JSON editing." >&2
  exit 1
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "ERROR: $CONFIG_PATH not found. Run 'openclaw onboard' first." >&2
  exit 1
fi

# Make sure the plugin is installed.
if ! openclaw plugins list 2>/dev/null | grep -q wecom; then
  echo "ERROR: wecom plugin is not installed. Run:" >&2
  echo "  openclaw plugins install /path/to/AI-Personal-Vault" >&2
  exit 1
fi

if [[ -z "$BOT_ID" || -z "$SECRET" ]]; then
  echo "WeCom bot credentials"
  echo "  Create the AI bot in 企业微信管理后台 → 应用管理 → 智能机器人"
  echo "  Switch it to 长连接 mode, then copy BotId and Secret"
  echo
  read -r -p "Bot ID  : " BOT_ID
  read -r -s -p "Secret  : " SECRET; echo
fi

if [[ -z "$BOT_ID" || -z "$SECRET" ]]; then
  echo "ERROR: botId and secret are required." >&2
  exit 1
fi

python3 - "$CONFIG_PATH" "$BOT_ID" "$SECRET" "${RESET_WECOM:-0}" "${ACCOUNT_NAME:-}" <<'PY'
import json, sys, os
cfg_path, bot_id, secret, reset, account_name = sys.argv[1:6]
reset = bool(int(reset))
account_name = account_name.strip() or None

with open(cfg_path, "r", encoding="utf-8") as f:
    raw = f.read()
try:
    cfg = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError as e:
    print(f"ERROR: failed to parse {cfg_path}: {e}", file=sys.stderr)
    sys.exit(1)

def set_path(obj, dotted, value):
    keys = dotted.split(".")
    cur = obj
    for k in keys[:-1]:
        if k not in cur or not isinstance(cur[k], dict):
            cur[k] = {}
        cur = cur[k]
    cur[keys[-1]] = value

def get_path(obj, dotted):
    keys = dotted.split(".")
    cur = obj
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur

changed = []

# plugins.entries.wecom.enabled
if get_path(cfg, "plugins.entries.wecom.enabled") is not True:
    set_path(cfg, "plugins.entries.wecom.enabled", True)
    changed.append("plugins.entries.wecom.enabled = true")

# channels.wecom — bot credentials and open access policies.
# Supports two layouts:
#   1) Single-account (legacy):
#        channels.wecom = { botId, secret, dmPolicy, ... }
#   2) Multi-account (preferred for >=2 bots):
#        channels.wecom = { defaultAccount: "default",
#                            default: { botId, secret, ... },
#                            second:  { botId, secret, ... },
#                            dmPolicy, groupPolicy, allowFrom (shared) }
# We always migrate (1) -> (2) when adding a second account, so both bots
# are addressable.
wecom = cfg.get("channels", {}).get("wecom", {}) if isinstance(cfg.get("channels"), dict) else {}
if reset:
    wecom = {}
    changed.append("channels.wecom reset")

wecom.setdefault("enabled", True)
if wecom.get("enabled") is not True:
    wecom["enabled"] = True
    changed.append("channels.wecom.enabled = true")

# Migrate legacy single-account layout -> multi-account, but only when
# we are about to add a second bot (account_name explicitly provided).
if account_name and wecom.get("botId") and wecom.get("secret") \
        and not any(isinstance(v, dict) and v.get("botId") for v in wecom.values()):
    legacy_bot = wecom.pop("botId")
    legacy_secret = wecom.pop("secret")
    default_block = {
        "botId": legacy_bot,
        "secret": legacy_secret,
    }
    # Preserve account-specific overrides that were at top level (e.g.
    # allowFrom) by copying them into the default block.
    for key in ("dmPolicy", "allowFrom", "groupPolicy", "groupChat",
                "sendThinkingMessage", "workspaceTemplate", "agent"):
        if key in wecom:
            default_block[key] = wecom.pop(key)
    wecom["default"] = default_block
    wecom["defaultAccount"] = "default"
    changed.append(
        f"migrated legacy top-level botId/secret -> channels.wecom.default ({legacy_bot[:10]}…)"
    )

target_account = account_name  # may be None for single-account mode

if target_account:
    # Multi-account mode.
    block = wecom.get(target_account)
    if not isinstance(block, dict):
        block = {}
        wecom[target_account] = block
        changed.append(f"channels.wecom.{target_account} = {{}} (new)")
    if block.get("botId") != bot_id:
        block["botId"] = bot_id
        changed.append(f"channels.wecom.{target_account}.botId = {bot_id}")
    if block.get("secret") != secret:
        block["secret"] = secret
        changed.append(f"channels.wecom.{target_account}.secret = ***")
else:
    # Single-account mode: write to top level.
    if wecom.get("botId") != bot_id:
        wecom["botId"] = bot_id
        changed.append(f"channels.wecom.botId = {bot_id}")
    if wecom.get("secret") != secret:
        wecom["secret"] = secret
        changed.append("channels.wecom.secret = ***")

# Shared defaults applied at top level (apply to all accounts).
if wecom.get("dmPolicy") != "open":
    wecom["dmPolicy"] = "open"
    changed.append("channels.wecom.dmPolicy = open")
if wecom.get("allowFrom") != ["*"]:
    wecom["allowFrom"] = ["*"]
    changed.append('channels.wecom.allowFrom = ["*"]')
if wecom.get("groupPolicy") != "open":
    wecom["groupPolicy"] = "open"
    changed.append("channels.wecom.groupPolicy = open")
wecom.setdefault("sendThinkingMessage", True)

# mediaLocalRoots: allow the AI to send files that live in the
# OpenClaw state directory (e.g. the inbound media folder) and the
# per-agent workspace. Without these, MEDIA:/FILE: directives in the
# AI's reply will be rejected with LocalMediaAccessError.
# The default roots the OpenClaw core already adds are
# {stateDir}/media, /agents, /workspace, /sandboxes. We only need to
# add a workspace expansion for the active agent.
import os
state_dir = os.environ.get("HOME", "") + "/.openclaw"
default_media_roots = [
    state_dir + "/media",
    state_dir + "/workspace",
]
existing_roots = wecom.get("mediaLocalRoots") or []
merged_roots = list(dict.fromkeys([*existing_roots, *default_media_roots]))
if merged_roots != existing_roots:
    wecom["mediaLocalRoots"] = merged_roots
    added = [r for r in merged_roots if r not in existing_roots]
    for r in added:
        changed.append(f"channels.wecom.mediaLocalRoots += {r}")

cfg.setdefault("channels", {})["wecom"] = wecom

# agents.defaults.thinkingDefault = medium (recommended for snappy replies)
if get_path(cfg, "agents.defaults.thinkingDefault") != "medium":
    set_path(cfg, "agents.defaults.thinkingDefault", "medium")
    changed.append("agents.defaults.thinkingDefault = medium")

# tools.profile = full so the AI can use the message tool (otherwise it
# must rely on MEDIA:/FILE: directives).
if get_path(cfg, "tools.profile") != "full":
    set_path(cfg, "tools.profile", "full")
    changed.append("tools.profile = full")

# Write back, preserving original formatting as much as possible.
with open(cfg_path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"Updated {cfg_path}:")
for line in changed:
    print(f"  - {line}")
if not changed:
    print("  (no changes needed, already configured)")
PY

echo
echo "Done. Restart the gateway to pick up the new config:"
echo "  systemctl --user restart openclaw-gateway.service"