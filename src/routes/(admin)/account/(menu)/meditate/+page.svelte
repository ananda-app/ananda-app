<script lang="ts">
  import { getContext } from "svelte"
  import type { Writable } from "svelte/store"

  let adminSection: Writable<string> = getContext("adminSection")
  adminSection.set("meditate")
</script>

<svelte:head>
  <title>Meditate</title>
</svelte:head>

<div class="w-full max-w-md">
  <h1 class="text-2xl font-bold mb-6">Meditate</h1>
  <form method="POST" class="form-control">
    <div class="mb-4">
      <label for="duration" class="label">
        <span class="label-text">Duration (minutes)</span>
      </label>
      <input
        id="duration"
        name="duration"
        type="number"
        placeholder="Enter duration in minutes"
        class="input input-bordered w-full"
        required
      />
    </div>

    <div class="mb-4">
      <label for="comments" class="label">
        <span class="label-text">Comments</span>
      </label>
      <textarea
        id="comments"
        name="comments"
        placeholder="Any comments (e.g., your current mood, type of meditation, etc.)"
        class="textarea textarea-bordered w-full"
      ></textarea>
    </div>

    <div>
      <button type="submit" class="btn btn-primary w-full"
        >Start Meditation</button
      >
    </div>
  </form>
</div>
