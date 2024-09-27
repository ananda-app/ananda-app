<script lang="ts">
  import { onMount, onDestroy } from "svelte"
  import { goto } from "$app/navigation"
  import { page } from "$app/stores"
  import BiometricsMonitor from "./BiometricsMonitor.svelte"

  export let data
  let { supabase } = data

  $: meditationId = Number($page.url.searchParams.get("id"))

  let currentAudioPromise: Promise<void> | null = null
  let wakeLock: WakeLockSentinel | null = null
  let pollingInterval: ReturnType<typeof setInterval> | null = null

  async function requestWakeLock() {
    try {
      wakeLock = await navigator.wakeLock.request("screen")
      console.log("Wake Lock is active")
    } catch (err) {
      console.error(`Failed to request Wake Lock:`, err)
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().then(() => {
        wakeLock = null
        console.log("Wake Lock released")
      })
    }
  }

  async function pollInstructions() {
    try {
      const response = await fetch("/account/meditate/instruction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ meditationId }),
      })

      const result = await response.json()

      if (result.type === "success") {
        const { instruction, audioBase64, instructionId, timeLeft } =
          result.data

        console.log(`[${meditationId}] [${timeLeft}]: ${instruction}`)

        // Convert base64 to ArrayBuffer
        const binaryString = atob(audioBase64)
        const len = binaryString.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const buffer = bytes.buffer

        // Play the audio
        await playAudio(buffer, instruction, instructionId)

        // Check if the meditation session should end
        if (timeLeft <= 0) {
          console.log(
            `Ending session as time left (${timeLeft} seconds) is over`,
          )
          await stopMeditation() // This will update the database and call endMeditation
          return
        }
      } else if (result.type === "error") {
        console.error("Instruction generation failed:", result.data.error)
        if (result.data.redirect) {
          goto(result.data.redirect)
        } else {
          goto("/account/meditate/oops")
        }
      }
    } catch (error) {
      console.error("Network or parsing error:", error)
      goto("/account/meditate/oops")
    }
  }

  async function playAudio(
    audioBuffer: ArrayBuffer,
    instruction: string,
    instructionId: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const blob = new Blob([audioBuffer], { type: "audio/mp3" })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)

      audio.onended = async () => {
        URL.revokeObjectURL(url)
        await updatePlayTimestamp(instructionId)
        resolve()
      }

      audio.onerror = (err) => {
        console.error("Error playing audio:", err)
        URL.revokeObjectURL(url)
        reject(err)
      }

      audio.play().catch((error) => {
        console.error("Error starting audio playback:", error)
        URL.revokeObjectURL(url)
        reject(error)
      })
    })
  }

  async function updatePlayTimestamp(instructionId: number) {
    try {
      const { error } = await supabase
        .from("meditation_instructions")
        .update({ play_ts: new Date().toISOString() })
        .eq("id", instructionId)

      if (error) {
        console.error("Error updating play_ts:", error)
      }
    } catch (error) {
      console.error("Failed to update play_ts:", error)
    }
  }

  async function stopMeditation() {
    try {
      const { error } = await supabase
        .from("meditation_sessions")
        .update({ end_ts: new Date().toISOString() })
        .eq("id", meditationId)

      if (error) {
        console.error("Error updating meditation session:", error)
        throw error
      }

      console.log(`Successfully stopped meditation ${meditationId}`)
      endMeditation()
    } catch (err) {
      console.error("Error stopping meditation:", err)
      goto("/account/meditate/oops")
    }
  }

  function endMeditation() {
    releaseWakeLock()
    goto(`/account/meditate/thank-you?id=${meditationId}`)
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    stopMeditation()
    event.preventDefault()
  }

  onMount(() => {
    requestWakeLock()
    pollInstructions()
    pollingInterval = setInterval(pollInstructions, 60000)
    window.addEventListener("beforeunload", handleBeforeUnload)
  })

  onDestroy(() => {
    window.removeEventListener("beforeunload", handleBeforeUnload)
    stopMeditation()
    releaseWakeLock()
    if (pollingInterval) clearInterval(pollingInterval)
  })
</script>

<svelte:head>
  <title>Meditation Biometrics</title>
</svelte:head>

<div class="w-full max-w-md">
  <h1 class="text-2xl font-bold mb-6">Meditation Biometrics</h1>
  <BiometricsMonitor meditationId={meditationId.toString()} {supabase} />
  <div class="w-full flex mt-4">
    <button class="btn btn-error" on:click={stopMeditation}>
      Stop Meditation
    </button>
  </div>
</div>
