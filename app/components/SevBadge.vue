<script setup lang="ts">
defineProps<{ severity: string }>()
</script>

<template>
  <span :class="['sev', severity]">{{ severity }}</span>
</template>
