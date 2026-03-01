import { createMemo, For, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "../../context/theme"

export function InfoPanel() {
  const sync = useSync()
  const { theme } = useTheme()
  const logs = createMemo(() => sync.data.logs)

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
            {(log) => (
              <text
                fg={log.level === "error" ? theme.error : log.level === "warning" ? theme.warning : theme.textMuted}
              >
                [{log.source}] {log.message.length > 35 ? log.message.slice(0, 32) + "..." : log.message}
              </text>
            )}
          </For>
        </Show>
      </scrollbox>
    </box>
  )
}
