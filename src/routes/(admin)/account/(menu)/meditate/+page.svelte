<script lang="ts">
  import { getContext } from "svelte"
  import { enhance } from "$app/forms"
  import type { Writable } from "svelte/store"
  import type { ActionResult } from "@sveltejs/kit"
  import BiometricsMonitor from "./BiometricsMonitor.svelte"

  let adminSection: Writable<string> = getContext("adminSection")
  adminSection.set("meditate")

  let isMeditating = false
  let error = ""

  $: showMonitor = isMeditating

  function handleResult(result: ActionResult) {
    if (result.type === "success") {
      isMeditating = true
    } else if (result.type === "failure") {
      error = result.data?.error || "An error occurred"
    }
  }

  function stopMeditation() {
    isMeditating = false
  }
</script>

<svelte:head>
  <title>Meditate</title>
</svelte:head>

<div class="w-full max-w-md">
  <div class="">
    <h1 class="text-2xl font-bold text-gray-800 mb-4">Meditate</h1>
    {#if !isMeditating}
      <p class="text-gray-600 mb-6">
        Please enter the details below to start. Ensure that you are in a well
        lighted area and your face is cleartly visible.
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
      {#if showMonitor}
        <BiometricsMonitor />
      {/if}
      <div class="w-full flex mt-4">
        <button class="btn btn-error" on:click={stopMeditation}>
          Stop Meditation
        </button>
      </div>
    {/if}
  </div>
</div>
