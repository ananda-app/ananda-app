<script lang="ts">
  import { goto } from "$app/navigation"
</script>

<svelte:head>
  <title>Meditation Error</title>
</svelte:head>

<div class="w-full max-w-md">
  <h1 class="text-2xl font-bold mb-6">Oops! Something went wrong</h1>
  <p class="mb-4">
    We encountered an error during your meditation session. We apologize for the
    inconvenience.
  </p>
  <button class="btn btn-primary" on:click={() => goto("/account/meditate")}>
    Try Again
  </button>
</div>
