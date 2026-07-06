// Lenient JSON parse: the parsed value, or undefined when the text isn't
// JSON. Callers that also accept non-JSON (http bodies, loop items, model
// answers) branch on undefined instead of try/catching everywhere.
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  }
  catch {
    return undefined
  }
}
