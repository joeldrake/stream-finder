<script setup lang="ts">
import type { Props } from "./index.server";

defineProps<Props>();
</script>

<template>
  <main>
    <h1>stream-finder</h1>
    <p>{{ titleCount }} titlar i katalogen.</p>
    <ul>
      <li v-for="row in perService" :key="row.service">{{ row.service }}: {{ row.count }}</li>
    </ul>
  </main>
</template>
