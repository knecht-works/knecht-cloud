// Copy to the clipboard with a fallback for insecure contexts:
// navigator.clipboard only exists on https/localhost, so on a plain-http
// dashboard (dev via lvh.me, an instance before TLS) it is undefined. The
// hidden-textarea execCommand path still works everywhere.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text)
  }
  const el = document.createElement('textarea')
  el.value = text
  el.style.position = 'fixed'
  el.style.opacity = '0'
  document.body.appendChild(el)
  el.select()
  try {
    document.execCommand('copy')
  }
  finally {
    el.remove()
  }
}
