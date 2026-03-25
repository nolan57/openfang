import { createMemo, For, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "../../context/theme"

export function InfoPanel() {
  const sync = useSync()
  const { theme } = useTheme()
  const logs = createMemo(() => sync.data.logs)
  const maxLogLength = 50

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={14}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="column"
    >
      <box flexShrink={0} paddingBottom={1}>
        <text fg={theme.text}>
          <b>Logs</b>
        </text>
      </box>
      <scrollbox flexGrow={1}>
        <Show when={logs().length > 0} fallback={<text fg={theme.textMuted}>No logs</text>}>
          <For each={[...logs()].reverse()}>
            {(log) => {
              const timestamp = new Date(log.timestamp).toLocaleTimeString()
              const sourcePrefix = log.source ? `[${log.source}]` : ""
              const message =
                log.message.length > maxLogLength ? log.message.slice(0, maxLogLength - 3) + "..." : log.message
              const icon = log.level === "error" ? "✗" : log.level === "warning" ? "⚠" : "•"

              return (
                <box flexDirection="column" marginBottom={1}>
                  <text
                    fg={log.level === "error" ? theme.error : log.level === "warning" ? theme.warning : theme.textMuted}
                  >
                    {timestamp} {icon}
                  </text>
                  <text
                    fg={log.level === "error" ? theme.error : log.level === "warning" ? theme.warning : theme.text}
                    wrapMode="word"
                  >
                    {sourcePrefix} {message}
                  </text>
                </box>
              )
            }}
          </For>
        </Show>
      </scrollbox>
    </box>
  )
}
