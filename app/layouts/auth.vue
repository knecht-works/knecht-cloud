<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-(--surface-base) p-4">
    <KBgField />
    <div class="relative z-10 w-full max-w-md">
      <slot />
    </div>
  </div>
</template>
