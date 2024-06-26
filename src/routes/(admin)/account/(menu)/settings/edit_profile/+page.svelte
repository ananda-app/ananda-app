<script lang="ts">
  import SettingsModule from "../settings_module.svelte"
  import { getContext } from "svelte"
  import type { Writable } from "svelte/store"

  let adminSection: Writable<string> = getContext("adminSection")
  adminSection.set("settings")

  export let data

  let { profile } = data
</script>

<svelte:head>
  <title>Edit Profile</title>
</svelte:head>

<h1 class="text-2xl font-bold mb-6">Edit Profile</h1>

<SettingsModule
  editable={true}
  title="Edit Profile"
  successTitle="Saved Profile"
  formTarget="/account/api?/updateProfile"
  fields={[
    {
      id: "fullName",
      label: "Name",
      initialValue: profile?.full_name ?? "",
      placeholder: "Your full name",
      maxlength: 50,
    },
    {
      id: "gender",
      label: "Gender",
      initialValue: profile?.gender ?? "",
      placeholder: "Your gender",
      maxlength: 50,
    },
    {
      id: "dateOfBirth",
      label: "Date of Birth",
      initialValue: profile?.date_of_birth ?? "",
      inputType: "date",
    },
    {
      id: "location",
      label: "Location",
      initialValue: profile?.location ?? "",
      placeholder: "Your location",
      maxlength: 100,
    },
  ]}
/>
