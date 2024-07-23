<script lang="ts">
  import { onMount, onDestroy } from "svelte"
  import { goto } from "$app/navigation"
  import { page } from "$app/stores"
  import BiometricsMonitor from "./BiometricsMonitor.svelte"

  export let data
  let { supabase } = data

  $: meditationId = Number($page.url.searchParams.get("id"))

  let audio: HTMLAudioElement
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
      const response = await fetch("/account/meditate?/instr", {
        method: "POST",
        body: new URLSearchParams({ meditationId: meditationId.toString() }),
      })

      // Check if the response is ok (status in the range 200-299)
      if (response.ok) {
        const result = await response.json()

        if (result.type !== "success") {
          console.error("LLM processing failed")
        }
      } else {
        // Handle non-OK responses
        if (response.status === 401) {
          goto("/login/sign_in")
        } else {
          goto("/account/meditate/oops")
        }
      }
    } catch (error) {
      console.error("Network or parsing error:", error)
    }

    // Fetch and play instructions
    const { data, error } = await supabase
      .from("meditation_instructions")
      .select("*")
      .eq("meditation_id", meditationId)
      .is("play_ts", null)
      .order("ts", { ascending: true })
      .limit(1)

    if (error) {
      console.error("Error fetching instructions:", error)
    } else if (data && data.length > 0) {
      const instruction = data[0]
      try {
        const audioUrl = await fetchAudio(instruction.id)
        currentAudioPromise = playAudio(audioUrl, instruction.id)
        await currentAudioPromise
      } catch (error) {
        console.error("Failed to fetch or play audio:", error)
      }
    }

    const { data: sessionData, error: sessionError } = await supabase
      .from("meditation_sessions")
      .select("end_ts")
      .eq("id", meditationId)
      .single()

    if (sessionError) {
      console.error("Error checking session:", sessionError)
      console.log("Session data:", sessionData)
    } else if (sessionData.end_ts !== null) {
      endMeditation()
      return
    }
  }

  async function fetchAudio(instructionId: string) {
    const response = await fetch(`/account/meditate/audio?id=${instructionId}`)
    if (!response.ok) throw new Error("Failed to fetch audio")
    const blob = await response.blob()
    return URL.createObjectURL(blob)
  }

  async function playAudio(
    audioUrl: string,
    instructionId: number,
  ): Promise<void> {
    if (audio) {
      audio.src = audioUrl
      return new Promise((resolve) => {
        audio.onended = async () => {
          await updatePlayTimestamp(instructionId)
          resolve()
        }
        audio.play()
      })
    }
    return Promise.resolve()
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
      const response = await fetch("/account/meditate?/stop", {
        method: "POST",
        body: new URLSearchParams({
          meditationId: meditationId.toString(),
        }),
      })
      if (response.ok) {
        const result = await response.json()
        if (result.success && result.redirect) {
          goto(result.redirect)
        } else {
          endMeditation()
        }
      } else {
        throw new Error("Failed to stop meditation")
      }
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

<audio bind:this={audio}></audio>
