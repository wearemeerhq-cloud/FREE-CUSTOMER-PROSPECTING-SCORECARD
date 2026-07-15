// /api/submit.js
// Vercel serverless function. Receives the quiz results from the front end
// and sends the full scorecard to the lead via Brevo's transactional email API.
//
// SETUP:
// 1. In Vercel: Project → Settings → Environment Variables, add:
//      BREVO_API_KEY   = your Brevo API key (Settings → SMTP & API → API Keys, in Brevo)
//      SENDER_EMAIL    = an email address verified in Brevo (Senders, Domains & Dedicated IPs)
//      SENDER_NAME     = e.g. "LeadVault by Meer HQ"
//      NOTIFY_EMAIL    = (optional) your own email, to get a copy of every new lead
// 2. Redeploy. Vercel auto-detects /api/*.js as serverless functions — no extra config needed.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { firstName, email, score, role, challenge, scoreBand, breakdown } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const SENDER_EMAIL   = process.env.SENDER_EMAIL;
  const SENDER_NAME    = process.env.SENDER_NAME || 'LeadVault';
  const NOTIFY_EMAIL   = process.env.NOTIFY_EMAIL;

  if (!BREVO_API_KEY || !SENDER_EMAIL) {
    console.error('Missing BREVO_API_KEY or SENDER_EMAIL env vars');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  const name = firstName || 'there';

  // Build the breakdown rows for the email body
  const rowsHtml = (breakdown || []).map(row => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e5e5e5;">
        <div style="font-weight:600;color:#0D0D0D;">
          ${row.pass ? '✅' : '⚠️'} ${row.label} — ${row.answer || ''}
        </div>
        <div style="color:#555;font-size:13px;margin-top:4px;">${row.fix || ''}</div>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #e5e5e5;text-align:right;
                 font-family:monospace;color:#E8440A;white-space:nowrap;">
        ${row.pts}/${row.max}
      </td>
    </tr>
  `).join('');

  const htmlContent = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
    <div style="background:#0D0D0D;padding:20px 24px;">
      <span style="color:#fff;font-weight:700;font-family:monospace;">LeadVault</span>
      <span style="color:#E8440A;font-weight:700;font-family:monospace;">™</span>
    </div>

    <div style="padding:32px 24px;">
      <p style="font-size:16px;color:#0D0D0D;">Hey ${name},</p>
      <p style="font-size:15px;color:#333;line-height:1.6;">
        Here's your full ICP Targeting Scorecard — your results plus exactly what to fix first.
      </p>

      <div style="text-align:center;margin:28px 0;">
        <div style="font-size:48px;font-weight:800;color:#0D0D0D;">
          ${score}<span style="font-size:22px;color:#E8440A;">/100</span>
        </div>
        <div style="font-family:monospace;font-size:13px;color:#E8440A;
                    text-transform:uppercase;letter-spacing:0.06em;">${scoreBand || ''}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${rowsHtml}
      </table>

      <p style="font-size:14px;color:#555;line-height:1.6;">
        Role: <strong>${role || 'n/a'}</strong><br/>
        Biggest challenge: <strong>${challenge || 'n/a'}</strong>
      </p>

      <div style="text-align:center;margin-top:32px;">
        <a href="https://meerhq-leadvault.vercel.app/"
           style="background:#E8440A;color:#fff;text-decoration:none;font-weight:700;
                  padding:14px 28px;display:inline-block;font-family:monospace;
                  font-size:13px;letter-spacing:0.05em;text-transform:uppercase;">
          Get Your ICP-Matched Leads →
        </a>
      </div>
    </div>

    <div style="padding:16px 24px;color:#999;font-size:12px;text-align:center;">
      © 2026 Meer HQ. You're receiving this because you completed the LeadVault scorecard.
    </div>
  </div>`;

  const sendEmail = (payload) =>
    fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });

  try {
    // 1. Email the scorecard to the lead
    const leadRes = await sendEmail({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email, name }],
      subject: `${name}, your ICP Targeting Score: ${score}/100`,
      htmlContent,
    });

    if (!leadRes.ok) {
      const errText = await leadRes.text();
      console.error('Brevo error (lead email):', leadRes.status, errText);
      return res.status(502).json({ error: 'Failed to send scorecard email' });
    }

    // 2. Optional: notify yourself of the new lead (non-blocking, failures ignored)
    if (NOTIFY_EMAIL) {
      sendEmail({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: NOTIFY_EMAIL }],
        subject: `New LeadVault lead: ${name} (${score}/100)`,
        htmlContent: `<p>New submission:</p>
          <p>Name: ${name}<br/>Email: ${email}<br/>Score: ${score}/100 (${scoreBand})<br/>
          Role: ${role}<br/>Challenge: ${challenge}</p>`,
      }).catch(e => console.error('Notify email failed:', e));
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Submit handler error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
};
