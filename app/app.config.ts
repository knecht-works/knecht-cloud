// md and lg match the button sizes below, so a control and a button of the
// same size are the same height (enforced by knecht-forms/control-row-size).
const controlSizes = {
  md: { base: 'px-3 py-2 text-base/5 gap-2', leadingIcon: 'size-4', trailingIcon: 'size-4', itemLeadingIcon: 'size-4' },
  lg: { base: 'px-3 py-2.5 text-base/5 gap-2' },
}

// A disabled field drops its frame and reads as a fixed value.
const disabledField = {
  base: 'disabled:opacity-100',
  outline: 'disabled:ring-0 disabled:bg-(--surface-glass) disabled:text-muted',
}

const pointer = {
  slots: {
    // Pointer cursor on the trigger and on each option; disabled states still
    // get cursor-not-allowed from the base theme's data-disabled variants.
    base: `cursor-pointer ${disabledField.base}`,
    item: 'cursor-pointer',
  },
  variants: { size: controlSizes, variant: { outline: disabledField.outline } },
}

export default defineAppConfig({
  ui: {
    // Lime "knecht" green is the brand accent; neutral chrome is zinc.
    colors: {
      primary: 'knecht',
      success: 'knecht',
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
            base: 'px-4 py-2 text-sm/5 font-medium',
          },
          lg: {
            base: 'px-5 py-2.5 text-sm/5 font-medium',
          },
        },

      },
      compoundVariants: [
        {
          variant: 'solid',
          class: 'shadow-sm transition-shadow hover:shadow-md',
        },
        { square: true, size: 'md', class: 'p-2' },
        { square: true, size: 'lg', class: 'p-2.5' },
      ],
    },
    input: { slots: { base: disabledField.base }, variants: { size: controlSizes, variant: { outline: disabledField.outline } } },
    textarea: { slots: { base: disabledField.base }, variants: { size: controlSizes, variant: { outline: disabledField.outline } } },
    inputNumber: { slots: { base: disabledField.base }, variants: { size: { md: controlSizes.md.base, lg: controlSizes.lg.base }, variant: { outline: disabledField.outline } } },
    select: pointer,
    selectMenu: {
      ...pointer,
      // Selected items wrap onto more lines instead of being cut off.
      variants: { ...pointer.variants, multiple: { true: { base: 'h-auto' } } },
    },
    modal: {
      slots: { header: 'p-5 sm:pt-6 pe-16 sm:pe-16', body: 'pt-3 sm:pt-5' },
      variants: { overlay: { true: { overlay: 'backdrop-blur-sm' } } },
    },
    formField: {
      variants: {
        orientation: { vertical: { container: 'mt-2' } },
      },
    },
    dropdownMenu: {
      slots: {
        item: 'cursor-pointer',
        itemLeadingIcon: 'self-center',
      },
      variants: {
        size: {
          md: { itemLeadingIcon: 'size-4' },
        },
      },
    },
    breadcrumb: {
      slots: {
        link: 'k-mono text-xs',
      },
      variants: {
        active: {
          true: { link: 'font-normal' },
          false: { link: 'font-normal text-dimmed' },
        },
      },
      compoundVariants: [
        { color: 'neutral', active: true, class: { link: 'text-muted' } },
        { active: false, to: true, class: { link: 'hover:text-muted' } },
      ],
      defaultVariants: {
        color: 'neutral',
      },
    },
  },
})
