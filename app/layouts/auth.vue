<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-(--surface-base) p-4">
    <KBgField />
    <KLogo class="absolute left-6 top-6 z-10" />
    <div class="relative z-10 w-full max-w-md">
      <slot />
    </div>
  </div>
</template>
