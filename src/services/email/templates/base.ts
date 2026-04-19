// ─────────────────────────────────────────────────────────────────────────────
// Base email layout and reusable component helpers.
//
// Rules of this file:
//   - No imports from the rest of the app (no env, no db, no queues)
//   - No knowledge of specific notification types
//   - Only pure functions: string in → string out
// ─────────────────────────────────────────────────────────────────────────────


// ─── Layout wrapper ───────────────────────────────────────────────────────────

/**
 * Wraps any email content in the full HTML shell.
 * Every template calls this exactly once.
 *
 * previewText is the snippet email clients show in the inbox list
 * before the user opens the email. Keep it under 90 chars.
 */
export function baseLayout(content: string, previewText = ''): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color: #f4f4f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">

  ${previewText
    ? `<span style="display:none;max-height:0;overflow:hidden;font-size:1px;">${previewText}&nbsp;</span>`
    : ''
  }

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"
               style="max-width:600px;width:100%;background: #ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#18181b;padding:24px 32px;">
              <p style="margin: 0;color: #ffffff;font-size: 18px;font-weight: 700;letter-spacing:-0.3px;">
                ✦ Task API
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:32px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f9f9f9;padding:20px 32px;border-top:1px solid #e4e4e7;">
              <p style="margin:0;color: #71717a;font-size:12px;line-height:1.6;">
                You're receiving this because you have an account on Task API.
                <br/>If you didn't expect this email, you can safely ignore it.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`.trim();
}


// ─── Component helpers ────────────────────────────────────────────────────────

export function heading(text: string): string {
  return `
  <h1 style="margin:0 0 8px;color: #18181b;font-size:22px;font-weight:700;line-height:1.3;letter-spacing:-0.3px;">
    ${text}
  </h1>`.trim();
}

export function subheading(text: string): string {
  return `
  <p style="margin:0 0 24px;color: #71717a;font-size:14px;line-height:1.5;">
    ${text}
  </p>`.trim();
}

export function paragraph(text: string): string {
  return `
  <p style="margin:0 0 16px;color: #3f3f46;font-size:15px;line-height:1.6;">
    ${text}
  </p>`.trim();
}

export function divider(): string {
  return `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />`;
}

/**
 * A key-value info table. Pass rows as [label, value] pairs.
 *
 * metaTable([
 *   ['Task',    'Fix login bug'],
 *   ['Project', 'Backend API'],
 * ])
 */
export function metaTable(rows: [string, string][]): string {
  const rowsHtml = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 0;color: #71717a;font-size:13px;width:120px;vertical-align:top;">
        ${label}
      </td>
      <td style="padding:8px 0;color: #18181b;font-size:13px;font-weight:500;vertical-align:top;">
        ${value}
      </td>
    </tr>
  `).join('');

  return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
         style="background:#f9f9f9;border-radius:6px;padding:4px 16px;margin:16px 0;">
    <tbody>${rowsHtml}</tbody>
  </table>`.trim();
}

export function ctaButton(text: string, href: string): string {
  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
    <tr>
      <td style="border-radius:6px;background: #18181b;">
        <a href="${href}"
           style="display:inline-block;padding:12px 24px;color: #ffffff;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:0.1px;">
          ${text}
        </a>
      </td>
    </tr>
  </table>`.trim();
}

/**
 * A small coloured inline label. Default color is neutral gray.
 *
 * badge('In Progress', '#2563eb')
 * badge('Done', '#16a34a')
 */
export function badge(text: string, color = '#71717a'): string {
  return `
  <span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${color}20;color:${color};font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
    ${text}
  </span>`.trim();
}