// navigator.clipboard is undefined on plain http (dev via lvh.me, an instance
// before TLS); the hidden-textarea execCommand path works everywhere.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text)
  }
  // Inside a modal the focus trap yanks focus back from an outside element,
  // destroying the selection before execCommand runs.
  const host = document.activeElement?.closest('[role="dialog"]') ?? document.body
  const el = document.createElement('textarea')
  el.value = text
  el.style.position = 'fixed'
  el.style.opacity = '0'
  host.appendChild(el)
  el.select()
  try {
    if (!document.execCommand('copy')) throw new Error('execCommand("copy") returned false')
  }
  finally {
    el.remove()
  }
}
