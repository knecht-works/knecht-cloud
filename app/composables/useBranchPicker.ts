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
      // Remote list unavailable: the default branch stays the only option.
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
