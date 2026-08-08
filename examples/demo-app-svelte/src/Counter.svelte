<script lang="ts">
  let count = $state(0);
</script>

<button id="counter-btn" onclick={() => (count += 1)}>count is {count}</button>
