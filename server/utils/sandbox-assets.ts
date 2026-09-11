// getItemRaw, not getItem: the prod inline asset driver returns a Uint8Array,
// which String() would render as a comma-joined byte list.
export async function readSandboxAsset(name: string): Promise<Buffer | null> {
  const content = await useStorage('assets:sandbox').getItemRaw(name)
  if (content === null || content === undefined) return null
  return Buffer.isBuffer(content) ? content : Buffer.from(content as Uint8Array | string)
}
