interface BodyNode {
  type?: string
  attrs?: { id?: string }
  content?: BodyNode[]
}

function mentionIds(node: BodyNode): string[] {
  const own = /mention/i.test(node.type ?? '') && node.attrs?.id ? [node.attrs.id] : []
  return [...own, ...(node.content ?? []).flatMap(mentionIds)]
}

// The markdown body only carries the display name; the user id of a mention is in the editor document.
export function bodyDataMentionIds(bodyData: string | null | undefined): string[] {
  if (!bodyData) return []
  try {
    return mentionIds(JSON.parse(bodyData) as BodyNode)
  }
  catch {
    return []
  }
}
