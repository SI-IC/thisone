<script setup lang="ts">
import { useCounterStore } from "../stores/counter";

const store = useCounterStore();
</script>

<template>
  <button type="button" @click="store.increment()">
    count is {{ store.count }}
  </button>
</template>
