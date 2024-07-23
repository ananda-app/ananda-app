<script lang="ts">
  import { page } from "$app/stores"

  export let data
  let { supabase } = data

  let feedback = ""
  let rating = 0
  let successMessage = ""
  let isInitialSubmit = true

  $: meditationId = Number($page.url.searchParams.get("id"))

  const emojis = ["😢", "🙁", "😐", "🙂", "😄"]

  async function submitFeedback() {
    const { data, error } = await supabase
      .from("meditation_sessions")
      .update({ rating, feedback })
      .eq("id", meditationId)

    if (error) {
      console.error("Error updating feedback:", error)
      successMessage = "Error submitting feedback. Please try again."
    } else {
      successMessage = isInitialSubmit
        ? "Thank you for your feedback!"
        : "Your feedback has been updated."
      isInitialSubmit = false
    }
  }
</script>

<svelte:head>
  <title>Meditation Complete</title>
</svelte:head>

<div class="w-full max-w-md">
  <h1 class="text-2xl font-bold mb-6">Meditation Complete</h1>

  {#if successMessage}
    <div class="alert alert-success mb-4">
      <span>{successMessage}</span>
    </div>
  {/if}

  <p class="mb-4">
    Great job! You have successfully completed your meditation session.
    {#if isInitialSubmit}
      Please rate your experience and enter your feedback below.
    {:else}
      You can update your feedback at any time.
    {/if}
  </p>

  <form on:submit|preventDefault={submitFeedback} class="form-control">
    <div class="flex justify-between mb-4">
      {#each emojis as emoji, index}
        <button
          type="button"
          class="btn btn-circle btn-lg {rating === index + 1
            ? 'btn-primary'
            : 'btn-ghost'}"
          on:click={() => (rating = index + 1)}
        >
          <span class="text-2xl">{emoji}</span>
        </button>
      {/each}
    </div>

    <textarea
      class="textarea textarea-bordered h-24 mb-2"
      placeholder="How was your experience? How are you feeling now?"
      bind:value={feedback}
    ></textarea>
    <button type="submit" class="btn btn-primary">
      {isInitialSubmit ? "Submit Feedback" : "Update Feedback"}
    </button>
  </form>
</div>

<p class="mt-4">
  You can also
  <a href="/account/meditate" class="link link-primary">Start New Session</a>
  or
  <a href="/account/history" class="link link-primary">Check History</a>
</p>
