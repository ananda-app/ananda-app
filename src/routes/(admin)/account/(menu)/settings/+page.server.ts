import { fail, redirect } from "@sveltejs/kit";
import type { Actions } from './$types';
import { RESEND_API_KEY } from '$env/static/private';
import { Resend } from 'resend';

const resend = new Resend(RESEND_API_KEY);

export const actions: Actions = {
  invite: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { session } = await safeGetSession()
    if (!session) {
      redirect(303, "/login")
    }

    const formData = await request.formData()
    const email = formData.get("inviteEmail") as string

    // Validate email
    if (!email || !email.includes("@")) {
      return fail(400, {
        errorMessage: "A valid email address is required",
        errorFields: ["inviteEmail"],
        inviteEmail: email,
      })
    }

    try {
      // Generate a unique invitation token
      const token = crypto.randomUUID()

      // Store the invitation in your database
      const { error: dbError } = await supabase
        .from("invitations")
        .insert({ email, token, invited_by: session.user.id })

      if (dbError) throw dbError

      // Send the invitation email using Resend
      const { data, error: emailError } = await resend.emails.send({
        from: 'Ananda <support@ananda.app>',
        to: email,
        subject: 'Ananda.app Invite',
        html: `<p>You've been invited to join our app. <a href="${process.env.APP_URL}/invite/accept?token=${token}">Click here to accept</a>.</p>`
      })

      if (emailError) throw emailError

      return {
        success: true,
        message: "Invitation sent successfully!",
      }
    } catch (error) {
      console.error('Error sending invitation:', error)
      return fail(500, {
        errorMessage: "Failed to send invitation. Please try again later.",
        inviteEmail: email,
      })
    }
  },  
};