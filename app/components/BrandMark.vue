<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 24 })
</script>

<!-- Decorative: the name is always written next to it. A plain image, so no v-html and one source file -->
<template>
  <img
    class="mark"
    src="/logo.svg"
    alt=""
    aria-hidden="true"
    :width="size"
    :height="size"
  >
</template>

<style scoped>
.mark { display: block; flex: none; }
</style>
