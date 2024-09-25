<script lang="ts">
  import { onMount } from "svelte"
  import { goto } from "$app/navigation"

  export let data

  let inviteToken = ""
  let invitedEmail = ""
  let password = ""
  let confirmPassword = ""
  let error = ""
  let loading = false

  onMount(async () => {
    const urlParams = new URLSearchParams(window.location.search)
    inviteToken = urlParams.get("token") || ""

    if (!inviteToken) {
      error = "Invalid invite link. Please request a new invitation."
      return
    }

    try {
      const { data: invites, error: inviteError } = await data.supabase
        .from("invitations")
        .select("email, accepted")
        .eq("token", inviteToken)
        .single()

      if (inviteError) {
        error =
          "An error occurred while verifying your invitation. Please try again later."
        return
      }

      if (!invites) {
        error = "Invalid or expired invite. Please request a new invitation."
        return
      }

      if (invites.accepted) {
        error =
          "This invitation has already been used. Please request a new one if needed."
        return
      }

      invitedEmail = invites.email
    } catch (e: any) {
      error = "An unexpected error occurred. Please try again."
    }
  })

  const handleSignUp = async () => {
    if (password !== confirmPassword) {
      error = "Passwords do not match."
      return
    }

    loading = true
    error = ""

    try {
      // First, sign up the user
      const { data: signUpData, error: signUpError } =
        await data.supabase.auth.signUp({
          email: invitedEmail,
          password: password,
          options: {
            data: {
              invite_token: inviteToken,
            },
          },
        })

      if (signUpError) throw signUpError

      if (signUpData.user) {
        // Confirm the email using RPC
        const { data: confirmData, error: confirmError } = await (
          data.supabase.rpc as any
        )("confirm_user_email", { user_id: signUpData.user.id })

        if (confirmError) throw confirmError

        // Update the invitation status
        const { error: inviteUpdateError } = await data.supabase
          .from("invitations")
          .update({ accepted: true })
          .eq("token", inviteToken)

        if (inviteUpdateError) throw inviteUpdateError

        // Sign in the user
        const { error: signInError } =
          await data.supabase.auth.signInWithPassword({
            email: invitedEmail,
            password: password,
          })

        if (signInError) throw signInError

        goto("/account")
      }
    } catch (e: any) {
      console.log(e)
      error = e.message || "An error occurred during sign up."
    } finally {
      loading = false
    }
  }
</script>

<svelte:head>
  <title>Accept Invitation</title>
</svelte:head>

<div class="max-w-md mx-auto mt-8">
  {#if error}
    <div class="alert alert-error mb-4">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="stroke-current shrink-0 h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        ><path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        /></svg
      >
      <span>{error}</span>
    </div>
  {:else}
    <h1 class="text-2xl font-bold mb-6">Accept Invitation</h1>
    <p class="mb-4">
      You've been invited to join. Please complete your registration.
    </p>

    <form on:submit|preventDefault={handleSignUp} class="space-y-4">
      <div class="form-control">
        <label for="email" class="label">
          <span class="label-text">Email</span>
        </label>
        <input
          type="email"
          id="email"
          value={invitedEmail}
          disabled
          class="input input-bordered input-disabled"
        />
      </div>
      <div class="form-control">
        <label for="password" class="label">
          <span class="label-text">Password</span>
        </label>
        <input
          type="password"
          id="password"
          bind:value={password}
          required
          class="input input-bordered"
        />
      </div>
      <div class="form-control">
        <label for="confirmPassword" class="label">
          <span class="label-text">Confirm Password</span>
        </label>
        <input
          type="password"
          id="confirmPassword"
          bind:value={confirmPassword}
          required
          class="input input-bordered"
        />
      </div>
      <button type="submit" disabled={loading} class="btn btn-primary w-full">
        {loading ? "Signing up..." : "Sign up"}
      </button>
    </form>
  {/if}
</div>
