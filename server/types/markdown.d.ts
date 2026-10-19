// Nitro's raw plugin bundles .md imports as strings.
declare module '*.md' {
  const content: string
  export default content
}
