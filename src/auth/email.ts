import type { Env } from "../env";

// Transactional email via Resend (https://resend.com). Workers can't send mail directly,
// so we call the provider's REST API. When RESEND_API_KEY is unset (local dev / tests),
// the link is logged instead of sent so the flow stays testable. Returns whether it sent.
export async function sendResetEmail(env: Env, to: string, link: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[password-reset] RESEND_API_KEY unset — reset link for ${to}: ${link}`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESET_EMAIL_FROM || "Transition Calc <onboarding@resend.dev>",
        to,
        subject: "Reset your password",
        text:
          `Reset your Military Transition Calculator password (this link is valid for 1 hour):\n\n` +
          `${link}\n\n` +
          `If you didn't request this, you can safely ignore this email.`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
