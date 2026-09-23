const pointer = {
  slots: {
    // Pointer cursor on the trigger and on each option; disabled states still
    // get cursor-not-allowed from the base theme's data-disabled variants.
    base: 'cursor-pointer',
    item: 'cursor-pointer',
  },
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
      ],
    },
    select: pointer,
    selectMenu: pointer,
    dropdownMenu: {
      slots: {
        item: 'cursor-pointer',
      },
    },
  },
})
