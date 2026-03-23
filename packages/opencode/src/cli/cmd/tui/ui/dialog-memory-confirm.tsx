import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore, produce } from "solid-js/store"
import { For, Show, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export type MemoryItem = {
  key: string
  value: string
  context?: string
  editing?: boolean
}

export type DialogMemoryConfirmProps = {
  memories: MemoryItem[]
  onConfirm?: (memories: MemoryItem[]) => void
  onSkip?: () => void
}

export function DialogMemoryConfirm(props: DialogMemoryConfirmProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    memories: [...props.memories],
    selectedIndex: 0,
    mode: "view" as "view" | "edit" | "add",
    editKey: "",
    editValue: "",
  })

  onMount(() => {
    dialog.setSize("large")
  })

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      if (store.mode === "edit") {
        setStore("mode", "view")
        setStore("memories", store.selectedIndex, "editing", false)
      } else if (store.mode === "add") {
        setStore("mode", "view")
      } else {
        props.onSkip?.()
        dialog.clear()
      }
    }

    if (evt.name === "return") {
      if (store.mode === "edit") {
        setStore(
          "memories",
          store.selectedIndex,
          produce((m: MemoryItem) => {
            m.key = store.editKey
            m.value = store.editValue
            m.editing = false
          }),
        )
        setStore("mode", "view")
      } else if (store.mode === "add") {
        if (store.editKey && store.editValue) {
          setStore(
            "memories",
            produce((ms: MemoryItem[]) => {
              ms.push({ key: store.editKey, value: store.editValue })
            }),
          )
        }
        setStore("mode", "view")
        setStore("editKey", "")
        setStore("editValue", "")
      } else {
        props.onConfirm?.(store.memories)
        dialog.clear()
      }
    }

    if (evt.name === "up" || evt.name === "down") {
      if (store.mode === "view") {
        const maxIndex = store.memories.length - 1
        if (evt.name === "up" && store.selectedIndex > 0) {
          setStore("selectedIndex", store.selectedIndex - 1)
        }
        if (evt.name === "down" && store.selectedIndex < maxIndex) {
          setStore("selectedIndex", store.selectedIndex + 1)
        }
      }
    }

    if (evt.name === "delete") {
      if (store.mode === "view" && store.selectedIndex < store.memories.length) {
        setStore(
          "memories",
          produce((ms: MemoryItem[]) => {
            ms.splice(store.selectedIndex, 1)
          }),
        )
        if (store.selectedIndex > store.memories.length - 1 && store.selectedIndex > 0) {
          setStore("selectedIndex", store.selectedIndex - 1)
        }
      }
    }

    if (evt.name === "e" && store.mode === "view") {
      setStore("mode", "edit")
      setStore("memories", store.selectedIndex, "editing", true)
      setStore("editKey", store.memories[store.selectedIndex].key)
      setStore("editValue", store.memories[store.selectedIndex].value)
    }

    if (evt.name === "a" && store.mode === "view") {
      setStore("mode", "add")
      setStore("editKey", "")
      setStore("editValue", "")
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Confirm Memories
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.textMuted}>Review and edit extracted memories from this session</text>

      <box gap={1}>
        <Show when={store.mode === "view"}>
          <box height={8}>
            <For each={store.memories}>
              {(memory, i) => (
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  flexDirection="row"
                  justifyContent="space-between"
                  backgroundColor={i() === store.selectedIndex ? theme.primary : undefined}
                  onMouseUp={() => setStore("selectedIndex", i())}
                >
                  <box flexDirection="column" width="90%">
                    <text fg={i() === store.selectedIndex ? theme.selectedListItemText : theme.text}>{memory.key}</text>
                    <text fg={theme.textMuted}>
                      {memory.value.length > 50 ? memory.value.slice(0, 47) + "..." : memory.value}
                    </text>
                  </box>
                  <Show when={i() === store.selectedIndex}>
                    <text fg={theme.textMuted}>[e]dit [del]</text>
                  </Show>
                </box>
              )}
            </For>
            <Show when={store.memories.length === 0}>
              <text fg={theme.textMuted}>No memories to confirm</text>
            </Show>
          </box>
        </Show>

        <Show when={store.mode === "edit"}>
          <box flexDirection="column" gap={1}>
            <text fg={theme.textMuted}>Key:</text>
            <box>
              <text fg={theme.text}>{store.editKey}</text>
            </box>
            <text fg={theme.textMuted}>Value:</text>
            <box>
              <text fg={theme.text}>{store.editValue}</text>
            </box>
            <text fg={theme.textMuted}>Press return to save, esc to cancel</text>
          </box>
        </Show>

        <Show when={store.mode === "add"}>
          <box flexDirection="column" gap={1}>
            <text fg={theme.textMuted}>Key (kebab-case):</text>
            <box>
              <text fg={theme.text}>{store.editKey || "(empty)"}</text>
            </box>
            <text fg={theme.textMuted}>Value:</text>
            <box>
              <text fg={theme.text}>{store.editValue || "(empty)"}</text>
            </box>
            <text fg={theme.textMuted}>Press return to add, esc to cancel</text>
          </box>
        </Show>
      </box>

      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text fg={theme.textMuted}>[a] add [del] delete [e] edit</text>
        <box gap={1}>
          <text
            fg={store.mode === "view" ? theme.text : theme.textMuted}
            onMouseUp={() => {
              props.onSkip?.()
              dialog.clear()
            }}
          >
            Skip
          </text>
          <text fg={theme.textMuted}>|</text>
          <text
            fg={theme.primary}
            onMouseUp={() => {
              props.onConfirm?.(store.memories)
              dialog.clear()
            }}
          >
            Save
          </text>
        </box>
      </box>
    </box>
  )
}

DialogMemoryConfirm.show = (dialog: DialogContext, memories: MemoryItem[]) => {
  return new Promise<MemoryItem[]>((resolve) => {
    dialog.replace(
      () => (
        <DialogMemoryConfirm
          memories={memories}
          onConfirm={(result) => resolve(result)}
          onSkip={() => resolve(memories)}
        />
      ),
      () => resolve(memories),
    )
  })
}
