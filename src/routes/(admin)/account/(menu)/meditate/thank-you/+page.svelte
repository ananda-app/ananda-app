<script lang="ts">
  import { goto } from "$app/navigation"
</script>

<svelte:head>
  <title>Meditation Complete</title>
</svelte:head>

<div class="w-full max-w-md">
  <h1 class="text-2xl font-bold mb-6">Meditation Complete</h1>
  <p class="mb-4">
    Great job! You have successfully completed your meditation session.
  </p>
  <button class="btn btn-primary" on:click={() => goto("/account/history")}>
    Check Stats
  </button>
</div>
