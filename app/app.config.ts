export default defineAppConfig({
  ui: {
    // Lime "knecht" green is the brand accent; neutral chrome is zinc.
    colors: {
      primary: 'knecht',
      neutral: 'zinc',
    },
    button: {
      slots: {
        base: 'rounded-lg',
      },
      variants: {
        size: {
          md: {
            base: 'px-4 py-2 text-base',
          },
        },
      },
      compoundVariants: [
        {
          variant: 'solid',
          class: 'shadow-sm transition-shadow hover:shadow-md',
        },
      ],
    },
  },
})
