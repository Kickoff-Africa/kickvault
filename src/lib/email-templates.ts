/**
 * HTML email templates — styled to match the Kickoff Africa brand.
 *
 * Design: white background, navy (#001A4D) header, bright blue (#0066F6) CTAs,
 * gold (#FFE9B0) accents, Inter typeface, minimal / corporate-modern.
 *
 * All styles are inlined for maximum email-client compatibility.
 * Tables are used for layout (Outlook-safe).
 */

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

function shell(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <title>Kick Vault</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:'Inter',Arial,Helvetica,sans-serif;">

  <!-- outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- card -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- header — navy brand bar -->
          <tr>
            <td style="background-color:#001a4d;padding:28px 40px;border-radius:16px 16px 0 0;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td>
                    <!-- Logo wordmark -->
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align:middle;">
                          <!-- Shield icon -->
                          <table cellpadding="0" cellspacing="0" border="0" style="display:inline-table;">
                            <tr>
                              <td style="background-color:#0066f6;border-radius:8px;width:36px;height:36px;text-align:center;vertical-align:middle;">
                                <span style="font-size:18px;line-height:36px;display:block;">🔐</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="vertical-align:middle;padding-left:10px;">
                          <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Kick</span><span style="font-size:20px;font-weight:700;color:#60a5fa;letter-spacing:-0.3px;">Vault</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="font-size:11px;color:#b0d0fc;letter-spacing:1.5px;text-transform:uppercase;font-weight:500;">Kickoff Africa</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- body -->
          ${body}

          <!-- footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:24px 40px;border-top:1px solid #e8edf2;border-radius:0 0 16px 16px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <p style="margin:0 0 6px;font-size:12px;color:#64748b;line-height:1.5;">
                      This email was sent by <strong style="color:#001a4d;">Kick Vault</strong> — the credential management platform by Kickoff Africa.
                    </p>
                    <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;">
                      If you did not expect this email, you can safely ignore it.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /card -->

        <!-- sub-footer -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;margin-top:20px;">
          <tr>
            <td align="center">
              <p style="margin:0;font-size:11px;color:#94a3b8;">
                © ${new Date().getFullYear()} Kickoff Africa · Strategy. Execution. Impact.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Reusable components
// ---------------------------------------------------------------------------

function ctaButton(label: string, url: string): string {
  return `
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="background-color:#0066f6;border-radius:24px;padding:0;">
        <a href="${url}"
           target="_blank"
           style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:-0.1px;border-radius:24px;background-color:#0066f6;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

function infoBox(content: string): string {
  return `
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:24px;">
    <tr>
      <td style="background-color:#eff6ff;border-radius:12px;padding:20px 24px;border-left:3px solid #0066f6;">
        ${content}
      </td>
    </tr>
  </table>`;
}

function highlightBox(content: string): string {
  return `
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:24px;">
    <tr>
      <td style="background-color:#f8fafc;border-radius:12px;padding:20px 24px;border:1px solid #e2e8f0;">
        ${content}
      </td>
    </tr>
  </table>`;
}

function divider(): string {
  return `
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0;">
    <tr>
      <td style="border-top:1px solid #e8edf2;font-size:0;line-height:0;">&nbsp;</td>
    </tr>
  </table>`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function inviteEmailHtml(inviteUrl: string, expiryDays: number): string {
  const body = `
  <tr>
    <td style="padding:40px 40px 32px;">

      <!-- greeting badge -->
      <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
        <tr>
          <td style="background-color:rgba(0,102,246,0.15);border:1px solid rgba(0,102,246,0.3);border-radius:20px;padding:6px 14px;">
            <span style="font-size:12px;font-weight:600;color:#0066f6;letter-spacing:0.5px;text-transform:uppercase;">You're Invited</span>
          </td>
        </tr>
      </table>

      <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#0f172a;line-height:1.25;letter-spacing:-0.5px;">
        Welcome to Kick Vault
      </h1>
      <p style="margin:0 0 32px;font-size:16px;color:#475569;line-height:1.6;">
        You've been invited to join Kick Vault — Kickoff Africa's secure credential management platform. Click below to set your password and activate your account.
      </p>

      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td align="center">
            ${ctaButton('Accept Invitation', inviteUrl)}
          </td>
        </tr>
      </table>

      ${divider()}

      ${infoBox(`
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding-right:12px;vertical-align:top;width:20px;">
              <span style="font-size:14px;">⏱</span>
            </td>
            <td>
              <p style="margin:0;font-size:13px;color:#334155;line-height:1.55;">
                This invitation link expires in <strong style="color:#0f172a;">${expiryDays} day${expiryDays === 1 ? '' : 's'}</strong>. If you were not expecting this invitation, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      `)}

      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;word-break:break-all;">
        Or copy and paste this link into your browser:<br/>
        <a href="${inviteUrl}" style="color:#0066f6;text-decoration:none;">${inviteUrl}</a>
      </p>

    </td>
  </tr>`;

  return shell(body);
}

export function verifyEmailHtml(verifyUrl: string, expiryMin: number): string {
  const body = `
  <tr>
    <td style="padding:40px 40px 32px;">

      <!-- badge -->
      <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
        <tr>
          <td style="background-color:rgba(0,102,246,0.15);border:1px solid rgba(0,102,246,0.3);border-radius:20px;padding:6px 14px;">
            <span style="font-size:12px;font-weight:600;color:#0066f6;letter-spacing:0.5px;text-transform:uppercase;">Email Verification</span>
          </td>
        </tr>
      </table>

      <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#0f172a;line-height:1.25;letter-spacing:-0.5px;">
        Confirm your email address
      </h1>
      <p style="margin:0 0 32px;font-size:16px;color:#475569;line-height:1.6;">
        Thanks for signing up to Kick Vault. Click the button below to verify your email address and activate your account.
      </p>

      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td align="center">
            ${ctaButton('Verify Email Address', verifyUrl)}
          </td>
        </tr>
      </table>

      ${divider()}

      ${infoBox(`
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding-right:12px;vertical-align:top;width:20px;">
              <span style="font-size:14px;">⏱</span>
            </td>
            <td>
              <p style="margin:0;font-size:13px;color:#334155;line-height:1.55;">
                This verification link expires in <strong style="color:#0f172a;">${expiryMin} minutes</strong>. If you didn't create a Kick Vault account, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      `)}

      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;word-break:break-all;">
        Or copy and paste this link into your browser:<br/>
        <a href="${verifyUrl}" style="color:#0066f6;text-decoration:none;">${verifyUrl}</a>
      </p>

    </td>
  </tr>`;

  return shell(body);
}

export function passwordResetEmailHtml(resetUrl: string, expiryMin: number): string {
  const body = `
  <tr>
    <td style="padding:40px 40px 32px;">

      <!-- badge -->
      <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
        <tr>
          <td style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:20px;padding:6px 14px;">
            <span style="font-size:12px;font-weight:600;color:#c2410c;letter-spacing:0.5px;text-transform:uppercase;">Password Reset</span>
          </td>
        </tr>
      </table>

      <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#0f172a;line-height:1.25;letter-spacing:-0.5px;">
        Reset your password
      </h1>
      <p style="margin:0 0 32px;font-size:16px;color:#475569;line-height:1.6;">
        We received a request to reset the password for your Kick Vault account. Click the button below to choose a new password.
      </p>

      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td align="center">
            ${ctaButton('Reset Password', resetUrl)}
          </td>
        </tr>
      </table>

      ${divider()}

      ${infoBox(`
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding-right:12px;vertical-align:top;width:20px;">
              <span style="font-size:14px;">⚠️</span>
            </td>
            <td>
              <p style="margin:0;font-size:13px;color:#334155;line-height:1.55;">
                This link expires in <strong style="color:#0f172a;">${expiryMin} minutes</strong>. If you did not request a password reset, no action is needed — your password has not been changed.
              </p>
            </td>
          </tr>
        </table>
      `)}

      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;word-break:break-all;">
        Or copy and paste this link into your browser:<br/>
        <a href="${resetUrl}" style="color:#0066f6;text-decoration:none;">${resetUrl}</a>
      </p>

    </td>
  </tr>`;

  return shell(body);
}
