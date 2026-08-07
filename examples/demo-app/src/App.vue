<script setup lang="ts">
import Counter from "./components/Counter.vue";
</script>

<template>
  <main>
    <h1>thisone demo</h1>
    <Counter />
  </main>
</template>

<style>
:root {
  color-scheme: light;
  font-family:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

body {
  margin: 0;
  background: #f5f6f8;
  color: #16181d;
}

main {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

h1 {
  margin: 0;
  font-size: 34px;
  font-weight: 650;
  letter-spacing: -0.02em;
}
</style>
