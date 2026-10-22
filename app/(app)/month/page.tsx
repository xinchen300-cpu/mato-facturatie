import { makeDocuments, sendDocuments, setPaidOut } from "@/app/actions";
import { ActionForm, MonthPicker, Submit, ToggleAll } from "@/components/client";
import { Badge, Notice, PageHeader, Section, Status, TableWrap, TextLink } from "@/components/ui";
import { currentPeriod, fmtDate, fmtEur, formatIban, lastCompletePeriod, periodLabel, recentPeriods, sumMoney, todayIso } from "@/lib/belgium";
import { nextNumberPreview } from "@/lib/invoicing";
import { loadOverview } from "@/lib/month";
import { getStore } from "@/lib/store";

export const maxDuration = 60;

export default async function MonthPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const periods = recentPeriods(24);
  const period = m && periods.includes(m) ? m : lastCompletePeriod();
  const store = await getStore();
  const [overview, settings, allInvoices] = await Promise.all([loadOverview(store, period), store.settings(), store.invoices()]);
  const labels = Object.fromEntries(periods.map((p) => [p, periodLabel(p)]));
  const rows = [...overview.rows].sort((a, b) => a.client.name.localeCompare(b.client.name));
  const today = todayIso();
  const lastInvoice = allInvoices.reduce<(typeof allInvoices)[number] | null>((a, b) => (!a || b.invoice_date > a.invoice_date ? b : a), null);
  const docs = rows.filter((r) => r.statement || r.invoice);
  const env = settings.billit_env || "sandbox";
  const hasBillit = Boolean(settings.billit_api_key && settings.billit_party_id);
  const hasMail = Boolean(settings.smtp_host);
  const payouts = rows.filter((r) => r.statement);
  const open = sumMoney(payouts.filter((r) => !r.statement!.paid_out).map((r) => Number(r.statement!.payout)));

  return (
    <>
      <PageHeader title="Close the month">
        <MonthPicker periods={periods} value={period} labels={labels} />
        <a className="btn-secondary" href={`/api/excel/${period}`}>Excel</a>
      </PageHeader>

      {period === currentPeriod() && (
        <Notice kind="warning">{periodLabel(period)} is still running. Sales come straight from MATO Info; close the month after it ends.</Notice>
      )}
      {overview.unassigned.length > 0 && (
        <Notice kind="warning">
          Sales not on anyone&apos;s afrekening: {overview.unassigned.map((u) => `${u.label} (${fmtEur(u.revenue)})`).join(", ")}.
        </Notice>
      )}

      <Section step="1" title="Afrekeningen and commission invoices"
               aside={<span className="text-sm text-slate-500">Sales come live from MATO Info</span>}>
        {!rows.length ? (
          <p className="text-sm text-slate-500">No client has sales or a running contract in {periodLabel(period)}.</p>
        ) : (
          <ActionForm action={makeDocuments}>
            <input type="hidden" name="period" value={period} />
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th><ToggleAll name="client" /></th><th>Client</th><th className="num">Sales = payout</th><th>Contract(s)</th>
                    <th className="num">Commission</th><th className="num">Incl. {overview.vatPct}% VAT</th><th>Invoice</th><th>Afrekening</th><th>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const sent = r.statement?.email_status === "sent";
                    const todo = !r.statement && (r.calc.sales_total > 0 || r.calc.subtotal > 0);
                    return (
                      <tr key={r.client.id}>
                        <td><input type="checkbox" name="client" value={r.client.id} defaultChecked={todo} disabled={sent} className="size-4 accent-brand-700" /></td>
                        <td className="font-medium">{r.client.name}</td>
                        <td className="num">{fmtEur(r.calc.sales_total)}</td>
                        <td className="min-w-48 text-slate-600">{r.calc.deal || <span className="text-amber-700">no contract</span>}</td>
                        <td className="num">{fmtEur(r.calc.subtotal)}</td>
                        <td className="num">{fmtEur(r.total)}</td>
                        <td className="whitespace-nowrap">{r.invoice?.number ?? ""}</td>
                        <td>{sent ? <Badge tone="green">Sent</Badge> : r.statement ? <Badge tone="sky">Made</Badge> : ""}</td>
                        <td className="min-w-48 text-xs text-amber-800">{r.issues.join(", ")}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td /><td>Total</td><td className="num">{fmtEur(sumMoney(rows.map((r) => r.calc.sales_total)))}</td><td />
                    <td className="num">{fmtEur(sumMoney(rows.map((r) => r.calc.subtotal)))}</td><td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="date">Date of the documents</label>
                <input className="input" id="date" name="date" type="date" defaultValue={today} required />
              </div>
              <div className="text-sm text-slate-500">First invoice number: <strong>{nextNumberPreview(settings, today)}</strong></div>
              <Submit>Make afrekeningen and invoices</Submit>
            </div>
            {lastInvoice && lastInvoice.invoice_date > today && (
              <p className="mt-2 text-xs text-amber-800">Invoice {lastInvoice.number} is dated {fmtDate(lastInvoice.invoice_date)}: Belgian invoice numbers must follow the date order.</p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Ticked clients get an afrekening (rebuilt while not e-mailed) and, when their contracts charge something, one commission invoice.
              No contract? Add it on <TextLink href="/contracts">Contracts</TextLink> first.
            </p>
          </ActionForm>
        )}
      </Section>

      <Section step="2" title="Send">
        {!docs.length ? (
          <p className="text-sm text-slate-500">The afrekeningen and invoices you make appear here.</p>
        ) : (
          <ActionForm action={sendDocuments}>
            <input type="hidden" name="period" value={period} />
            {!hasBillit && <Notice>Billit is not connected yet, so Peppol is off (<TextLink href="/settings#billit">Settings</TextLink>).</Notice>}
            {hasBillit && env !== "production" && (
              <Notice>🧪 Billit is in <strong>sandbox (test) mode</strong>: invoices do not reach your clients. Switch to production in Settings when ready.</Notice>
            )}
            {!hasMail && <Notice>E-mail is not set up yet (<TextLink href="/settings#email">Settings</TextLink>).</Notice>}
            <TableWrap>
              <table className="table">
                <thead>
                  <tr><th><ToggleAll name="client" /></th><th>Client</th><th>E-mail to</th><th>Invoice</th><th className="num">Total</th><th>Peppol</th><th>E-mail</th><th>PDF</th></tr>
                </thead>
                <tbody>
                  {docs.map((r) => {
                    const emailStatus = (r.statement ?? r.invoice)!.email_status;
                    const pending = emailStatus !== "sent" || (r.invoice && r.invoice.peppol_status !== "sent");
                    return (
                      <tr key={r.client.id}>
                        <td><input type="checkbox" name="client" value={r.client.id} defaultChecked={Boolean(pending)} className="size-4 accent-brand-700" /></td>
                        <td className="font-medium">{r.client.name}</td>
                        <td className="text-slate-600">{r.client.email || <span className="text-amber-700">missing</span>}</td>
                        <td className="whitespace-nowrap">{r.invoice?.number ?? <span className="text-slate-400">no invoice</span>}</td>
                        <td className="num">{r.invoice ? fmtEur(r.invoice.total) : ""}</td>
                        <td>{r.invoice ? <Status kind="peppol" value={r.invoice.peppol_status} /> : ""}</td>
                        <td><Status kind="email" value={emailStatus} /></td>
                        <td className="whitespace-nowrap space-x-2">
                          {r.statement && <a className="text-brand-700 underline" href={`/api/pdf/statement/${r.statement.id}`} target="_blank">Afrekening</a>}
                          {r.invoice && <a className="text-brand-700 underline" href={`/api/pdf/invoice/${r.invoice.id}`} target="_blank">Factuur</a>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            {docs.flatMap((r) => [
              r.invoice?.peppol_status === "error" ? `${r.client.name} · Peppol: ${r.invoice.peppol_message}` : null,
              (r.statement ?? r.invoice)?.email_status === "error" ? `${r.client.name} · E-mail: ${(r.statement ?? r.invoice)!.email_message}` : null,
            ]).filter(Boolean).map((text) => <p key={text} className="mt-2 text-sm text-red-700">{text}</p>)}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Submit name="intent" value="both" disabled={!hasBillit && !hasMail}>Send via Peppol + e-mail</Submit>
              <Submit name="intent" value="peppol" className="btn-secondary" disabled={!hasBillit}>Peppol only</Submit>
              <Submit name="intent" value="email" className="btn-secondary" disabled={!hasMail}>E-mail only</Submit>
              <label className="ml-2 flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" name="resend" className="size-4 accent-brand-700" /> Also re-send what was already sent
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500">Each client gets one e-mail with the afrekening and the commission invoice.</p>
          </ActionForm>
        )}
      </Section>

      <Section step="3" title="Pay out" aside={payouts.length ? <span className="text-sm text-slate-500">Still to pay out: <strong>{fmtEur(open)}</strong></span> : null}>
        {!payouts.length ? (
          <p className="text-sm text-slate-500">After making the afrekeningen, the amounts to pay out appear here.</p>
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Client</th><th>IBAN</th><th className="num">To pay out</th><th>Commission invoice</th><th>Paid out</th></tr></thead>
              <tbody>
                {payouts.map((r) => {
                  const s = r.statement!;
                  return (
                    <tr key={s.id}>
                      <td className="font-medium">{r.client.name}</td>
                      <td className="whitespace-nowrap font-mono text-xs">{formatIban(r.client.iban) || <span className="font-sans text-amber-700">IBAN missing</span>}</td>
                      <td className="num">{fmtEur(Number(s.payout))}</td>
                      <td>{r.invoice?.number ?? ""}</td>
                      <td>
                        <ActionForm action={setPaidOut} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="value" value={s.paid_out ? "0" : "1"} />
                          {s.paid_out && <Badge tone="green">{fmtDate(s.paid_out_on)}</Badge>}
                          <Submit className="btn-secondary px-2 py-1 text-xs">{s.paid_out ? "Undo" : "Mark paid out"}</Submit>
                        </ActionForm>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </>
  );
}
