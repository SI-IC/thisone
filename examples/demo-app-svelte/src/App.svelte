<script lang="ts">
  import DemoHeader from "./DemoHeader.svelte";
  import Panel from "./Panel.svelte";
  import "./app.css";

  let showPanel = true;
</script>

<DemoHeader active="svelte" />
<main>
  <h1>thisone svelte demo</h1>
  {#if showPanel}
    <Panel />
  {/if}
</main>
