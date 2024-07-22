<script lang="ts">
  import { enhance } from "$app/forms"
  import { goto } from "$app/navigation"
  import type { ActionResult } from "@sveltejs/kit"
  import { formatTechnique } from "$lib/formatUtils"

  export let data
  let { supabase } = data

  let error = ""

  function handleResult(result: ActionResult) {
    if (result.type === "success") {
      if (result.data && result.data.redirect) {
        goto(result.data.redirect)
      }
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
    <h1 class="text-2xl font-bold mb-6">Meditate</h1>
    <p class="text-gray-600 mb-6">
      Please enter the details below to start. Ensure that you are in a well
      lighted area and your face is clearly visible.
    </p>
    {#if error}
      <p class="text-red-500 mb-4">{error}</p>
    {/if}
    <form
      method="POST"
      action="?/start"
      use:enhance={() => {
        return ({ result }) => {
          handleResult(result)
        }
      }}
      class="form-control"
    >
      <div class="mb-4">
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
          <label for="technique" class="label">
            <span class="label-text">Technique</span>
          </label>
          <select
            id="technique"
            name="technique"
            class="select select-bordered w-full"
            required
          >
            <option value="loving_kindness"
              >{formatTechnique("loving_kindness")}</option
            >
            <option value="breath_focus"
              >{formatTechnique("breath_focus")}</option
            >
            <option value="body_scan">{formatTechnique("body_scan")}</option>
          </select>
        </div>

        <div class="mb-4">
          <label for="comments" class="label">
            <span class="label-text">Comments</span>
          </label>
          <textarea
            id="comments"
            name="comments"
            placeholder="E.g., your current mood, goals, favorite teacher, etc."
            class="textarea textarea-bordered w-full"
          ></textarea>
        </div>

        <div>
          <button type="submit" class="btn btn-primary w-full">
            Start Meditation
          </button>
        </div>
      </div>
    </form>
  </div>
</div>
