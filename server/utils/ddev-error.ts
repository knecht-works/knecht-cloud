// ddev prints its usage text after the error, so the last stderr line is a flag description.
export function ddevErrorLine(stderr: string): string {
  const lines = stderr.trim().split('\n')
  const rejected = lines.find(line => /^ERROR \d+/.test(line))
  if (rejected) return rejected
  const error = lines.findLast(line => line.startsWith('Error: '))
  return error ? error.slice('Error: '.length) : lines.at(-1) ?? ''
}
