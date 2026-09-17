<script setup lang="ts">
const SIZE = 4
const DOT = 2
const GAP = 2
const TOTAL = SIZE * SIZE

const PATTERNS = [
  [[0], [1], [2], [3], [7], [11], [15], [14], [13], [12], [8], [4], [5], [6], [10], [9]],
  [[0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15]],
  [[5, 6, 9, 10], [1, 4, 7, 8, 11, 14], [0, 3, 12, 15], [1, 4, 7, 8, 11, 14], [5, 6, 9, 10]],
  [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]],
  [[0], [3], [15], [12]],
  [[5, 6, 9, 10], [1, 2, 4, 7, 8, 11, 13, 14], [0, 3, 12, 15]],
  [[0], [1], [2], [3], [7], [6], [5], [4], [8], [9], [10], [11], [15], [14], [13], [12]],
  [[0], [1, 4], [2, 5, 8], [3, 6, 9, 12], [7, 10, 13], [11, 14], [15]],
]

const STATUS = [
  'Working on it',
  'Reading the project',
  'Thinking it through',
  'Running tools',
  'Checking the result',
]
const CHARS = 'abcdefghijklmnopqrstuvwxyz'

const activeDots = ref<Set<number>>(new Set())
let patternIndex = 0
let stepIndex = 0

function nextStep() {
  const pattern = PATTERNS[patternIndex]!
  activeDots.value = new Set(pattern[stepIndex])
  stepIndex++
  if (stepIndex >= pattern.length) {
    stepIndex = 0
    patternIndex = (patternIndex + 1) % PATTERNS.length
  }
}

const statusIndex = ref(0)
const text = ref(STATUS[0]!)

function scramble(from: string, to: string) {
  const length = Math.max(from.length, to.length)
  const frames = 15
  let frame = 0
  const step = () => {
    frame++
    const progress = (frame / frames) * length
    let out = ''
    for (let i = 0; i < length; i++) {
      if (i < progress - 2) out += to[i] ?? ''
      else if (i < progress) out += CHARS[Math.floor(Math.random() * CHARS.length)]
      else out += from[i] ?? ''
    }
    text.value = frame < frames ? out : to
    if (frame < frames) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

let dotsTimer: ReturnType<typeof setInterval> | undefined
let textTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  nextStep()
  dotsTimer = setInterval(nextStep, 120)
  textTimer = setInterval(() => {
    const previous = text.value
    statusIndex.value = (statusIndex.value + 1) % STATUS.length
    scramble(previous, STATUS[statusIndex.value]!)
  }, 3500)
})
onUnmounted(() => {
  clearInterval(dotsTimer)
  clearInterval(textTimer)
})
</script>

<template>
  <div class="flex h-6 items-center overflow-hidden text-sm text-muted">
    <div
      class="mr-2 grid shrink-0"
      :style="{
        gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
        gap: `${GAP}px`,
        width: `${SIZE * DOT + (SIZE - 1) * GAP}px`,
        height: `${SIZE * DOT + (SIZE - 1) * GAP}px`,
      }"
    >
      <span
        v-for="i in TOTAL"
        :key="i"
        class="rounded-[0.5px] bg-current transition-opacity duration-100"
        :class="activeDots.has(i - 1) ? 'opacity-100' : 'opacity-20'"
        :style="{ width: `${DOT}px`, height: `${DOT}px` }"
      />
    </div>
    <UChatShimmer :text="text" />
  </div>
</template>
