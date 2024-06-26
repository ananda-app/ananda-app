<script lang="ts">
  import { getContext } from "svelte"
  import type { Writable } from "svelte/store"
  import SettingsModule from "./settings_module.svelte"

  let adminSection: Writable<string> = getContext("adminSection")
  adminSection.set("settings")

  export let data
  let { session, profile } = data
</script>

<svelte:head>
  <title>Settings</title>
</svelte:head>

<h1 class="text-2xl font-bold mb-6">Settings</h1>

<SettingsModule
  title="Profile"
  editable={false}
  fields={[
    { id: "fullName", label: "Name", initialValue: profile?.full_name ?? "" },
    { id: "gender", label: "Gender", initialValue: profile?.gender ?? "" },
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
    },
  ]}
  editButtonTitle="Edit Profile"
  editLink="/account/settings/edit_profile"
/>

<SettingsModule
  title="Email"
  editable={false}
  fields={[{ id: "email", initialValue: session?.user?.email || "" }]}
  editButtonTitle="Change Email"
  editLink="/account/settings/change_email"
/>

<SettingsModule
  title="Password"
  editable={false}
  fields={[{ id: "password", initialValue: "••••••••••••••••" }]}
  editButtonTitle="Change Password"
  editLink="/account/settings/change_password"
/>

<SettingsModule
  title="Invite User"
  editable={true}
  fields={[
    {
      id: "inviteName",
      label: "Name",
      initialValue: "",
      inputType: "text",
      placeholder: "Enter name of invitee",
    },
    {
      id: "inviteEmail",
      label: "Email",
      initialValue: "",
      inputType: "email",
      placeholder: "Enter email to invite",
    },
  ]}
  formTarget="?/invite"
  saveButtonTitle="Send Invite"
/>

<SettingsModule
  title="Danger Zone"
  editable={false}
  dangerous={true}
  fields={[]}
  editButtonTitle="Delete Account"
  editLink="/account/settings/delete_account"
/>
