// Copy to the clipboard with a fallback for insecure contexts:
// navigator.clipboard only exists on https/localhost, so on a plain-http
// dashboard (dev via lvh.me, an instance before TLS) it is undefined. The
// hidden-textarea execCommand path still works everywhere.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text)
  }
  // When triggered from inside a modal, the dialog's focus trap yanks focus
  // back the moment an element outside it is focused, destroying the selection
  // before execCommand runs. Mount the textarea inside the dialog instead.
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
