<script lang="ts">
  import { enhance, applyAction } from "$app/forms"
  import { page } from "$app/stores"
  import type { SubmitFunction } from "@sveltejs/kit"

  const fieldError = (liveForm: FormAccountUpdateResult, name: string) => {
    let errors = liveForm?.errorFields ?? []
    return errors.includes(name)
  }

  // Page state
  let loading = false
  let showSuccess = false

  type Field = {
    inputType?: string // default is "text"
    id: string
    label?: string
    initialValue: string | boolean
    placeholder?: string
    maxlength?: number
  }

  // Module context
  export let editable = false
  export let dangerous = false
  export let title: string = ""
  export let message: string = ""
  export let fields: Field[]
  export let formTarget: string = ""
  export let successTitle = "Success"
  export let successBody = ""
  export let editButtonTitle: string = ""
  export let editLink: string = ""
  export let saveButtonTitle: string = "Save"

  let errorMessage = ""
  let successMessage = ""

  let formValues: { [key: string]: string | boolean } = {}

  $: {
    console.log("Fields initialization:", fields)
    console.log("Form values before setting:", formValues)

    fields.forEach((field) => {
      if (!(field.id in formValues)) {
        formValues[field.id] = field.initialValue || ""
      }
    })
  }

  const handleSubmit: SubmitFunction = () => {
    loading = true
    errorMessage = "" // Clear previous error
    successMessage = "" // Clear previous success message
    return async ({ update, result }) => {
      await update({ reset: false })
      await applyAction(result)
      loading = false
      if (result.type === "success") {
        successMessage = result.data?.message || "Operation successful!"
        fields.forEach((field) => {
          formValues[field.id] = field.initialValue
        })
      } else if (result.type === "failure") {
        errorMessage = result.data?.errorMessage || "An error occurred."
      }
    }
  }

  function handleInput(event: Event, fieldId: string) {
    const target = event.target as HTMLInputElement | null
    if (target) {
      formValues[fieldId] = target.value ?? ""
    }
  }
</script>

<div class="card p-6 pb-7 mt-8 max-w-xl flex flex-col md:flex-row shadow">
  {#if title}
    <div class="text-xl font-bold mb-3 w-48 flex-none">{title}</div>
  {/if}

  <div class="w-full min-w-48">
    {#if !showSuccess}
      {#if message}
        <div class="mb-6 {dangerous ? 'alert alert-warning' : ''}">
          {#if dangerous}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="stroke-current shrink-0 h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              /></svg
            >
          {/if}

          <span>{message}</span>
        </div>
      {/if}
      <form
        class="form-widget flex flex-col"
        method="POST"
        action={formTarget}
        use:enhance={handleSubmit}
      >
        {#each fields as field}
          {#if field.label}
            <label for={field.id}>
              <span class="text-sm text-gray-500">{field.label}</span>
            </label>
          {/if}
          {#if editable}
            <input
              id={field.id}
              name={field.id}
              type={field.inputType ?? "text"}
              disabled={!editable}
              placeholder={field.placeholder ?? field.label ?? ""}
              class="{fieldError($page?.form, field.id)
                ? 'input-error'
                : ''} input-sm mt-1 input input-bordered w-full max-w-xs mb-3 text-base py-4"
              value={formValues[field.id]}
              maxlength={field.maxlength ? field.maxlength : null}
              on:input={(e) => handleInput(e, field.id)}
            />
          {:else}
            <div class="text-lg mb-3">{field.initialValue}</div>
          {/if}
        {/each}

        {#if errorMessage}
          <p class="text-red-700 text-sm font-bold mt-1">
            {errorMessage}
          </p>
        {/if}

        {#if successMessage}
          <p class="text-green-700 text-sm font-bold mt-1">
            {successMessage}
          </p>
        {/if}

        {#if editable}
          <div>
            <button
              type="submit"
              class="ml-auto btn btn-sm mt-3 min-w-[145px] {dangerous
                ? 'btn-error'
                : 'btn-success'}"
              disabled={loading}
            >
              {#if loading}
                <span
                  class="loading loading-spinner loading-md align-middle mx-3"
                ></span>
              {:else}
                {saveButtonTitle}
              {/if}
            </button>
          </div>
        {:else}
          <!-- !editable -->
          <a href={editLink} class="mt-1">
            <button
              class="btn btn-outline btn-sm {dangerous
                ? 'btn-error'
                : ''} min-w-[145px]"
            >
              {editButtonTitle}
            </button>
          </a>
        {/if}
      </form>
    {:else}
      <!-- showSuccess -->
      <div>
        <div class="text-l font-bold">{successTitle}</div>
        <div class="text-base">{successBody}</div>
      </div>
      <a href="/account/settings">
        <button class="btn btn-outline btn-sm mt-3 min-w-[145px]">
          Return to Settings
        </button>
      </a>
    {/if}
  </div>
</div>
