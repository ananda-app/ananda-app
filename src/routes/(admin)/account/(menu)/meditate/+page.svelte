<script lang="ts">
  import { getContext } from "svelte"
  import { enhance } from "$app/forms"
  import type { Writable } from "svelte/store"
  import type { ActionResult } from "@sveltejs/kit"
  import HeartbeatMonitor from "./HeartbeatMonitor.svelte"

  let adminSection: Writable<string> = getContext("adminSection")
  adminSection.set("meditate")

  let showMonitor = false
  let error = ""

  function handleResult(result: ActionResult) {
    if (result.type === "success") {
      showMonitor = true
    } else if (result.type === "failure") {
      error = result.data?.error || "An error occurred"
    }
  }
</script>

<svelte:head>
  <title>Meditate</title>
</svelte:head>

<div class="w-full max-w-md">
  <div class="">
    <h1 class="text-2xl font-bold text-gray-800 mb-4">Meditate</h1>
    {#if !showMonitor}
      <p class="text-gray-600 mb-6">
        Please enter how long you want to meditate and any comments you have
        about your current mood, technique to follow, or anything else you'd
        like to note.
      </p>
      {#if error}
        <p class="text-red-500 mb-4">{error}</p>
      {/if}
      <form
        method="POST"
        use:enhance={() => {
          return ({ result }) => {
            handleResult(result)
          }
        }}
        class="form-control"
      >
        <div class="mb-4">
          <label for="duration" class="label">
            <span class="label-text">Duration (minutes)</span>
          </label>
          <input
            id="duration"
            name="duration"
            type="number"
            value="10"
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
            placeholder="Any comments (e.g., your current mood, technique, goals, etc.)"
            class="textarea textarea-bordered w-full"
          ></textarea>
        </div>

        <div>
          <button type="submit" class="btn btn-primary w-full">
            Start Meditation
          </button>
        </div>
      </form>
    {:else}
      <HeartbeatMonitor />
    {/if}
  </div>
</div>
