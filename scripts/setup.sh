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
#   bash scripts/setup.sh                            # interactive
#   bash scripts/setup.sh --bot-id <id> --secret <s> # non-interactive
#   bash scripts/setup.sh --openclaw-config <path>   # custom config path
#   bash scripts/setup.sh --reset-wecom             # clear wecom channel block

set -euo pipefail

CONFIG_PATH="${HOME}/.openclaw/openclaw.json"
BOT_ID=""
SECRET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bot-id)        BOT_ID="$2"; shift 2 ;;
    --secret)        SECRET="$2"; shift 2 ;;
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

python3 - "$CONFIG_PATH" "$BOT_ID" "$SECRET" "${RESET_WECOM:-0}" <<'PY'
import json, sys, os
cfg_path, bot_id, secret, reset = sys.argv[1:5]
reset = bool(int(reset))

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
wecom = cfg.get("channels", {}).get("wecom", {}) if isinstance(cfg.get("channels"), dict) else {}
if reset:
    wecom = {}
    changed.append("channels.wecom reset")

wecom.setdefault("enabled", True)
if get_path(cfg, "channels.wecom.enabled") is not True:
    changed.append("channels.wecom.enabled = true")

if wecom.get("botId") != bot_id:
    wecom["botId"] = bot_id
    changed.append(f"channels.wecom.botId = {bot_id}")

if wecom.get("secret") != secret:
    wecom["secret"] = secret
    changed.append("channels.wecom.secret = ***")

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