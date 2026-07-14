<script setup lang="ts">
// The builder's code editor (the registry's 'code' fields): prism-code-editor,
// a textarea with a highlight overlay, plus its basic editing extensions
// (Tab indent, auto-indent, auto-closing pairs, Mod+/ comments, undo/redo).
// VarField owns the box around it (label, ring, invalid state) and wires the
// {{ }} autocomplete straight onto the editor's textarea; this component only
// bridges editor <-> v-model and exposes the editor for programmatic inserts.
import { createEditor, type PrismEditor } from 'prism-code-editor'
import { defaultKeymap, editHistory, editorCommands } from 'prism-code-editor/commands'
import { matchBrackets } from 'prism-code-editor/match-brackets'
// Grammars (highlighting) + language behavior (comment tokens, auto-indent;
// clike registers 'javascript').
import 'prism-code-editor/prism/languages/bash'
import 'prism-code-editor/prism/languages/javascript'
import 'prism-code-editor/languages/bash'
import 'prism-code-editor/languages/clike'
import 'prism-code-editor/layout.css'
import 'prism-code-editor/themes/github-dark.css'

const props = defineProps<{
  lang: 'javascript' | 'bash'
  placeholder?: string
  disabled?: boolean
  /** Minimum visible lines (the box grows with the content). */
  rows?: number
}>()

const model = defineModel<string>({ default: '' })

const host = ref<HTMLElement>()
const editor = shallowRef<PrismEditor | null>(null)

onMounted(() => {
  editor.value = createEditor(host.value!, {
    language: props.lang,
    value: model.value ?? '',
    wordWrap: true,
    lineNumbers: false,
    readOnly: props.disabled,
    tabSize: 2,
    onUpdate: value => model.value = value,
  }, editorCommands(defaultKeymap), editHistory(), matchBrackets(true))
})

// External writes (chip inserts go through insertText and keep history; this
// covers programmatic resets like switching the inspected step).
watch(model, (value) => {
  const ed = editor.value
  if (ed && ed.value !== (value ?? '')) ed.setOptions({ value: value ?? '' })
})
watch(() => props.disabled, readOnly => editor.value?.setOptions({ readOnly }))

onBeforeUnmount(() => editor.value?.remove())

defineExpose({ editor })
</script>

<template>
  <div
    class="k-code-editor relative"
    :style="{ '--code-min-lines': rows ?? 3 }"
  >
    <div ref="host" />
    <span
      v-if="props.placeholder && !model"
      aria-hidden="true"
      class="k-mono pointer-events-none absolute left-2.5 top-1.5 whitespace-pre-wrap text-xs text-dimmed"
    >{{ props.placeholder }}</span>
  </div>
</template>

<style scoped>
/* Blend the editor into the knecht field look: our mono font and type scale,
   transparent background (the VarField box paints the surface), brand caret
   and a translucent primary selection. */
.k-code-editor :deep(.prism-code-editor) {
  font-family: var(--font-mono);
  font-size: 12px;
  min-height: calc(var(--code-min-lines) * 1.4em + 0.75rem);
  --pce-bg: transparent;
  --pce-cursor: var(--text-default);
  --pce-selection: color-mix(in oklab, var(--primary) 30%, transparent);
  --padding-inline: 0.625rem;
}
.k-code-editor :deep(.pce-wrapper) {
  margin: 0.375rem 0;
}
</style>
