<script setup lang="ts">
// In-page confirmation, instead of window.confirm.
// A native <dialog>: the browser handles the focus trap, Escape and the backdrop
withDefaults(defineProps<{ title: string, confirmLabel: string, danger?: boolean }>(), { danger: false })

const el = ref<HTMLDialogElement>()
let settle: ((ok: boolean) => void) | undefined

// Opens the dialog. Resolves true on confirm, false on cancel or Escape
function ask() {
  if (!el.value) return Promise.resolve(false)
  el.value.returnValue = ''
  el.value.showModal()
  return new Promise<boolean>((resolve) => {
    settle = resolve
  })
}

function onClose() {
  settle?.(el.value?.returnValue === 'confirm')
  settle = undefined
}

defineExpose({ ask })
</script>

<template>
  <dialog
    ref="el"
    class="dialog"
    @close="onClose"
  >
    <form method="dialog">
      <h2>{{ title }}</h2>
      <div class="dialog-body">
        <slot />
      </div>
      <div class="dialog-actions">
        <button
          class="ghost"
          value="cancel"
        >
          Cancel
        </button>
        <button
          :class="{ 'danger-fill': danger }"
          value="confirm"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </form>
  </dialog>
</template>
