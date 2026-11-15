<script setup lang="ts">
// SQLite sums are NULL when a scan has no findings
defineProps<{ counts: { critical: number | null, high: number | null, medium: number | null, low: number | null, total: number } }>()
</script>

<template>
  <span class="counts">
    <span
      v-if="counts.critical"
      class="count critical"
    >{{ counts.critical }} C</span>
    <span
      v-if="counts.high"
      class="count high"
    >{{ counts.high }} H</span>
    <span
      v-if="counts.medium"
      class="count medium"
    >{{ counts.medium }} M</span>
    <span
      v-if="counts.low"
      class="count low"
    >{{ counts.low }} L</span>
    <span class="muted mono">{{ counts.total }} total</span>
  </span>
</template>
