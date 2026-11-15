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
        <!-- Only the last item is the page itself. A middle item can have no link, such as a target without repository -->
        <span
          v-else
          :aria-current="i === items.length - 1 ? 'page' : undefined"
        >{{ item.label }}</span>
      </li>
    </ol>
  </nav>
</template>
