import Link from "next/link";

import { removeInvoice, sendTestEmail, setPaid } from "@/app/actions";
import { ActionForm, Submit } from "@/components/client";
import { Badge, Kpi, PageHeader, Section, Status, TableWrap } from "@/components/ui";
import { fmtDate, fmtEur, periodLabel, sumMoney, todayIso } from "@/lib/belgium";
import { getStore } from "@/lib/store";

const FILTERS = ["all", "open", "overdue", "paid"] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; year?: string }> }) {
  const params = await searchParams;
  const status = FILTERS.includes(params.status as (typeof FILTERS)[number]) ? params.status! : "all";
  const store = await getStore();
  const [invoices, clients, statements] = await Promise.all([store.invoices(), store.clients(), store.statements()]);
  const today = todayIso();
  const years = [...new Set(invoices.map((i) => i.year))].sort((a, b) => b - a);
  const year = params.year ? Number(params.year) : null;
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const view = invoices.filter((i) =>
    (!year || i.year === year) &&
    (status === "all" || (status === "paid" && i.paid) || (status === "open" && !i.paid) ||
     (status === "overdue" && !i.paid && i.due_date < today)));
  const latestUnsent = new Set(years.map((y) => invoices.filter((i) => i.year === y).sort((a, b) => b.seq - a.seq)[0])
    .filter((i) => i && i.peppol_status !== "sent" && i.email_status !== "sent").map((i) => i!.id));
  const link = (next: Record<string, string | number | null>) => {
    const q = new URLSearchParams();
    const merged = { status, year, ...next };
    if (merged.status && merged.status !== "all") q.set("status", String(merged.status));
    if (merged.year) q.set("year", String(merged.year));
    return `/invoices${q.size ? `?${q}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Invoices" />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Invoiced incl. VAT" value={fmtEur(sumMoney(view.map((i) => i.total)))} />
        <Kpi label="Still to be paid" value={fmtEur(sumMoney(view.filter((i) => !i.paid).map((i) => i.total)))} />
        <Kpi label="Overdue" value={String(view.filter((i) => !i.paid && i.due_date < today).length)} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link key={f} href={link({ status: f })} className={`rounded-full px-3 py-1 ${status === f ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
            {f[0].toUpperCase() + f.slice(1)}
          </Link>
        ))}
        <span className="mx-2 text-slate-300">|</span>
        <Link href={link({ year: null })} className={`rounded-full px-3 py-1 ${!year ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>All years</Link>
        {years.map((y) => (
          <Link key={y} href={link({ year: y })} className={`rounded-full px-3 py-1 ${year === y ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>{y}</Link>
        ))}
      </div>
      <Section title={`${view.length} invoice(s)`}>
        {!view.length ? <p className="text-sm text-slate-500">No invoices here yet. Make them on Close the month.</p> : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Invoice</th><th>Date</th><th>Client</th><th>Month</th><th className="num">Total</th><th>Due</th><th>Peppol</th><th>E-mail</th><th>Paid</th><th /></tr>
              </thead>
              <tbody>
                {view.map((i) => {
                  const statement = statements.find((s) => s.client_id === i.client_id && s.period === i.period);
                  const overdue = !i.paid && i.due_date < today;
                  return (
                    <tr key={i.id}>
                      <td className="whitespace-nowrap font-medium">{i.number}</td>
                      <td className="whitespace-nowrap">{fmtDate(i.invoice_date)}</td>
                      <td>{names.get(i.client_id) ?? i.snapshot.client.name}</td>
                      <td className="whitespace-nowrap">{periodLabel(i.period)}</td>
                      <td className="num">{fmtEur(i.total)}</td>
                      <td className="whitespace-nowrap">{overdue ? <Badge tone="red">{fmtDate(i.due_date)}</Badge> : fmtDate(i.due_date)}</td>
                      <td><Status kind="peppol" value={i.peppol_status} /></td>
                      <td><Status kind="email" value={i.email_status} /></td>
                      <td>
                        <ActionForm action={setPaid} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="value" value={i.paid ? "0" : "1"} />
                          {i.paid && <Badge tone="green">{fmtDate(i.paid_on)}</Badge>}
                          <Submit className="btn-secondary px-2 py-1 text-xs">{i.paid ? "Undo" : "Mark paid"}</Submit>
                        </ActionForm>
                      </td>
                      <td className="whitespace-nowrap text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <a className="text-brand-700 underline" href={`/api/pdf/invoice/${i.id}`} target="_blank">PDF</a>
                          {statement && <a className="text-brand-700 underline" href={`/api/pdf/statement/${statement.id}`} target="_blank">Afrekening</a>}
                          <ActionForm action={sendTestEmail}>
                            <input type="hidden" name="client" value={i.client_id} />
                            <input type="hidden" name="period" value={i.period} />
                            <Submit className="text-xs text-slate-600 underline">Test e-mail to me</Submit>
                          </ActionForm>
                          {latestUnsent.has(i.id) && (
                            <ActionForm action={removeInvoice}>
                              <input type="hidden" name="id" value={i.id} />
                              <Submit className="text-xs text-red-700 underline" confirm={`Delete invoice ${i.number}? The number will be used again.`}>Delete</Submit>
                            </ActionForm>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <p className="mt-3 text-xs text-slate-500">To correct a sent invoice, make a credit note (creditnota) in Billit and invoice again. Only the latest unsent invoice can be deleted, so the numbering has no gaps.</p>
      </Section>
    </>
  );
}
