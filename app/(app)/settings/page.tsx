import { saveHealthIndex, saveSettings, testBillit, testEmail } from "@/app/actions";
import { ActionForm, Submit } from "@/components/client";
import { PageHeader, Section } from "@/components/ui";
import { currentPeriod, fmtDate, periodLabel, previousPeriod, todayIso } from "@/lib/belgium";
import { indexMonths } from "@/lib/contracts";
import { nextNumberPreview } from "@/lib/invoicing";
import { ownBusinesses, ownMachines } from "@/lib/month";
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

/** The Belgian calendar day of a timestamp, as YYYY-MM-DD. */
const brusselsDay = (ts: string) => new Date(ts).toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });

export default async function SettingsPage() {
  const store = await getStore();
  const [s, catalog, contracts, clients, healthIndex, slotRules] = await Promise.all([
    store.settings(), store.catalog(), store.contracts(), store.clients(), store.healthIndex(), store.slotRules(),
  ]);
  // The health index months the indexed contracts need, up to this month, and when each is indexed next.
  const now = currentPeriod();
  const indexed = contracts.filter((c) => c.indexed && (!c.ends_on || c.ends_on.slice(0, 7) >= now));
  const needed = new Set<string>();
  const plans = indexed.map((c) => {
    const at = indexMonths(c, now)!;
    needed.add(at.base);
    if (at.current) needed.add(at.current);
    const next = at.since ? `${Number(at.since.slice(0, 4)) + 1}${at.since.slice(4)}` : at.first;
    return { contract: c, client: clients.find((x) => x.id === c.client_id)?.name ?? "", base: at.base, next };
  });
  const indexMonthsShown = [...new Set([...needed, ...Object.keys(healthIndex)])].sort().reverse();
  const mine = ownMachines(s.own_machines);
  const mineBusinesses = ownBusinesses(s.own_businesses);
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
              <p className="mt-1 text-xs text-slate-500">Placeholders: {"{klant} {maand} {omzet} {verkopen} {uitbetaling} {aftrek_zin} {factuurnummer} {bedrag} {vervaldatum} {commissie} {mededeling} {bedrijf} {factuur_zin}"}</p>
            </div>
          </div>
          <Check s={s} name="smtp_bcc_self" label="Send me a copy (BCC) of every e-mail" />
          <Submit>Save</Submit>
        </ActionForm>
        <ActionForm action={testEmail} className="mt-4"><Submit className="btn-secondary">Send a test e-mail to myself</Submit></ActionForm>
      </Section>

      <Section title="Health index (gezondheidsindex)">
        <p className="mb-4 max-w-3xl text-sm text-slate-600">
          Contracts marked &ldquo;index yearly&rdquo; follow the Belgian health index: the start index is the month before the
          contract started; from each anniversary the amounts follow the index of the month before. Fill in the values
          published by{" "}
          <a className="text-brand-700 underline" href="https://statbel.fgov.be/nl/themas/consumptieprijsindex/gezondheidsindex" target="_blank" rel="noreferrer">Statbel</a>{" "}
          (base 2013 = 100). Close the month warns when one is missing.
        </p>
        {plans.length > 0 && (
          <ul className="mb-4 space-y-1 text-sm">
            {plans.map((p) => (
              <li key={p.contract.id}>
                <span className="font-medium">{p.client}</span>: start index {periodLabel(p.base)}, next indexation{" "}
                {periodLabel(p.next)} (index of {periodLabel(previousPeriod(p.next))})
              </li>
            ))}
          </ul>
        )}
        {indexMonthsShown.length ? (
          <ActionForm action={saveHealthIndex} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {indexMonthsShown.map((m) => (
                <div key={m}>
                  <label className="label" htmlFor={`idx-${m}`}>{periodLabel(m)}</label>
                  <input className="input" id={`idx-${m}`} name={`idx:${m}`} inputMode="decimal" placeholder={needed.has(m) ? "needed" : ""}
                         defaultValue={healthIndex[m] ? String(healthIndex[m]) : ""} />
                </div>
              ))}
            </div>
            <Submit>Save</Submit>
          </ActionForm>
        ) : (
          <p className="text-sm text-slate-500">No contract is indexed yet.</p>
        )}
      </Section>

      <Section title="Your own sales">
        <p className="mb-4 max-w-3xl text-sm text-slate-600">
          Products that are yours, without a client: a business in MATO Info that is really you (also on a shared machine),
          or a machine without a business. Their sales go on no afrekening and are not reported as missing on Close the
          month; they are listed there as your own.
        </p>
        <ActionForm action={saveSettings} className="space-y-4">
          <input type="hidden" name="section" value="own" />
          <div>
            <span className="label">Businesses in MATO Info that are your own products</span>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.businesses.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="own_businesses" value={`business:${b.id}`} defaultChecked={mineBusinesses.has(`business:${b.id}`)}
                         className="size-4 accent-brand-700" />
                  {b.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="label">Machines without a business that are yours</span>
            {candidates.length ? (
              <div className="grid gap-1 sm:grid-cols-2">
                {candidates.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="own_machines" value={m.id} defaultChecked={mine.has(m.id)} className="size-4 accent-brand-700" />
                    {m.name} {m.serial && <span className="font-mono text-xs text-slate-500">{m.serial}</span>}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Every machine has a business in MATO Info.</p>
            )}
          </div>
          <Submit>Save</Submit>
        </ActionForm>
        {slotRules.length > 0 && (
          <div className="mt-6">
            <span className="label">Slot rules (also for slots missing from the MATO Info layout)</span>
            <ul className="space-y-1 text-sm text-slate-600">
              {slotRules.map((r) => (
                <li key={r.id}>
                  {catalog.machines.find((m) => m.id === r.machine_id)?.name ?? "Machine"}: slots {r.slot_from}-{r.slot_to} count for{" "}
                  <strong>{catalog.businesses.find((b) => b.id === r.business_id)?.name ?? "?"}</strong> from {fmtDate(brusselsDay(r.valid_from))}
                  {r.valid_to ? ` until ${fmtDate(brusselsDay(r.valid_to))}` : ""}
                </li>
              ))}
            </ul>
          </div>
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
