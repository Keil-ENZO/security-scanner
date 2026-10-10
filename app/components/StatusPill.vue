<script setup lang="ts">
defineProps<{ status: string }>()
</script>

<template>
  <span :class="['status', status]"><i />{{ STATUS_LABEL[status] ?? status }}</span>
</template>
