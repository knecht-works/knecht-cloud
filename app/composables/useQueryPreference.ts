import type { LocationQueryValue } from 'vue-router'

type QueryValue = LocationQueryValue | LocationQueryValue[] | undefined

interface QueryPreferenceOptions<T> {
  cookie: string
  default: () => T
  // Returns null when the value is missing or invalid, so the cookie applies.
  parse: (value: QueryValue) => T | null
  serialize: (value: T) => string | string[]
}

// The URL wins so shared links reproduce the view; the cookie remembers the last choice when the URL has none.
export function useQueryPreference<T>(key: string, options: QueryPreferenceOptions<T>): Ref<T> {
  const route = useRoute()
  const router = useRouter()
  const cookie = useCookie<string | string[] | null>(options.cookie, { default: () => null })
  const same = (a: T, b: T) => JSON.stringify(options.serialize(a)) === JSON.stringify(options.serialize(b))

  const state = ref(options.parse(route.query[key]) ?? options.parse(cookie.value ?? undefined) ?? options.default()) as Ref<T>

  watch(state, (value) => {
    cookie.value = options.serialize(value)
    router.replace({ query: { ...route.query, [key]: options.serialize(value) } })
  })

  watch(() => route.query[key], (query) => {
    const fromUrl = options.parse(query)
    if (fromUrl !== null && !same(fromUrl, state.value)) state.value = fromUrl
  })

  return state
}

export function oneOf<T extends string>(values: readonly T[]) {
  return (value: QueryValue): T | null => values.find(v => v === value) ?? null
}
