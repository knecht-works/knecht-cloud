<script setup lang="ts">
// One settings field of a step (text/textarea/switch, driven by the registry's
// StepField). Template-capable fields (`field.vars`) get the n8n treatment:
// typing `{{ ` opens an autocomplete of every variable available at this step,
// and the inspector's variable chips insert through `insertVar()` at the caret.
const props = defineProps<{
  field: StepField
  groups: VarGroup[]
  disabled?: boolean
}>()

const model = defineModel<string | boolean>()
const emit = defineEmits<{ focus: [] }>()

const wrap = ref<HTMLElement>()

function el(): HTMLInputElement | HTMLTextAreaElement | null {
  return wrap.value?.querySelector('input, textarea') ?? null
}

// ── {{ autocomplete ─────────────────────────────────────────────────────────
const flatVars = computed(() => props.groups.flatMap(g => g.vars))
const open = ref(false)
const active = ref(0)
// The `{{ partial` before the caret (match start + typed path so far).
const token = ref<{ start: number, partial: string } | null>(null)

const matches = computed(() => {
  if (!token.value) return []
  const q = token.value.partial.toLowerCase()
  return flatVars.value.filter(v => v.path.toLowerCase().includes(q))
})

function refreshToken() {
  const input = el()
  if (!input || typeof model.value !== 'string') return close()
  const cursor = input.selectionStart ?? model.value.length
  const m = /\{\{\s*([\w.]*)$/.exec(model.value.slice(0, cursor))
  if (!m) return close()
  token.value = { start: m.index, partial: m[1] ?? '' }
  active.value = 0
  open.value = true
}

function close() {
  open.value = false
  token.value = null
}

function pick(path: string) {
  const input = el()
  if (!input || typeof model.value !== 'string' || !token.value) return
  const cursor = input.selectionStart ?? model.value.length
  const before = model.value.slice(0, token.value.start)
  const after = model.value.slice(cursor).replace(/^\s*\}\}/, '')
  const inserted = `{{ ${path} }}`
  model.value = before + inserted + after
  close()
  nextTick(() => {
    input.focus()
    const at = before.length + inserted.length
    input.setSelectionRange(at, at)
  })
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value || !matches.value.length) return
  if (e.key === 'ArrowDown') {
    active.value = (active.value + 1) % matches.value.length
    e.preventDefault()
  }
  else if (e.key === 'ArrowUp') {
    active.value = (active.value - 1 + matches.value.length) % matches.value.length
    e.preventDefault()
  }
  else if (e.key === 'Enter' || e.key === 'Tab') {
    pick(matches.value[active.value]!.path)
    e.preventDefault()
  }
  else if (e.key === 'Escape') {
    close()
  }
}

// The inspector's variable chips insert into the last-focused field.
function insertVar(path: string) {
  const input = el()
  if (typeof model.value === 'boolean') return
  const value = model.value ?? ''
  const cursor = input?.selectionStart ?? value.length
  const inserted = `{{ ${path} }}`
  model.value = value.slice(0, cursor) + inserted + value.slice(cursor)
  nextTick(() => {
    input?.focus()
    const at = cursor + inserted.length
    input?.setSelectionRange(at, at)
  })
}

defineExpose({ insertVar, acceptsVars: () => !!props.field.vars })
</script>

<template>
  <USwitch
    v-if="field.input === 'switch'"
    v-model="model as boolean"
    :disabled="disabled"
    :label="field.label"
  />
  <div
    v-else
    ref="wrap"
    class="relative"
    @focusin="emit('focus')"
  >
    <span class="k-label">{{ field.label }}<span
      v-if="field.required"
      class="text-(--text-dimmed)"
    > *</span></span>
    <UTextarea
      v-if="field.input === 'textarea'"
      v-model="model as string"
      :rows="field.rows ?? 3"
      autoresize
      spellcheck="false"
      :disabled="disabled"
      :placeholder="field.placeholder"
      class="mt-1.5 w-full"
      :ui="{ base: 'k-mono text-[12.5px] resize-none' }"
      @input="field.vars && refreshToken()"
      @click="field.vars && refreshToken()"
      @keydown="onKeydown"
      @blur="close"
    />
    <UInput
      v-else
      v-model="model as string"
      spellcheck="false"
      :disabled="disabled"
      :placeholder="field.placeholder"
      class="mt-1.5 w-full"
      :ui="{ base: 'k-mono' }"
      @input="field.vars && refreshToken()"
      @click="field.vars && refreshToken()"
      @keydown="onKeydown"
      @blur="close"
    />

    <!-- {{ autocomplete dropdown -->
    <div
      v-if="open && matches.length"
      class="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-(--radius-md) border border-(--border-default) bg-(--surface-elevated)"
      style="box-shadow: var(--shadow-panel)"
    >
      <button
        v-for="(v, i) in matches"
        :key="v.path"
        type="button"
        class="flex w-full items-baseline gap-2.5 px-3 py-2 text-left"
        :style="i === active ? { background: 'var(--surface-accented)' } : undefined"
        @mousedown.prevent="pick(v.path)"
        @mousemove="active = i"
      >
        <span class="k-mono text-[12px] text-(--text-primary)">{{ v.path }}</span>
        <span class="truncate text-[11px] text-(--text-dimmed)">{{ v.hint }}</span>
      </button>
    </div>
  </div>
</template>
