<script setup lang="ts">
defineProps<{ active: "vue" | "react" | "preact" | "svelte" }>();
</script>

<template>
  <header class="demo-header">
    <nav>
      <a href="/" :class="{ active: active === 'vue' }">Vue</a>
      <a href="/react-demo/" :class="{ active: active === 'react' }">React</a>
      <a href="/preact-demo/" :class="{ active: active === 'preact' }"
        >Preact</a
      >
      <a href="/svelte-demo/" :class="{ active: active === 'svelte' }"
        >Svelte</a
      >
    </nav>
  </header>
</template>

<style>
.demo-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  padding: 12px;
  background: #fff;
  border-bottom: 1px solid #e2e4e9;
}

.demo-header nav {
  display: flex;
  gap: 8px;
}

.demo-header a {
  padding: 6px 14px;
  border-radius: 6px;
  color: #4b5165;
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
}

.demo-header a.active {
  background: #16181d;
  color: #fff;
}
</style>
