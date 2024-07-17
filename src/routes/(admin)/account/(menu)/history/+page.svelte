<script lang="ts">
  import { getContext, onMount } from "svelte"
  import type { Writable } from "svelte/store"
  import BiometricsChart from "./BiometricsChart.svelte"
  import { formatTechnique } from "$lib/formatUtils"

  let adminSection: Writable<string> = getContext("adminSection")
  adminSection.set("history")

  export let data
  let { supabase } = data

  interface Session {
    id: number
    technique: string
    duration: number
    start_ts: string
    end_ts: string
    comments: string
    biometrics: Array<{
      ts: string
      bpm: number
      brpm: number
      movement: number
    }>
    meditation_instructions: Array<{
      id: number
      ts: string
      instruction: string
    }>
  }

  let sessions: Session[] = []

  let pageSize = 10
  let lastId: number | null = null
  let loading = false
  let allLoaded = false

  async function fetchMoreSessions() {
    if (loading || allLoaded) return

    loading = true
    const query = supabase
      .from("meditation_sessions")
      .select(
        `
        *,
        meditation_instructions!meditation_id (id, ts, instruction),
        biometrics!meditation_id (ts, bpm, brpm, movement)
        `,
      )
      .order("id", { ascending: false })
      .limit(pageSize)

    if (lastId) {
      query.lt("id", lastId)
    }

    const { data, error } = await query

    if (error) {
      console.error(error)
    } else {
      sessions = [...sessions, ...data]
      lastId = data[data.length - 1]?.id
      allLoaded = data.length < pageSize
    }
    loading = false
  }

  function handleScroll() {
    const bottom =
      window.innerHeight + window.scrollY >= document.body.offsetHeight - 100
    if (bottom) {
      fetchMoreSessions()
    }
  }

  onMount(() => {
    fetchMoreSessions()
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  })
</script>

<svelte:head>
  <title>Meditation History</title>
</svelte:head>

<div class="container mx-aut">
  <h1 class="text-2xl font-bold mb-6">History</h1>

  <div class="space-y-6">
    {#each sessions as session (session.id)}
      <div class="card bg-base-100 shadow">
        <div class="card-body">
          <h2 class="card-title">
            {formatTechnique(session.technique)} - {session.duration} minutes
          </h2>
          <p>Start: {new Date(session.start_ts).toLocaleString()}</p>
          <p>End: {new Date(session.end_ts).toLocaleString()}</p>
          {#if session.comments}
            <p class="italic">"{session.comments}"</p>
          {/if}
          <div class="my-4">
            <BiometricsChart
              biometrics={session.biometrics}
              instructions={session.meditation_instructions}
            />
          </div>
        </div>
      </div>
    {/each}
  </div>

  {#if loading}
    <div class="flex justify-center my-4">
      <button class="btn btn-ghost loading">Loading</button>
    </div>
  {/if}

  {#if allLoaded}
    <p class="text-center my-4 text-gray-500">All sessions loaded</p>
  {/if}
</div>
