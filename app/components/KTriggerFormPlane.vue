<script setup lang="ts">
const props = defineProps<{ linkKey: string | null }>()
const config = defineModel<Record<string, unknown>>('config', { required: true })
const valid = defineModel<boolean>('valid', { default: false })

type PlaneEvent = 'created' | 'labeled' | 'transitioned' | 'assigned'

const { data: planeConnection } = useFetch<{ configured: boolean }>('/api/plane/connection', { lazy: true })

const initial = config.value as { event?: PlaneEvent, label?: string, state?: string }
const event = ref<PlaneEvent>(initial.event ?? 'labeled')
const label = ref(initial.label ?? '')
const state = ref(initial.state ?? '')
const labels = ref<string[]>([])
const states = ref<string[]>([])

watch([() => props.linkKey, event], async ([key, ev]) => {
  if (!key || (ev !== 'labeled' && ev !== 'transitioned')) return
  const path = ev === 'labeled' ? '/api/plane/labels' : '/api/plane/states'
  const target = ev === 'labeled' ? labels : states
  try {
    target.value = await $fetch<string[]>(path, { query: { project: key } })
  }
  catch {
    target.value = []
  }
}, { immediate: true })

const looksValid = computed(() =>
  !!planeConnection.value?.configured
  && (event.value === 'labeled' ? !!label.value : event.value === 'transitioned' ? !!state.value : true),
)

watch([event, label, state, looksValid], () => {
  config.value = {
    event: event.value,
    ...(event.value === 'labeled' ? { label: label.value } : {}),
    ...(event.value === 'transitioned' ? { state: state.value } : {}),
  }
  valid.value = looksValid.value
}, { immediate: true })
</script>

<template>
  <div class="space-y-4">
    <p
      v-if="planeConnection && !planeConnection.configured"
      class="rounded-md border border-muted bg-(--surface-muted) px-3 py-2.5 text-2xs leading-normal text-muted"
    >
      Plane is not connected yet. Connect it in
      <NuxtLink
        to="/settings/plane"
        class="text-toned underline underline-offset-2"
      >Settings → Plane</NuxtLink>
      first, register the webhook it shows, then link a project to its Plane project in the project settings.
    </p>

    <template v-else>
      <div>
        <span class="k-label">Fires when</span>
        <USelectMenu
          v-model="event"
          value-key="value"
          :items="[
            { label: 'A work item is created', value: 'created' },
            { label: 'A label is added', value: 'labeled' },
            { label: 'A state is reached', value: 'transitioned' },
            { label: 'The work item is assigned to the Knecht account', value: 'assigned' },
          ]"
          class="mt-2 w-full"
        />
        <USelectMenu
          v-if="event === 'labeled'"
          v-model="label"
          :items="labels"
          :disabled="!linkKey"
          :placeholder="linkKey ? 'Select a label…' : 'Pick a project first'"
          class="mt-2 w-full"
        />
        <USelectMenu
          v-else-if="event === 'transitioned'"
          v-model="state"
          :items="states"
          :disabled="!linkKey"
          :placeholder="linkKey ? 'Select a state…' : 'Pick a project first'"
          class="mt-2 w-full"
        />
        <p
          v-else-if="event === 'assigned'"
          class="mt-2 text-2xs text-dimmed"
        >
          Fires when a work item is assigned to the account the Plane connection uses,
          so "give it to Knecht" is a normal assignment in Plane.
        </p>
      </div>

      <p class="text-2xs text-dimmed">
        Plane sends work item events to the webhook from Settings → Plane; a matching work item starts
        the workflow with the work item as inputs and keeps its session for replies and follow-ups.
      </p>
    </template>
  </div>
</template>
