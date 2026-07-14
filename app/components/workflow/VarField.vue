<script setup lang="ts">
// One settings field of a step (text/textarea/switch, driven by the registry's
// StepField). Template-capable fields (`field.vars`) get the n8n treatment:
// typing `{{ ` opens an autocomplete of every variable available at this step,
// and the inspector's variable chips insert through `insertVar()` at the caret.
const props = defineProps<{
  field: StepField
  groups: VarGroup[]
  disabled?: boolean
  /** Highlights the field as blocking the save (empty required field). */
  invalid?: boolean
}>()

const model = defineModel<string | boolean>()
const emit = defineEmits<{ focus: [] }>()

// Unlabeled fields render compact (no label line, smaller text): how inline
// rows like the condition editor embed the field.
const compact = computed(() => !props.field.label)

// The invalid ring replaces the resting hairline on the input itself.
const invalidRing = computed(() => props.invalid ? ' ring-(--accent-orange)' : '')

const wrap = ref<HTMLElement>()

function el(): HTMLInputElement | HTMLTextAreaElement | null {
  return wrap.value?.querySelector('input, textarea') ?? null
}

// ── {{ autocomplete ─────────────────────────────────────────────────────────
// Vars flattened with their group's kind colour, so the dropdown paints a
// path's final segment the same way the chip list does.
const flatVars = computed(() => props.groups.flatMap(g => g.vars.map(v => ({ ...v, color: g.color }))))
const open = ref(false)
const active = ref(0)
// The `{{ partial` before the caret (match start + typed path so far).
const token = ref<{ start: number, partial: string } | null>(null)

const matches = computed(() => {
  if (!token.value) return []
  const q = token.value.partial.toLowerCase()
  return flatVars.value.filter(v => v.path.toLowerCase().includes(q))
})

// The dropdown teleports to <body> (the step card clips overflow for its
// rounded corners, which would cut it off), so it's positioned fixed under
// the input and re-anchored on scroll/resize while open.
const list = ref<HTMLElement>()
const pos = ref({ top: 0, left: 0, width: 0 })

function place() {
  const rect = el()?.getBoundingClientRect()
  if (rect) pos.value = { top: rect.bottom + 4, left: rect.left, width: rect.width }
}

watch(open, (on) => {
  const opts = { capture: true, passive: true } as const
  if (on) {
    window.addEventListener('scroll', place, opts)
    window.addEventListener('resize', place)
  }
  else {
    window.removeEventListener('scroll', place, opts)
    window.removeEventListener('resize', place)
  }
})
onUnmounted(() => {
  window.removeEventListener('scroll', place, { capture: true })
  window.removeEventListener('resize', place)
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
  nextTick(place)
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

function scrollActiveIntoView() {
  nextTick(() => list.value?.children[active.value]?.scrollIntoView({ block: 'nearest' }))
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value || !matches.value.length) return
  if (e.key === 'ArrowDown') {
    active.value = (active.value + 1) % matches.value.length
    scrollActiveIntoView()
    e.preventDefault()
  }
  else if (e.key === 'ArrowUp') {
    active.value = (active.value - 1 + matches.value.length) % matches.value.length
    scrollActiveIntoView()
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
  <WorkflowModelSelect
    v-else-if="field.input === 'model'"
    v-model="model as string"
    :field="field"
    :disabled="disabled"
  />
  <div
    v-else
    ref="wrap"
    class="relative"
    @focusin="emit('focus')"
  >
    <span
      v-if="field.label"
      class="k-label"
      :style="invalid ? { color: 'var(--accent-orange)' } : undefined"
    >{{ field.label }}<span
      v-if="field.required"
      :class="invalid ? '' : 'text-dimmed'"
    > *</span></span>
    <UTextarea
      v-if="field.input === 'textarea'"
      v-model="model as string"
      :rows="field.rows ?? 3"
      autoresize
      spellcheck="false"
      :disabled="disabled"
      :placeholder="field.placeholder"
      class="w-full"
      :class="compact ? '' : 'mt-1.5'"
      :ui="{ base: 'k-mono text-xs resize-none' + invalidRing }"
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
      class="w-full"
      :class="compact ? '' : 'mt-1.5'"
      :ui="{ base: (compact ? 'k-mono text-xs' : 'k-mono') + invalidRing }"
      @input="field.vars && refreshToken()"
      @click="field.vars && refreshToken()"
      @keydown="onKeydown"
      @blur="close"
    />

    <!-- {{ autocomplete dropdown (teleported: the step card clips overflow) -->
    <Teleport to="body">
      <div
        v-if="open && matches.length"
        ref="list"
        class="fixed z-50 max-h-60 overflow-y-auto rounded-md border border-default bg-(--surface-elevated)"
        :style="{ boxShadow: 'var(--shadow-panel)', top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }"
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
          <span class="k-mono text-xs"><span class="text-dimmed">{{ varPathParts(v.path)[0] }}</span><span :style="{ color: v.color }">{{ varPathParts(v.path)[1] }}</span></span>
          <span class="truncate text-2xs text-dimmed">{{ v.hint }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
