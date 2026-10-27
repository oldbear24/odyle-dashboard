package migrations

import (
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Mail in the dashboard's look: the emails PocketBase sends to accounts and superusers
// (a sign-in from a new device, sign-in codes, password resets and email confirmations)
// carry the dashboard's brand bar, colours, headings, mint button and footer instead of
// PocketBase's plain stock text. Only the templates still as PocketBase ships them are
// replaced; one a superuser has edited stays as it is, both ways.
func init() {
	register("1791763223_mail_templates.go", func(app core.App) error {
		return swapMailTemplates(app, false)
	}, func(app core.App) error {
		return swapMailTemplates(app, true)
	})
}

func swapMailTemplates(app core.App, back bool) error {
	stock := mailTemplatesOf(core.NewAuthCollection("stock"))
	for _, name := range []string{"users", core.CollectionNameSuperusers} {
		c, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return err
		}
		ours := odyleMails(name == core.CollectionNameSuperusers)
		for kind, current := range mailTemplatesOf(c) {
			from, to := *stock[kind], ours[kind]
			if back {
				from, to = to, from
			}
			if sameMail(*current, from) {
				*current = to
			}
		}
		if err := app.Save(c); err != nil {
			return err
		}
	}
	return nil
}

// mailTemplatesOf are the email templates of an auth collection by kind.
func mailTemplatesOf(c *core.Collection) map[string]*core.EmailTemplate {
	return map[string]*core.EmailTemplate{
		"verification":       &c.VerificationTemplate,
		"resetPassword":      &c.ResetPasswordTemplate,
		"confirmEmailChange": &c.ConfirmEmailChangeTemplate,
		"otp":                &c.OTP.EmailTemplate,
		"authAlert":          &c.AuthAlert.EmailTemplate,
	}
}

// sameMail tells whether a template is the given one, white space aside.
func sameMail(a, b core.EmailTemplate) bool {
	return strings.TrimSpace(a.Subject) == strings.TrimSpace(b.Subject) && strings.Join(strings.Fields(a.Body), " ") == strings.Join(strings.Fields(b.Body), " ")
}

// odyleMails are the emails of the accounts, who sign in with Discord and manage their
// sign-ins under Account & data, or of the superusers, who use the PocketBase dashboard.
// PocketBase fills in {APP_NAME}, {APP_URL}, {TOKEN}, {OTP}, {ALERT_INFO} and
// {RECORD:<field>} as it sends one.
func odyleMails(superusers bool) map[string]core.EmailTemplate {
	account, greeting := "your {APP_NAME} account", "Hi {RECORD:displayName},"
	alertAdvice := "If it wasn't, open <strong>Account &amp; data</strong> and choose <strong>Sign out everywhere</strong>, then secure your Discord account: {APP_NAME} signs you in with Discord."
	alertAction := [2]string{"Open Account &amp; data", "{APP_URL}/#/account"}
	if superusers {
		account, greeting = "your {APP_NAME} superuser account", ""
		alertAdvice = "If it wasn't, change your superuser password right away: that signs the account out everywhere else."
		alertAction = [2]string{"Open the PocketBase dashboard", "{APP_URL}/_/"}
	}
	confirm := "{APP_URL}/_/#/auth/"
	return map[string]core.EmailTemplate{
		"verification": odyleMail{
			subject: "Confirm your {APP_NAME} email", preview: "Confirm the email address of " + account + ".",
			eyebrow: "YOUR ACCOUNT", title: "Confirm your email", greeting: greeting,
			before: []string{"Confirm that this address belongs to " + account + "."},
			action: [2]string{"Confirm email", confirm + "confirm-verification/{TOKEN}"},
			note:   "Didn't sign up for {APP_NAME}? Ignore this email and nothing changes.",
		}.template(),
		"resetPassword": odyleMail{
			subject: "Reset your {APP_NAME} password", preview: "Choose a new password for " + account + ".",
			eyebrow: "ACCOUNT SECURITY", title: "Reset your password", greeting: greeting,
			before: []string{"Choose a new password for " + account + " with the button below. The link expires shortly."},
			action: [2]string{"Choose a new password", confirm + "confirm-password-reset/{TOKEN}"},
			note:   "Didn't ask for this? Ignore this email; your password stays as it is.",
		}.template(),
		"confirmEmailChange": odyleMail{
			subject: "Confirm your new {APP_NAME} email", preview: "Confirm this address as the new email of " + account + ".",
			eyebrow: "YOUR ACCOUNT", title: "Confirm your new email", greeting: greeting,
			before: []string{"Confirm this address as the new email of " + account + ". The link expires shortly."},
			action: [2]string{"Confirm new email", confirm + "confirm-email-change/{TOKEN}"},
			note:   "Didn't ask for this? Ignore this email; the account keeps its current address.",
		}.template(),
		"otp": odyleMail{
			subject: "Your {APP_NAME} sign-in code", preview: "Your one-time code to sign in to {APP_NAME}.",
			eyebrow: "ACCOUNT SECURITY", title: "Your sign-in code", greeting: greeting,
			before: []string{"Enter this code to finish signing in to {APP_NAME}. It works once and expires in a few minutes."},
			panel:  mailPanel{label: "ONE-TIME CODE", content: "{OTP}", code: true},
			note:   "Didn't try to sign in? Ignore this email; the code expires on its own.",
		}.template(),
		"authAlert": odyleMail{
			subject: "New sign-in to your {APP_NAME} account", preview: "Your {APP_NAME} account was signed in from a new device.",
			eyebrow: "ACCOUNT SECURITY", title: "New sign-in", greeting: greeting,
			before: []string{"Someone just signed in to " + account + " from a new device or location:"},
			panel:  mailPanel{label: "SIGN-IN DETAILS", content: "{ALERT_INFO}"},
			after:  []string{"If this was you, there's nothing to do.", alertAdvice},
			action: alertAction,
		}.template(),
	}
}

// odyleMail is what one email says; its parts are HTML.
type odyleMail struct {
	subject, preview, eyebrow, title, greeting string
	before                                     []string  // paragraphs above the panel
	panel                                      mailPanel // a code or details panel, like an invite code in the dashboard
	after                                      []string  // paragraphs below it
	action                                     [2]string // the button's label and link
	note                                       string    // small print at the end
}

type mailPanel struct {
	label, content string
	code           bool
}

// The dashboard's fonts where the mail client has them (few load web fonts), then the
// system's.
const (
	mailFont        = `'DM Sans','Segoe UI',Roboto,Helvetica,Arial,sans-serif`
	mailHeadingFont = `Manrope,'DM Sans','Segoe UI',Roboto,Helvetica,Arial,sans-serif`
)

// template lays an email out like a dashboard page on a dark card: tables and inline
// styles, which mail clients keep, within PocketBase's mail layout. The card keeps
// the dashboard's colours: the background #101514, the sidebar's #131a16, the borders
// #2a3530 and the mint #b5f2cd of the brand, the eyebrows and the primary button.
func (mail odyleMail) template() core.EmailTemplate {
	var b strings.Builder
	paragraph := func(html string) {
		b.WriteString(`<p style="margin:0 0 14px;color:#c4d2c9">` + html + `</p>`)
	}
	b.WriteString(`<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#101514;mso-hide:all">` + mail.preview + `</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td align="center" style="padding:12px 0">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#101514" style="width:100%;max-width:560px;border-collapse:separate;border:1px solid #2a3530;border-radius:12px;background:#101514;color:#eaf1ed;font-family:` + mailFont + `;font-size:14px;line-height:22px;text-align:left">
<tr><td bgcolor="#131a16" style="padding:18px 24px;border-bottom:1px solid #2a3530;border-radius:12px 12px 0 0;background:#131a16">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-family:` + mailHeadingFont + `;font-size:22px;line-height:28px;font-weight:800;letter-spacing:-1px"><a href="{APP_URL}" target="_blank" rel="noopener" style="color:#eaf1ed;text-decoration:none"><span style="color:#b5f2cd;font-size:18px;letter-spacing:0">&#9670;</span>&nbsp;odyle<span style="color:#b5f2cd">.</span></a></td>
<td align="right" style="font-size:10px;line-height:14px;font-weight:600;letter-spacing:1.7px;color:#78857d">PARTY COMMAND</td>
</tr></table>
</td></tr>
<tr><td style="padding:28px 24px 10px">
<p style="margin:0 0 8px;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1.8px;color:#92a899"><span style="color:#b5f2cd;font-size:8px">&#9670;</span>&nbsp;&nbsp;` + mail.eyebrow + `</p>
<h1 style="margin:0 0 16px;font-family:` + mailHeadingFont + `;font-size:26px;line-height:32px;font-weight:700;letter-spacing:-0.8px;color:#eaf1ed">` + mail.title + `<span style="color:#b5f2cd">.</span></h1>
`)
	if mail.greeting != "" {
		paragraph(mail.greeting)
	}
	for _, p := range mail.before {
		paragraph(p)
	}
	if mail.panel.label != "" {
		content := `font-size:12px;line-height:18px;color:#dce9df;word-break:break-word`
		if mail.panel.code {
			content = `font-family:` + mailHeadingFont + `;font-size:28px;line-height:36px;font-weight:700;letter-spacing:6px;color:#eaf1ed`
		}
		b.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 16px"><tr><td bgcolor="#111c15" style="padding:12px 14px;border:1px solid #354b3a;border-radius:6px;background:#111c15">
<p style="margin:0 0 4px;font-size:9px;line-height:12px;font-weight:600;letter-spacing:1px;color:#8eb39a">` + mail.panel.label + `</p>
<p style="margin:0;` + content + `">` + mail.panel.content + `</p>
</td></tr></table>
`)
	}
	for _, p := range mail.after {
		paragraph(p)
	}
	if label, link := mail.action[0], mail.action[1]; label != "" {
		b.WriteString(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:4px 0 16px"><tr><td bgcolor="#b5f2cd" style="border-radius:6px;background:#b5f2cd">
<a href="` + link + `" target="_blank" rel="noopener" style="display:inline-block;padding:11px 22px;border:1px solid #b5f2cd;border-radius:6px;font-family:` + mailFont + `;font-size:14px;line-height:18px;font-weight:700;color:#193223;text-decoration:none">` + label + `</a>
</td></tr></table>
<p style="margin:0 0 14px;font-size:12px;line-height:18px;color:#89958f">Button not working? Open this link:<br/><a href="` + link + `" target="_blank" rel="noopener" style="color:#b5f2cd;text-decoration:underline;word-break:break-all">` + link + `</a></p>
`)
	}
	if mail.note != "" {
		b.WriteString(`<p style="margin:0 0 14px;font-size:12px;line-height:18px;color:#89958f">` + mail.note + `</p>
`)
	}
	b.WriteString(`</td></tr>
<tr><td style="padding:16px 24px 20px;border-top:1px solid #2a3530;font-size:11px;line-height:17px;color:#74877a">Your characters, saved. Your party, private.<br/><a href="{APP_URL}" target="_blank" rel="noopener" style="color:#a6b5ab;text-decoration:none">{APP_NAME}</a> &middot; AION 2 Global &middot; Community tool</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>`)
	return core.EmailTemplate{Subject: mail.subject, Body: b.String()}
}
