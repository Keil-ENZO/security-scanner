<script setup lang="ts">
// Nothing to show yet: says why, and what to do next
defineProps<{ title: string }>()
</script>

<template>
  <div class="empty-state">
    <strong>{{ title }}</strong>
    <p><slot /></p>
    <div
      v-if="$slots.action"
      class="empty-action"
    >
      <slot name="action" />
    </div>
  </div>
</template>
