<script setup lang="ts">
const { user, clear, fetch: refreshSession } = useUserSession()
const toast = useToast()
const toastError = useToastError()

const { data: signIn, refresh: refreshSignIn } = await useFetch('/api/me/sign-in')

async function logout() {
  await clear()
  await navigateTo('/login')
}

const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploading.value = true
  try {
    await $fetch('/api/me/avatar', { method: 'PUT', body: { image: await squareImageDataUrl(file) } })
    await refreshSession()
  }
  catch (e) {
    toastError('Could not upload the picture', e)
  }
  finally {
    uploading.value = false
    fileInput.value!.value = ''
  }
}

const confirmingRemove = ref(false)
const removing = ref(false)
async function removePicture() {
  removing.value = true
  try {
    await $fetch('/api/me/avatar', { method: 'DELETE' })
    await refreshSession()
    confirmingRemove.value = false
  }
  catch (e) {
    toastError('Could not remove the picture', e)
  }
  finally {
    removing.value = false
  }
}

const name = ref(user.value?.name ?? '')
const savingName = ref(false)
const nameChanged = computed(() => name.value.trim() !== (user.value?.name ?? ''))
async function saveName() {
  savingName.value = true
  try {
    await $fetch('/api/me', { method: 'PATCH', body: { name: name.value } })
    await refreshSession()
    name.value = user.value?.name ?? ''
    toast.add({ title: 'Name saved', color: 'success' })
  }
  catch (e) {
    toastError('Could not save the name', e)
  }
  finally {
    savingName.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <KPanel
      title="Profile"
      icon="i-lucide-user-round"
      accent="var(--primary)"
    >
      <template #action>
        <UButton
          label="Sign out"
          icon="i-lucide-log-out"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="logout"
        />
      </template>

      <div class="flex flex-col gap-6">
        <div class="flex items-center gap-4">
          <div class="group relative size-16 flex-none">
            <button
              type="button"
              class="relative size-16 overflow-hidden rounded-full"
              :aria-label="user?.avatarUrl ? 'Change picture' : 'Upload picture'"
              :disabled="uploading"
              @click="fileInput?.click()"
            >
              <UAvatar
                :src="user?.avatarUrl ?? undefined"
                :alt="user?.name || user?.login"
                class="size-16 text-xl"
              />
              <span
                class="absolute inset-0 grid place-items-center bg-black/55 text-white transition-opacity"
                :class="uploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'"
              >
                <UIcon
                  :name="uploading ? 'i-lucide-loader-circle' : 'i-lucide-camera'"
                  class="size-5"
                  :class="{ 'animate-spin': uploading }"
                />
              </span>
            </button>
            <UTooltip
              v-if="user?.avatarUrl && !uploading"
              text="Remove picture"
            >
              <button
                type="button"
                class="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-error text-inverted opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label="Remove picture"
                @click="confirmingRemove = true"
              >
                <UIcon
                  name="i-lucide-x"
                  class="size-3"
                />
              </button>
            </UTooltip>
          </div>
          <div class="min-w-0">
            <div class="truncate text-sm text-highlighted">
              {{ user?.name || user?.login }}
            </div>
            <p class="text-xs text-muted">
              Click the picture to change it. PNG, JPEG or WebP.
            </p>
          </div>
          <input
            ref="fileInput"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            class="hidden"
            @change="upload"
          >
        </div>

        <div class="grid max-w-md gap-5">
          <form @submit.prevent="saveName">
            <UFormField label="Display name">
              <UInput
                v-model="name"
                :placeholder="user?.login"
                class="w-full"
              >
                <template
                  v-if="nameChanged"
                  #trailing
                >
                  <UButton
                    type="submit"
                    label="Save"
                    color="primary"
                    variant="soft"
                    size="xs"
                    :loading="savingName"
                  />
                </template>
              </UInput>
            </UFormField>
          </form>
          <div>
            <div class="text-sm font-medium text-default">
              Username
            </div>
            <div class="k-mono mt-1 text-sm text-muted">
              @{{ user?.login }}
            </div>
          </div>
        </div>
      </div>
    </KPanel>

    <KConfirmModal
      v-model:open="confirmingRemove"
      title="Remove your picture?"
      description="Members see your initials instead. You can upload a new picture any time."
      confirm-label="Remove"
      :loading="removing"
      @confirm="removePicture"
    />

    <KPanel
      title="Sign-in methods"
      icon="i-lucide-key-round"
      accent="var(--primary)"
      :pad="0"
    >
      <KSignInMethods
        v-if="signIn"
        :methods="signIn"
        @changed="refreshSignIn"
      />
    </KPanel>
  </div>
</template>
