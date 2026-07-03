// Branch list for a picker. Reloads (client-side) whenever `url` changes
// (null = nothing to load yet) and always offers the default branch first —
// so the picker works even before/without the remote list.
export function useBranchPicker(
  url: () => string | null,
  defaultBranch: () => string | undefined,
) {
  const branches = ref<string[]>([])
  const loading = ref(false)

  watch(url, async (u) => {
    branches.value = []
    if (!u || import.meta.server) return
    loading.value = true
    try {
      branches.value = await $fetch<string[]>(u)
    }
    catch {
      // List unavailable — the default branch stays the only option.
    }
    finally {
      loading.value = false
    }
  }, { immediate: true })

  const items = computed(() => {
    const def = defaultBranch()
    return [...new Set([...(def ? [def] : []), ...branches.value])]
  })

  return { items, loading }
}
