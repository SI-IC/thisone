<script setup lang="ts">
import { useCounterStore } from "../stores/counter";

const store = useCounterStore();
</script>

<template>
  <button type="button" @click="store.increment()">
    count is {{ store.count }}
  </button>
</template>

<style scoped>
button {
  appearance: none;
  border: 1px solid #d7dae1;
  border-radius: 10px;
  background: #ffffff;
  color: #16181d;
  font: inherit;
  font-size: 15px;
  padding: 12px 22px;
  box-shadow: 0 1px 2px rgba(16, 18, 24, 0.06);
  cursor: pointer;
}

button:hover {
  border-color: #b9bec9;
}
</style>
