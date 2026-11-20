const MCP_ICONS: Record<string, string> = {
  sentry: 'i-simple-icons-sentry',
  context7: 'i-vscode-icons-file-type-context7',
  notion: 'i-logos-notion-icon',
  cloudflare: 'i-logos-cloudflare-icon',
}

export function mcpIcon(catalogId: string | null): string {
  return (catalogId && MCP_ICONS[catalogId]) || 'i-lucide-globe'
}

// Sentry's colored logo is dark purple and disappears on a dark background, so it keeps the tinted glyph.
export function mcpIconColor(catalogId: string | null): string {
  return catalogId === 'sentry' ? 'text-[#8d6bff]' : 'text-highlighted'
}
