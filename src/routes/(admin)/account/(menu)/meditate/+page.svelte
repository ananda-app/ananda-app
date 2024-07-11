<script lang="ts">
  import { getContext } from "svelte"
  import { enhance } from "$app/forms"
  import { page } from "$app/stores"
  import type { Writable } from "svelte/store"
  import type { ActionResult } from "@sveltejs/kit"
  import BiometricsMonitor from "./BiometricsMonitor.svelte"
  import { onMount, onDestroy } from "svelte"

  let adminSection: Writable<string> = getContext("adminSection")
  adminSection.set("meditate")

  let isMeditating = false
  let error = ""
  let meditationId: string | null = null
  let socket: WebSocket
  let audio: HTMLAudioElement

  $: showMonitor = isMeditating

  onMount(() => {
    socket = new WebSocket("ws://localhost:3001")

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === "instruction" && data.meditationId === meditationId) {
        playInstruction(data.audio)
      }
    }
  })

  onDestroy(() => {
    if (socket) {
      socket.close()
    }
  })

  function playInstruction(base64Audio: string) {
    const blob = new Blob(
      [Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0))],
      { type: "audio/mpeg" },
    )
    const url = URL.createObjectURL(blob)
    audio.src = url
    audio.play()
  }

  function handleResult(result: ActionResult) {
    if (result.type === "success") {
      isMeditating = true
      meditationId = result.data?.meditationId ?? null
    } else if (result.type === "failure") {
      error = result.data?.error || "An error occurred"
    }
  }

  async function stopMeditation() {
    if (meditationId) {
      try {
        const formData = new FormData()
        formData.append("meditationId", meditationId)

        const response = await fetch("?/stop", {
          method: "POST",
          body: formData,
        })
        const result = await response.json()
        if (result.type === "success") {
          isMeditating = false
          meditationId = null
        } else {
          error = result.error || "Failed to stop meditation"
        }
      } catch (err) {
        console.error("Error stopping meditation:", err)
        error = "An error occurred while stopping the meditation"
      }
    }
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
              <option value="loving_kindness">Loving Kindness</option>
              <option value="breath_focus">Breath Focus</option>
              <option value="body_scan">Body Scan</option>
            </select>
          </div>

          <div class="mb-4">
            <label for="comments" class="label">
              <span class="label-text">Comments</span>
            </label>
            <textarea
              id="comments"
              name="comments"
              placeholder="E.g., your current mood, goals, substances..."
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
    {:else}
      {#if showMonitor}
        <BiometricsMonitor currentRoute={$page.url.pathname} {meditationId} />
      {/if}
      <div class="w-full flex mt-4">
        <button class="btn btn-error" on:click={stopMeditation}>
          Stop Meditation
        </button>
      </div>
    {/if}
  </div>
</div>

<audio bind:this={audio}></audio>
