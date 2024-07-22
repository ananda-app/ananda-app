<script lang="ts">
  import { onMount, onDestroy } from "svelte"
  import { goto } from "$app/navigation"
  import { page } from "$app/stores"
  import BiometricsMonitor from "./BiometricsMonitor.svelte"
  import type { RealtimeChannel } from "@supabase/supabase-js"

  export let data
  let { supabase } = data

  $: meditationId = Number($page.url.searchParams.get("id"))

  let audio: HTMLAudioElement
  let channel: RealtimeChannel
  let wakeLock: WakeLockSentinel | null = null
  let isConnected = false
  let connectionError = ""
  let retryCount = 0
  const MAX_RETRIES = 3
  const INITIAL_RETRY_DELAY = 2000 // 2 seconds

  async function requestWakeLock() {
    console.log("Requesting Wake Lock...")
    try {
      wakeLock = await navigator.wakeLock.request("screen")
      console.log("Wake Lock is active")
    } catch (err) {
      console.error(`Failed to request Wake Lock:`, err)
    }
  }

  function releaseWakeLock() {
    console.log("Releasing Wake Lock...")
    if (wakeLock) {
      wakeLock.release().then(() => {
        wakeLock = null
        console.log("Wake Lock released")
      })
    }
  }

  async function initializeSession() {
    console.log("Initializing session...")
    await requestWakeLock()
    try {
      await establishConnection()
      console.log("Connection established successfully")
    } catch (error) {
      console.error("Connection failed:", error)
      if (retryCount < MAX_RETRIES) {
        retryCount++
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount - 1)
        console.log(
          `Retrying connection in ${delay}ms... Attempt ${retryCount}`,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        await initializeSession()
      } else {
        console.error("Max retries reached. Unable to establish connection.")
      }
    }
  }

  async function establishConnection(): Promise<void> {
    console.log("Establishing connection...")
    if (channel) {
      await channel.unsubscribe()
    }

    channel = supabase.channel("schema-db-changes")

    console.log("Channel created:", channel)

    channel.on(
      "postgres_changes",
      { event: "*", schema: "public" },
      handleDatabaseChanges,
    )

    return new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        console.log("Subscription status:", status)
        if (status === "SUBSCRIBED") {
          isConnected = true
          resolve()
        } else if (status === "CLOSED" || status === "TIMED_OUT") {
          isConnected = false
          reject(new Error(`Subscription failed: ${status}`))
        }
      })
    })
  }

  async function handleDatabaseChanges(payload: any) {
    console.log("Handling database changes:", payload)
    if (payload.table === "meditation_instructions") {
      if (
        payload.new &&
        payload.new.id &&
        payload.new.meditation_id === meditationId
      ) {
        try {
          console.log(`Received instruction: ${payload.new.instruction}`)
          const audioUrl = await fetchAudio(payload.new.id)
          playAudio(audioUrl)
        } catch (error) {
          console.error("Failed to fetch or play audio:", error)
        }
      }
    } else if (payload.table === "meditation_sessions") {
      if (payload.new.end_ts !== null && payload.new.id === meditationId) {
        console.log(`Stopping meditation ${meditationId} as end_ts updated`)
        endMeditation()
      }
    }
  }

  async function fetchAudio(instructionId: string) {
    console.log(`Fetching audio for instruction ID: ${instructionId}`)
    const response = await fetch(`/account/meditate/audio?id=${instructionId}`)
    if (!response.ok) throw new Error("Failed to fetch audio")
    const blob = await response.blob()
    return URL.createObjectURL(blob)
  }

  function playAudio(audioUrl: string) {
    console.log(`Playing audio from URL: ${audioUrl}`)
    if (audio) {
      audio.src = audioUrl
      audio.play()
    }
  }

  async function stopMeditation() {
    console.log("Stopping meditation...")
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
    console.log("Ending meditation...")
    releaseWakeLock()
    if (channel) {
      channel.unsubscribe()
    }
    goto("/account/meditate/thank-you")
  }

  async function checkSupabaseConnection() {
    console.log("Checking Supabase connection...")
    if (supabase) {
      console.log("Supabase object exists")
      try {
        await supabase
          .from("meditation_sessions")
          .select("count", { count: "exact" })
          .limit(1)
        console.log("Supabase connection is working")
      } catch (error: any) {
        console.error("Supabase connection check failed:", error)
      }
    } else {
      console.error("Supabase object is undefined")
    }
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    stopMeditation()
    event.preventDefault()
    event.returnValue = ""
  }

  onMount(() => {
    console.log("Component mounted")
    checkSupabaseConnection()
    initializeSession()
    window.addEventListener("beforeunload", handleBeforeUnload)
  })

  onDestroy(() => {
    console.log("Component being destroyed...")
    window.removeEventListener("beforeunload", handleBeforeUnload)
    stopMeditation()
    if (channel) {
      console.log("Unsubscribing from channel...")
      channel.unsubscribe()
    }
    releaseWakeLock()
  })
</script>

<svelte:head>
  <title>Meditation Biometrics</title>
</svelte:head>

<div class="w-full max-w-md">
  <h1 class="text-2xl font-bold mb-6">Meditation Biometrics</h1>

  {#if !isConnected}
    {#if connectionError}
      <p class="text-red-500">{connectionError}</p>
      <button class="btn btn-primary mt-4" on:click={() => initializeSession()}>
        Retry Connection
      </button>
    {:else}
      <p>Establishing connection... Please wait.</p>
    {/if}
  {:else}
    <BiometricsMonitor meditationId={meditationId.toString()} {supabase} />
    <div class="w-full flex mt-4">
      <button class="btn btn-error" on:click={stopMeditation}>
        Stop Meditation
      </button>
    </div>
  {/if}
</div>

<audio bind:this={audio}></audio>
