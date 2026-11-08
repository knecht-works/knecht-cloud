const CONTROLS = new Set(['UInput', 'UInputNumber', 'USelect', 'USelectMenu', 'UTextarea', 'KSecretField', 'KCodeInput', 'KPasswordInput'])
const ROW_CONTROLS = new Set(['UInput', 'UInputNumber', 'USelect', 'USelectMenu', 'KSecretField', 'KCodeInput', 'KPasswordInput'])
const THEMED = new Set(['UFormField', 'UInput', 'UInputNumber', 'USelect', 'USelectMenu', 'UTextarea', 'UButton'])
const SPACED = new Set(['UFormField', 'UInput', 'UInputNumber', 'USelect', 'USelectMenu', 'UTextarea', 'KSecretField', 'KCodeInput', 'KPasswordInput'])

const name = el => el.rawName
const attr = (el, key) => el.startTag.attributes.find(a => !a.directive && a.key.name === key)
const bound = (el, key) => el.startTag.attributes.find(a => a.directive && a.key.name.name === 'bind' && a.key.argument?.name === key)
const hasAttr = (el, key) => !!(attr(el, key) || bound(el, key))
const visitor = (context, handlers) => context.sourceCode.parserServices.defineTemplateBodyVisitor(handlers)

function staticSize(el) {
  if (bound(el, 'size')) return null
  return attr(el, 'size')?.value?.value ?? 'md'
}

function classes(el) {
  return (attr(el, 'class')?.value?.value ?? '').split(/\s+/)
}

// A control and a button side by side are only the same height at the same size
// (app.config.ts aligns the size scales of both).
export const controlRowSize = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    return visitor(context, {
      VElement(el) {
        const cls = classes(el)
        const row = cls.includes('flex') && !cls.includes('flex-col')
        if (!row) return
        const kids = el.children.filter(c => c.type === 'VElement')
        const controls = kids.filter(c => ROW_CONTROLS.has(name(c)))
        const buttons = kids.filter(c => name(c) === 'UButton')
        if (!controls.length || !buttons.length) return
        const sizes = controls.map(staticSize).filter(Boolean)
        if (!sizes.length) return
        for (const b of buttons) {
          const size = staticSize(b)
          if (size && !sizes.includes(size)) {
            context.report({ node: b.startTag, message: `This button sits next to a ${sizes[0]} control, give it size="${sizes[0]}".` })
          }
        }
      },
    })
  },
}

// Field labels come from UFormField (or KSettingRow on settings pages), so they look the same everywhere.
export const labeledControl = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    return visitor(context, {
      VElement(el) {
        if (!CONTROLS.has(name(el))) return
        if (hasAttr(el, 'aria-label') || hasAttr(el, 'aria-labelledby')) return
        for (let p = el.parent; p && p.type === 'VElement'; p = p.parent) {
          if (name(p) === 'UFormField' || name(p) === 'KSettingRow') return
        }
        context.report({ node: el.startTag, message: 'Label this control with a UFormField, or give it an aria-label when it has no visible label.' })
      },
    })
  },
}

// Form components look the same everywhere: their theme lives in app.config.ts
// (or in one K field component), never in a per-use `ui` or margin.
export const themedOnly = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    return visitor(context, {
      VElement(el) {
        if (THEMED.has(name(el)) && hasAttr(el, 'ui')) {
          context.report({ node: el.startTag, message: `Style ${name(el)} in app.config.ts or a K field component, not with ui.` })
        }
        if (SPACED.has(name(el)) && classes(el).some(c => /^(?:[a-z0-9]+:)*-?m[trblxyse]?-/.test(c))) {
          context.report({ node: el.startTag, message: `Space ${name(el)} from its container (gap, UFormField), not with a margin.` })
        }
      },
    })
  },
}

// Fields use the default size; only the compact editors (turned off for them in
// eslint.config.mjs) pick a smaller one.
export const defaultControlSize = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    return visitor(context, {
      VElement(el) {
        if (CONTROLS.has(name(el)) && hasAttr(el, 'size')) {
          context.report({ node: el.startTag, message: `Leave ${name(el)} at the default size; only the compact editors set one.` })
        }
      },
    })
  },
}
