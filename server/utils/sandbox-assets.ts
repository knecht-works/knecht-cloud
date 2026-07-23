// The bundled sandbox assets (the repo's ../sandbox dir, wired up as nitro
// serverAssets in nuxt.config.ts). Always go through getItemRaw here: in dev
// the fs driver returns a string, but in the prod bundle the inline asset
// driver returns a Uint8Array, which getItem() + String() would render as a
// comma-joined byte list instead of the file's content. This helper is the
// only supported way to read a sandbox asset.
export async function readSandboxAsset(name: string): Promise<Buffer | null> {
  const content = await useStorage('assets:sandbox').getItemRaw(name)
  if (content === null || content === undefined) return null
  return Buffer.isBuffer(content) ? content : Buffer.from(content as Uint8Array | string)
}
