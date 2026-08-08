<script lang="ts">
  let { active }: { active: "vue" | "react" | "preact" | "svelte" } = $props();
</script>

<header class="demo-header">
  <nav>
    <a href="/" class={active === "vue" ? "active" : undefined}>Vue</a>
    <a href="/react-demo/" class={active === "react" ? "active" : undefined}>
      React
    </a>
    <a href="/preact-demo/" class={active === "preact" ? "active" : undefined}>
      Preact
    </a>
    <a href="/svelte-demo/" class={active === "svelte" ? "active" : undefined}>
      Svelte
    </a>
  </nav>
</header>
