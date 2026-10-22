import { saveSettings, testBillit, testEmail } from "@/app/actions";
import { ActionForm, Submit } from "@/components/client";
import { PageHeader, Section } from "@/components/ui";
import { todayIso } from "@/lib/belgium";
import { nextNumberPreview } from "@/lib/invoicing";
import { ownMachines } from "@/lib/month";
import { getStore } from "@/lib/store";
import type { Settings } from "@/lib/types";

function Field({ s, name, label, type = "text", placeholder, wide }: {
  s: Settings; name: keyof Settings; label: string; type?: string; placeholder?: string; wide?: boolean;
}) {
  const secret = type === "password";
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className="label" htmlFor={name}>{label}</label>
      <input className="input" id={name} name={name} type={type} placeholder={secret && s[name] ? "•••••••• (saved, type to change)" : placeholder}
             defaultValue={secret ? "" : s[name]} autoComplete="off" />
    </div>
  );
}

function Check({ s, name, label }: { s: Settings; name: keyof Settings; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={s[name] === "1"} className="size-4 accent-brand-700" /> {label}
    </label>
  );
}

export default async function SettingsPage() {
  const store = await getStore();
  const [s, catalog] = await Promise.all([store.settings(), store.catalog()]);
  const mine = ownMachines(s.own_machines);
  // Machines without a business in MATO Info can be yours; ones already ticked stay listed.
  const candidates = catalog.machines.filter((m) => (!m.business_id && !m.shared_business_id) || mine.has(m.id));
  return (
    <>
      <PageHeader title="Settings" />

      <Section title="Your company">
        <ActionForm action={saveSettings} className="space-y-4">
          <input type="hidden" name="section" value="company" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field s={s} name="company_name" label="Company name" />
            <Field s={s} name="company_vat" label="VAT number" placeholder="BE0123456789" />
            <Field s={s} name="company_street" label="Street + number" />
            <Field s={s} name="company_zipcode" label="Postcode" />
            <Field s={s} name="company_city" label="City" />
            <Field s={s} name="company_country" label="Country code" />
            <Field s={s} name="company_iban" label="IBAN" placeholder="BE68 5390 0754 7034" />
            <Field s={s} name="company_bic" label="BIC (optional)" />
            <Field s={s} name="company_email" label="E-mail" />
            <Field s={s} name="company_phone" label="Phone" />
            <Field s={s} name="company_website" label="Website (optional)" />
            <div>
              <label className="label" htmlFor="accent_color">Colour of your documents</label>
              <input className="h-10 w-20 rounded border border-slate-300" id="accent_color" name="accent_color" type="color" defaultValue={s.accent_color || "#0f766e"} />
            </div>
          </div>
          <Submit>Save</Submit>
        </ActionForm>
      </Section>

      <Section title="Invoices & afrekening">
        <ActionForm action={saveSettings} className="space-y-4">
          <input type="hidden" name="section" value="invoices" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field s={s} name="invoice_prefix" label="Prefix (optional)" placeholder="COM-" />
            <Field s={s} name="invoice_digits" label="Digits" type="number" />
            <Field s={s} name="invoice_next_number" label="Next number" type="number" />
            <div className="self-end pb-2"><Check s={s} name="invoice_use_year" label="Year in the number (2026-0001)" /></div>
            <Field s={s} name="invoice_vat_pct" label="VAT on your invoices (%)" type="number" />
            <Field s={s} name="invoice_due_days" label="Payment term (days)" type="number" />
          </div>
          <p className="text-sm text-slate-600">Next invoice: <strong>{nextNumberPreview(s, todayIso())}</strong>. Continue your current series
            (last invoice 2026-0045 → next number 46). If you also invoice by hand in Billit, use a prefix such as COM- so each series stays unbroken.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="invoice_vat_note">VAT note (optional)</label>
              <textarea className="input" id="invoice_vat_note" name="invoice_vat_note" rows={2} defaultValue={s.invoice_vat_note} />
            </div>
            <div>
              <label className="label" htmlFor="invoice_footer">Extra text at the bottom (optional)</label>
              <textarea className="input" id="invoice_footer" name="invoice_footer" rows={2} defaultValue={s.invoice_footer} />
            </div>
          </div>
          <Check s={s} name="statement_list_sales" label="List every single sale at the end of the afrekening" />
          <Submit>Save</Submit>
        </ActionForm>
      </Section>

      <div id="billit" />
      <Section title="Billit / Peppol">
        <p className="mb-4 text-sm text-slate-600">
          Each invoice is created in your Billit account and sent over Peppol. You need the <strong>API key</strong> and
          <strong> Party ID</strong> from Billit. Test first in the <strong>sandbox</strong> with a sandbox key (my.sandbox.billit.be).
        </p>
        <ActionForm action={saveSettings} className="space-y-4">
          <input type="hidden" name="section" value="billit" />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="billit_env">Environment</label>
              <select className="input" id="billit_env" name="billit_env" defaultValue={s.billit_env}>
                <option value="sandbox">Sandbox (test, nothing reaches clients)</option>
                <option value="production">Production (real Peppol invoices)</option>
              </select>
            </div>
            <Field s={s} name="billit_api_key" label="API key" type="password" />
            <Field s={s} name="billit_party_id" label="Party ID" />
          </div>
          <Check s={s} name="billit_attach_pdf" label="Embed my own invoice PDF in the Peppol invoice" />
          <Submit>Save</Submit>
        </ActionForm>
        <ActionForm action={testBillit} className="mt-4"><Submit className="btn-secondary">Test connection</Submit></ActionForm>
      </Section>

      <div id="email" />
      <Section title="E-mail">
        <p className="mb-4 text-sm text-slate-600">
          Afrekeningen and invoices are e-mailed from your own mailbox. For Gmail, turn on 2-step verification and make an
          <strong> app password</strong> (Google account → Security → App passwords). Server smtp.gmail.com, port 587.
        </p>
        <ActionForm action={saveSettings} className="space-y-4">
          <input type="hidden" name="section" value="email" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field s={s} name="smtp_host" label="SMTP server" placeholder="smtp.gmail.com" />
            <Field s={s} name="smtp_port" label="Port (587 or 465)" type="number" />
            <Field s={s} name="smtp_user" label="Login (usually your e-mail)" />
            <Field s={s} name="smtp_password" label="Password / app password" type="password" />
            <Field s={s} name="smtp_from_name" label="Sender name" />
            <Field s={s} name="smtp_from_email" label="Sender e-mail" />
            <Field s={s} name="mail_subject" label="Subject" wide />
            <div className="sm:col-span-2">
              <label className="label" htmlFor="mail_body">Message</label>
              <textarea className="input font-mono" id="mail_body" name="mail_body" rows={10} defaultValue={s.mail_body} />
              <p className="mt-1 text-xs text-slate-500">Placeholders: {"{klant} {maand} {omzet} {verkopen} {uitbetaling} {factuurnummer} {bedrag} {vervaldatum} {commissie} {mededeling} {bedrijf} {factuur_zin}"}</p>
            </div>
          </div>
          <Check s={s} name="smtp_bcc_self" label="Send me a copy (BCC) of every e-mail" />
          <Submit>Save</Submit>
        </ActionForm>
        <ActionForm action={testEmail} className="mt-4"><Submit className="btn-secondary">Send a test e-mail to myself</Submit></ActionForm>
      </Section>

      <Section title="Your own machines">
        <p className="mb-4 text-sm text-slate-600">
          Machines that are yours, without a client. Their sales go on no afrekening and are not reported as missing on
          Close the month. Only machines without a business in MATO Info are listed.
        </p>
        {candidates.length ? (
          <ActionForm action={saveSettings} className="space-y-4">
            <input type="hidden" name="section" value="own" />
            <div className="grid gap-1 sm:grid-cols-2">
              {candidates.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="own_machines" value={m.id} defaultChecked={mine.has(m.id)} className="size-4 accent-brand-700" />
                  {m.name} {m.serial && <span className="font-mono text-xs text-slate-500">{m.serial}</span>}
                </label>
              ))}
            </div>
            <Submit>Save</Submit>
          </ActionForm>
        ) : (
          <p className="text-sm text-slate-500">Every machine has a business in MATO Info.</p>
        )}
      </Section>

      <Section title="Your data">
        <p className="text-sm text-slate-600">
          Sales are read live from MATO Info (Mato Vending only). Clients, contracts, invoices and afrekeningen are stored in the
          same database, in the fact_ tables, readable only by the owner account. Every afrekening and invoice keeps its own copy
          of the figures, so a PDF never changes after it was made.
        </p>
      </Section>
    </>
  );
}
