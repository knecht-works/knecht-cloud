// Focus on select triggers (buttons) is signalled by the global
// outline rule in main.css. They would otherwise ALSO swap their
// inset hairline to a 2px primary ring; keep the resting one.
const keepRestingRing = {
  compoundVariants: [
    {
      color: 'primary' as const,
      variant: 'outline' as const,
      class: 'focus-visible:ring focus-visible:ring-accented',
    },
  ],
}

export default defineAppConfig({
  ui: {
    // Lime "knecht" green is the brand accent; neutral chrome is zinc.
    colors: {
      primary: 'knecht',
      neutral: 'zinc',
    },
    button: {
      slots: {
        // `cursor-pointer` for every button; the disabled: variants in the base
        // theme still win for disabled/aria-disabled buttons (cursor-not-allowed).
        base: 'rounded-lg cursor-pointer',
      },
      variants: {
        size: {
          md: {
            base: 'px-5 py-2.5 text-sm font-medium',
          },
        },

      },
      compoundVariants: [
        {
          variant: 'solid',
          class: 'shadow-sm transition-shadow hover:shadow-md',
        },
        // Same idea as keepRestingRing: the global outline marks focus,
        // so outline/subtle buttons keep their resting ring instead of
        // thickening it to a 2px primary ring.
        { color: 'primary', variant: 'outline', class: 'focus-visible:ring focus-visible:ring-primary/50' },
        { color: 'error', variant: 'outline', class: 'focus-visible:ring focus-visible:ring-error/50' },
        { color: 'neutral', variant: 'outline', class: 'focus-visible:ring focus-visible:ring-accented' },
        { color: 'primary', variant: 'subtle', class: 'focus-visible:ring focus-visible:ring-primary/25' },
        { color: 'error', variant: 'subtle', class: 'focus-visible:ring focus-visible:ring-error/25' },
        { color: 'neutral', variant: 'subtle', class: 'focus-visible:ring focus-visible:ring-accented' },
      ],
    },
    select: keepRestingRing,
    selectMenu: keepRestingRing,
  },
})
