<script setup lang="ts">
const config = defineModel<Record<string, unknown>>('config', { required: true })
const valid = defineModel<boolean>('valid', { default: false })

type GithubEvent = 'pull_request' | 'issues'
type IssueAction = 'opened' | 'labeled'

const initial = config.value as { event?: GithubEvent, branches?: string[], issueActions?: IssueAction[], issueLabel?: string | null }
const githubEvent = ref<GithubEvent>(initial.event ?? 'pull_request')
const branchFilter = ref((initial.branches ?? []).join(', '))
const issueOpened = ref((initial.issueActions ?? ['opened']).includes('opened'))
const issueLabeled = ref((initial.issueActions ?? []).includes('labeled'))
const issueLabel = ref(initial.issueLabel ?? '')

function parsedBranches(): string[] {
  return branchFilter.value.split(',').map(b => b.trim()).filter(Boolean)
}

function issueActions(): IssueAction[] {
  return [
    ...(issueOpened.value ? ['opened'] as const : []),
    ...(issueLabeled.value ? ['labeled'] as const : []),
  ]
}

const issuesLookValid = computed(() =>
  githubEvent.value !== 'issues'
  || (issueActions().length > 0 && (!issueLabeled.value || !!issueLabel.value.trim())),
)

watch([githubEvent, branchFilter, issueOpened, issueLabeled, issueLabel], () => {
  config.value = {
    event: githubEvent.value,
    branches: parsedBranches(),
    issueActions: issueActions(),
    issueLabel: issueLabeled.value ? issueLabel.value.trim() : null,
  }
  valid.value = issuesLookValid.value
}, { immediate: true })
</script>

<template>
  <div class="space-y-4">
    <div>
      <span class="k-label">GitHub event</span>
      <USelectMenu
        v-model="githubEvent"
        value-key="value"
        :items="[
          { label: 'Pull request', value: 'pull_request' },
          { label: 'Issues', value: 'issues' },
        ]"
        class="mt-2 w-full"
      />
    </div>

    <div v-if="githubEvent === 'pull_request'">
      <span class="k-label">Base branches</span>
      <UInput
        v-model="branchFilter"
        placeholder="main, staging"
        class="mt-2 w-full"
        :ui="{ base: 'k-mono' }"
      />
      <p class="mt-2 text-2xs text-dimmed">
        Fires when a pull request targeting one of these branches is opened or pushed to. Comma-separated, empty = every branch.
      </p>
    </div>

    <div v-else>
      <span class="k-label">Fires when</span>
      <div class="mt-2 space-y-2">
        <UCheckbox
          v-model="issueOpened"
          label="An issue is opened"
        />
        <UCheckbox
          v-model="issueLabeled"
          label="A label is added"
        />
        <UInput
          v-if="issueLabeled"
          v-model="issueLabel"
          placeholder="Label name, e.g. knecht"
          class="w-full"
          :ui="{ base: 'k-mono' }"
        />
      </div>
      <p
        v-if="!issuesLookValid"
        class="mt-2 text-2xs text-error"
      >
        {{ issueLabeled && !issueLabel.trim()
          ? 'Name the label that fires the trigger.'
          : 'Pick at least one issue event.' }}
      </p>
    </div>

    <p class="text-2xs text-dimmed">
      Events arrive via the GitHub App webhook (see Settings); no per-repo setup needed.
    </p>
  </div>
</template>
