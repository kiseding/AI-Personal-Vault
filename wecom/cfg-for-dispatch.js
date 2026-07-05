/**
 * 为 WeCom 入站 dispatch 临时屏蔽 OpenClaw `message` 工具。
 *
 * 不屏蔽时，模型会用 `message(action="send")` 把回复发给当前会话——
 * OpenClaw 核心走 agent API 主动推送通道，绕开 ws-monitor 的 deliver 累积，
 * 导致思考卡里看不到任何回复，并消耗每日 active send quota。
 *
 * 与官方 @wecom/wecom-openclaw-plugin 的 webhook/helpers.js:buildCfgForDispatch
 * 保持一致；只做 deny 部分。
 */
export function buildCfgForDispatch(config) {
  const baseTools = config?.tools ?? {};
  const baseSandbox = baseTools?.sandbox ?? {};
  const baseSandboxTools = baseSandbox?.tools ?? {};
  const existingTopLevelDeny = Array.isArray(baseTools.deny) ? baseTools.deny : [];
  const existingSandboxDeny = Array.isArray(baseSandboxTools.deny) ? baseSandboxTools.deny : [];
  const topLevelDeny = Array.from(new Set([...existingTopLevelDeny, "message"]));
  const sandboxDeny = Array.from(new Set([...existingSandboxDeny, "message"]));
  return {
    ...config,
    tools: {
      ...baseTools,
      deny: topLevelDeny,
      sandbox: {
        ...baseSandbox,
        tools: {
          ...baseSandboxTools,
          deny: sandboxDeny,
        },
      },
    },
  };
}
