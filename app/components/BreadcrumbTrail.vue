<script setup lang="ts">
// Where the page sits: Targets / Shop / security/fix-12. The last item is the page itself
defineProps<{ items: { label: string, to?: string }[] }>()
</script>

<template>
  <nav
    class="breadcrumb"
    aria-label="Breadcrumb"
  >
    <ol>
      <li
        v-for="(item, i) in items"
        :key="i"
      >
        <NuxtLink
          v-if="item.to"
          :to="item.to"
        >{{ item.label }}</NuxtLink>
        <span
          v-else
          aria-current="page"
        >{{ item.label }}</span>
      </li>
    </ol>
  </nav>
</template>
