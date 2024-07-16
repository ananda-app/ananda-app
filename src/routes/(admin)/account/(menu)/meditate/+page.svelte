<script lang="ts">
  import { getContext, onDestroy } from "svelte"
  import { enhance } from "$app/forms"
  import type { Writable } from "svelte/store"
  import type { ActionResult } from "@sveltejs/kit"
  import BiometricsMonitor from "./BiometricsMonitor.svelte"
  import type { RealtimeChannel } from "@supabase/supabase-js"

  let adminSection: Writable<string> = getContext("adminSection")
  adminSection.set("meditate")

  export let data
  let { supabase } = data

  let isMeditating = false
  let error = ""
  let meditationId: string | null = null
  let audio: HTMLAudioElement
  let channel: RealtimeChannel

  $: showMonitor = isMeditating

  async function fetchAudio(instructionId: string) {
    const response = await fetch(`/account/meditate/audio?id=${instructionId}`)
    if (!response.ok) throw new Error("Failed to fetch audio")
    const blob = await response.blob()
    return URL.createObjectURL(blob)
  }

  function playAudio(audioUrl: string) {
    if (audio) {
      audio.src = audioUrl
      audio.play()
    }
  }

  onDestroy(() => {
    if (channel) {
      channel.unsubscribe()
    }
  })

  function subscribeToDbChanges() {
    try {
      channel = supabase
        .channel("schema-db-changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
          },
          async (payload: any) => {
            console.log(payload)
            if (payload.table === "meditation_instructions") {
              if (
                payload.new &&
                payload.new.id &&
                payload.new.meditation_id === meditationId
              ) {
                try {
                  console.log(`instruction: ${payload.new.instruction}`)
                  const audioUrl = await fetchAudio(payload.new.id)
                  playAudio(audioUrl)
                } catch (error) {
                  console.error("Failed to fetch or play audio:", error)
                }
              }
            } else if (payload.table === "meditation_sessions") {
              if (
                payload.new.end_ts !== null &&
                payload.new.id === meditationId
              ) {
                console.log(`stopping meditation ${meditationId}`)
                isMeditating = false
                meditationId = null
              }
            }
          },
        )
        .subscribe()
    } catch (error) {
      console.error("Failed to subscribe to db changes:", error)
    }
  }

  function handleResult(result: ActionResult) {
    if (result.type === "success") {
      isMeditating = true
      meditationId = result.data?.meditationId ?? null
      subscribeToDbChanges()
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
        <BiometricsMonitor {meditationId} {supabase} />
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
