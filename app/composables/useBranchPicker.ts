import { ref, watch, computed } from 'vue'
import { $fetch } from '#imports'

// Several URLs list the branches all of them have.
export function useBranchPicker(
  url: () => string | string[] | null,
  defaultBranch: () => string | undefined,
) {
  const branches = ref<string[]>([])
  const loading = ref(false)

  watch(url, async (u, _, onCleanup) => {
    branches.value = []
    loading.value = false
    const urls = !u ? [] : Array.isArray(u) ? u : [u]
    if (!urls.length || import.meta.server) return
    let stale = false
    onCleanup(() => stale = true)
    loading.value = true
    try {
      const lists = await Promise.all(urls.map(each => $fetch<string[]>(each)))
      if (!stale) branches.value = lists.reduce((common, list) => common.filter(b => list.includes(b)))
    }
    catch {
      // Remote list unavailable: the default branch stays the only option.
    }
    finally {
      if (!stale) loading.value = false
    }
  }, { immediate: true })

  const items = computed(() => {
    const def = defaultBranch()
    return [...new Set([...(def ? [def] : []), ...branches.value])]
  })

  return { items, loading }
}
