import { deleteExtraLine, deleteManualSales, makeDocuments, saveExtraLine, saveManualSales, sendDocuments, setPaidOut } from "@/app/actions";
import { ActionForm, MonthPicker, Submit, ToggleAll } from "@/components/client";
import { Badge, Notice, PageHeader, Section, Status, TableWrap, TextLink } from "@/components/ui";
import { currentPeriod, defaultPeriod, fmtDate, fmtEur, formatIban, monthsFrom, periodLabel, sumMoney, todayIso } from "@/lib/belgium";
import { nextNumberPreview } from "@/lib/invoicing";
import { clientTerminals, loadOverview } from "@/lib/month";
import { getStore } from "@/lib/store";

export const maxDuration = 60;

export default async function MonthPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const store = await getStore();
  const settings = await store.settings();
  const periods = monthsFrom(settings.start_period);
  const period = m && periods.includes(m) ? m : defaultPeriod(settings.start_period);
  const [overview, allInvoices] = await Promise.all([loadOverview(store, period), store.invoices()]);
  const labels = Object.fromEntries(periods.map((p) => [p, periodLabel(p)]));
  const rows = [...overview.rows].sort((a, b) => a.client.name.localeCompare(b.client.name));
  const today = todayIso();
  const lastInvoice = allInvoices.reduce<(typeof allInvoices)[number] | null>((a, b) => (!a || b.invoice_date > a.invoice_date ? b : a), null);
  const docs = rows.filter((r) => r.statement || r.invoice);
  const env = settings.billit_env || "sandbox";
  const hasBillit = Boolean(settings.billit_api_key && settings.billit_party_id);
  const hasMail = Boolean(settings.smtp_host);
  // Clients with their own terminal received the money themselves: nothing to pay out.
  const payouts = rows.filter((r) => r.statement && !r.client.own_terminal);
  const open = sumMoney(payouts.filter((r) => !r.statement!.paid_out).map((r) => Number(r.statement!.payout)));
  const clientNames = new Map(overview.clients.map((c) => [c.id, c.name]));
  const activeClients = overview.clients.filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name));

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
      <Section title="Own sales figures" aside={<span className="text-sm text-slate-500">Instead of MATO Info, for one month</span>}>
        {overview.manual.length > 0 && (
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Client</th><th className="num">Sales incl. VAT</th><th className="num">Number of sales</th><th>Source</th><th /></tr>
              </thead>
              <tbody>
                {overview.manual.map((m) => (
                  <tr key={m.id}>
                    <td className="font-medium">{clientNames.get(m.client_id) ?? m.client_id}</td>
                    <td className="num">{fmtEur(m.amount)}</td>
                    <td className="num">{m.items}</td>
                    <td>{m.note}</td>
                    <td>
                      <ActionForm action={deleteManualSales}>
                        <input type="hidden" name="id" value={m.id} />
                        <Submit className="text-xs text-red-700 underline" confirm="Remove this figure? The MATO Info sales count again.">Remove</Submit>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <details className={overview.manual.length ? "mt-4" : ""}>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">Enter a client&apos;s sales yourself (e.g. from Televend)</summary>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            For a month in which MATO Info misses sales of a client, for example when a terminal was connected halfway through the
            month. Your figure replaces all of that client&apos;s MATO Info sales for {periodLabel(period)}: in the commission, the
            payout, the afrekening and the e-mail. The afrekening says the figures come from the source you fill in. Clients with their
            own payment terminal (Clients page) are not in MATO Info: enter their figure here every month.
          </p>
          <ActionForm action={saveManualSales} className="mt-3">
            <input type="hidden" name="period" value={period} />
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="m-client">Client</label>
                <select className="input" id="m-client" name="client_id" defaultValue="" required>
                  <option value="" disabled>Choose…</option>
                  {activeClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="m-amount">Sales incl. VAT (€)</label>
                <input className="input w-36" id="m-amount" name="amount" inputMode="decimal" placeholder="0,00" required />
              </div>
              <div>
                <label className="label" htmlFor="m-items">Number of sales</label>
                <input className="input w-28" id="m-items" name="items" type="number" min="0" step="1" defaultValue="0" />
              </div>
              <div>
                <label className="label" htmlFor="m-note">Source</label>
                <input className="input w-40" id="m-note" name="note" defaultValue="Televend" />
              </div>
              <Submit>Save figure</Submit>
            </div>
          </ActionForm>
        </details>
      </Section>

      <Section title="Extra charges" aside={<span className="text-sm text-slate-500">One-off lines on the commission invoice</span>}>
        {overview.extras.length > 0 && (
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Client</th><th>Description</th><th className="num">Quantity</th><th className="num">Price excl. VAT</th><th className="num">Total</th><th /></tr>
              </thead>
              <tbody>
                {overview.extras.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium">{clientNames.get(e.client_id) ?? e.client_id}</td>
                    <td>{e.description}</td>
                    <td className="num">{e.quantity}</td>
                    <td className="num">{fmtEur(e.unit_price)}</td>
                    <td className="num">{fmtEur(Math.round(e.quantity * e.unit_price * 100) / 100)}</td>
                    <td>
                      <ActionForm action={deleteExtraLine}>
                        <input type="hidden" name="id" value={e.id} />
                        <Submit className="text-xs text-red-700 underline" confirm="Remove this charge?">Remove</Submit>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <details className={overview.extras.length ? "mt-4" : ""}>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">Add a charge (start-up fee, configuration hours, parts…)</summary>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Added as its own line to the client&apos;s commission invoice for {periodLabel(period)}, with VAT. Add it before you make
            the invoice: an invoice that was made does not change.
          </p>
          <ActionForm action={saveExtraLine} className="mt-3">
            <input type="hidden" name="period" value={period} />
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="x-client">Client</label>
                <select className="input" id="x-client" name="client_id" defaultValue="" required>
                  <option value="" disabled>Choose…</option>
                  {activeClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="min-w-64 flex-1">
                <label className="label" htmlFor="x-description">Description (on the invoice)</label>
                <input className="input" id="x-description" name="description" placeholder="Eenmalige opstartkost" required />
              </div>
              <div>
                <label className="label" htmlFor="x-quantity">Quantity</label>
                <input className="input w-24" id="x-quantity" name="quantity" inputMode="decimal" defaultValue="1" />
              </div>
              <div>
                <label className="label" htmlFor="x-price">Price excl. VAT (€)</label>
                <input className="input w-32" id="x-price" name="unit_price" inputMode="decimal" placeholder="0,00" required />
              </div>
              <Submit>Add charge</Submit>
            </div>
          </ActionForm>
        </details>
      </Section>

      <Section step="1" title="Afrekeningen and commission invoices"
               aside={<span className="text-sm text-slate-500">Sales come live from MATO Info</span>}>
        {!rows.length && !overview.own.length ? (
          <p className="text-sm text-slate-500">No client has sales or a running contract in {periodLabel(period)}.</p>
        ) : (
          <ActionForm action={makeDocuments}>
            <input type="hidden" name="period" value={period} />
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th><ToggleAll name="client" /></th><th>Client</th><th className="num">Sales</th><th>Contract(s)</th>
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
                        <td>
                          <div className="font-medium">{r.client.name}</div>
                          <div className="font-mono text-xs text-slate-500">
                            {clientTerminals(r.client, overview.catalog, overview.daily).map((t) => t.serial).join(", ")}
                          </div>
                        </td>
                        <td className="num">
                          {fmtEur(r.calc.sales_total)}
                          {r.client.own_terminal && <div className="text-xs text-slate-500">own terminal, no payout</div>}
                          {r.calc.fee_deducted > 0 && (
                            <div className="text-xs text-slate-500" title="After the transaction costs">payout {fmtEur(r.calc.payout)}</div>
                          )}
                          {r.manual && <div title={r.manual.note}><Badge tone="sky">own figure</Badge></div>}
                        </td>
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
                {overview.own.length > 0 && (
                  <tbody className="border-t-2 border-slate-200">
                    {overview.own.map((o) => (
                      <tr key={o.key} className="text-slate-600">
                        <td />
                        <td>
                          <div className="font-medium">{o.label}</div>
                          <div className="font-mono text-xs text-slate-500">{o.terminals.join(", ")}</div>
                        </td>
                        <td className="num">{fmtEur(o.revenue)}</td>
                        <td>Your own: no commission, no afrekening</td>
                        <td className="num text-slate-400">-</td>
                        <td colSpan={4} />
                      </tr>
                    ))}
                  </tbody>
                )}
                <tfoot>
                  <tr className="font-semibold">
                    <td /><td>Total</td><td className="num">{fmtEur(sumMoney([...rows.map((r) => r.calc.sales_total), ...overview.own.map((o) => o.revenue)]))}</td><td />
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
                <tfoot>
                  <tr className="font-semibold">
                    <td /><td>Total</td><td /><td />
                    <td className="num">{fmtEur(sumMoney(docs.map((r) => (r.invoice ? Number(r.invoice.total) : 0))))}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
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
              <tfoot>
                <tr className="font-semibold">
                  <td>Total</td><td />
                  <td className="num">{fmtEur(sumMoney(payouts.map((r) => Number(r.statement!.payout))))}</td>
                  <td />
                  <td className="text-sm font-normal text-slate-500">still to pay out: {fmtEur(open)}</td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Section>
    </>
  );
}
