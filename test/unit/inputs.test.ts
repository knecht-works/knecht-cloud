import { describe, expect, it } from 'vitest'
import { emptyInputs, INPUT_KEYS } from '../../server/utils/inputs'

describe('emptyInputs', () => {
  it('has every key, empty except the event', () => {
    const inputs = emptyInputs('schedule')
    expect(Object.keys(inputs).sort()).toEqual([...INPUT_KEYS].sort())
    expect(inputs.event).toBe('schedule')
    expect(Object.entries(inputs).filter(([k]) => k !== 'event').every(([, v]) => v === '')).toBe(true)
  })
})
