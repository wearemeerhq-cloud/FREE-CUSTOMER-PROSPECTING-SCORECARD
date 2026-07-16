// /api/submit.js
// Vercel serverless function. Receives the quiz results from the front end,
// sends the full scorecard to the lead via Brevo's transactional email API,
// AND saves them as a Brevo Contact so they're tracked for future follow-up.
//
// SETUP:
// 1. In Vercel: Project → Settings → Environment Variables, add:
//      BREVO_API_KEY   = your Brevo API key (Settings → SMTP & API → API Keys, in Brevo)
//      SENDER_EMAIL    = an email address verified in Brevo (Senders, Domains & Dedicated IPs)
//      SENDER_NAME     = e.g. "LeadVault by Meer HQ"
//      BREVO_LIST_ID   = the numeric ID of a Brevo Contacts list (Contacts → Lists in Brevo —
//                        create one first if you haven't, e.g. "LeadVault Scorecard Leads")
//      NOTIFY_EMAIL    = (optional) your own email, to get a copy of every new lead
// 2. Redeploy. Vercel auto-detects /api/*.js as serverless functions — no extra config needed.
//
// NOTE on custom attributes (SCORE, ROLE, CHALLENGE, SCORE_BAND, JOB_TITLE, COMPANY,
// WEBSITE, PHONE, LINKEDIN below): Brevo silently ignores any attribute that doesn't
// already exist in your account — it won't error, the contact just won't have that
// field. If you want those visible/filterable in Brevo, create them first: Contacts →
// Settings → Contact attributes → Add a new attribute (as "Normal" text/number
// attributes, matching the names above exactly, e.g. JOB_TITLE not "Job Title").

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { firstName, email, score, role, challenge, scoreBand, breakdown,
          jobTitle, company, website, phone, linkedin } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const SENDER_EMAIL   = process.env.SENDER_EMAIL;
  const SENDER_NAME    = process.env.SENDER_NAME || 'LeadVault';
  const NOTIFY_EMAIL   = process.env.NOTIFY_EMAIL;
  const BREVO_LIST_ID  = process.env.BREVO_LIST_ID;

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

    // 2. Optional: notify yourself of the new lead. Also awaited now, for
    // the same reason as step 3 below — Vercel can kill an un-awaited
    // request the moment the response is sent.
    if (NOTIFY_EMAIL) {
      try {
        await sendEmail({
          sender: { name: SENDER_NAME, email: SENDER_EMAIL },
          to: [{ email: NOTIFY_EMAIL }],
          subject: `New LeadVault lead: ${name} (${score}/100)`,
          htmlContent: `<p>New submission:</p>
            <p>Name: ${name}<br/>Email: ${email}<br/>Score: ${score}/100 (${scoreBand})<br/>
            Role (from quiz): ${role}<br/>Challenge: ${challenge}<br/>
            Job title: ${jobTitle || '—'}<br/>Company: ${company || '—'}<br/>
            Website: ${website || '—'}<br/>Phone: ${phone || '—'}<br/>
            LinkedIn: ${linkedin || '—'}</p>`,
        });
      } catch (e) {
        console.error('Notify email failed:', e);
      }
    }

    // 3. Save/update this person as a Brevo Contact, so they're tracked for
    // future email campaigns — not just a one-off transactional send.
    //
    // IMPORTANT: this MUST be awaited, not fire-and-forget. Vercel can freeze
    // or terminate a serverless function's execution as soon as it sends its
    // response — any request still "in flight" that wasn't explicitly awaited
    // can get killed mid-request before it actually reaches Brevo. Wrapping
    // in try/catch keeps a contact-save failure from ever blocking the
    // person's scorecard email, which has already succeeded by this point.
    if (BREVO_LIST_ID) {
      try {
        const contactRes = await fetch('https://api.brevo.com/v3/contacts', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
            'api-key': BREVO_API_KEY,
          },
          body: JSON.stringify({
            email,
            listIds: [Number(BREVO_LIST_ID)],
            updateEnabled: true, // upsert — safe to call again if they retake the quiz
            attributes: {
              FIRSTNAME: name,
              SCORE: score,
              SCORE_BAND: scoreBand || '',
              ROLE: role || '',
              CHALLENGE: challenge || '',
              JOB_TITLE: jobTitle || '',
              COMPANY: company || '',
              WEBSITE: website || '',
              PHONE: phone || '',
              LINKEDIN: linkedin || '',
            },
          }),
        });
        if (!contactRes.ok) {
          const errText = await contactRes.text();
          console.error('Brevo contact create/update failed:', contactRes.status, errText);
        }
      } catch (e) {
        console.error('Brevo contact request failed:', e);
      }
    } else {
      console.warn('BREVO_LIST_ID not set — lead was emailed but NOT saved as a Brevo Contact.');
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Submit handler error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
};
