import { fail, redirect } from "@sveltejs/kit";
import type { Actions } from './$types';
import { RESEND_API_KEY, APP_URL } from '$env/static/private';
import { Resend } from 'resend';
import Mustache from 'mustache';
import inlineCss from 'inline-css';
import emailTemplates from '$lib/emailTemplates';
const resend = new Resend(RESEND_API_KEY);

export const actions: Actions = {
  invite: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { session } = await safeGetSession()
    if (!session) {
      redirect(303, "/login")
    }

    const formData = await request.formData()
    const recipientName = formData.get("inviteName") as string
    const recipientEmail = formData.get("inviteEmail") as string
    
    // Validate email and name
    if (!recipientEmail || !recipientEmail.includes("@")) {
      return fail(400, {
        errorMessage: "A valid email address is required",
        errorFields: ["inviteEmail"],
        inviteEmail: recipientEmail,
        inviteName: recipientName,
      })
    }

    if (!recipientName.trim()) {
      return fail(400, {
        errorMessage: "Name is required",
        errorFields: ["inviteName"],
        inviteEmail: recipientEmail,
        inviteName: recipientName,
      })
    }

    try {
      const { data: existingUser, error: userError } = await supabase.rpc('check_user_exists', { email: recipientEmail });

      if (userError) {
        throw userError; // Handle database errors
      }
    
      if (existingUser) {
        // User exists, handle accordingly
        return fail(400, { 
          errorMessage: "A user with this email address already exists.", 
          errorFields: ["inviteEmail"],
          inviteEmail: recipientEmail,
          inviteName: recipientName,
        });
      }
            // Fetch the sender's name from the profiles table
      const { data: senderProfile, error: profileError } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', session.user.id)
        .single()

      if (profileError) throw profileError

      const senderName = senderProfile.full_name || session.user.email

      // Generate a unique invitation token
      const token = crypto.randomUUID()

      // Store the invitation in your database
      const { error: dbError } = await supabase
        .from("invitations")
        .insert({ email: recipientEmail, token, invited_by: session.user.id })

      if (dbError) throw dbError

      // Prepare the data for the email template
      const templateData = {
        name: recipientName,
        invite_sender_name: senderName,
        action_url: `${APP_URL}/login/accept_invite?token=${token}`,
        support_email: 'support@ananda.app'
      };

      const emailTemplate = emailTemplates.inviteEmail;

      const renderedHtml = Mustache.render(emailTemplate.html, templateData);

      const inlinedHtml = await inlineCss(renderedHtml, { url: ' ' });

      // Send the invitation email using Resend
      const { data, error: emailError } = await resend.emails.send({
        from: 'Ananda <support@ananda.app>',
        to: recipientEmail,
        reply_to: recipientEmail,
        subject: emailTemplate.subject,
        html: inlinedHtml
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
        inviteEmail: recipientEmail,
      })
    }
  },  
};