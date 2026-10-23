import { MonthPicker } from "@/components/client";
import { Kpi, Notice, PageHeader, Section, TableWrap, TextLink } from "@/components/ui";
import { addDays, defaultPeriod, fmtEur, fmtNum, monthBounds, monthsFrom, periodLabel, previousPeriod, roundMoney } from "@/lib/belgium";
import { loadOverview, totals } from "@/lib/month";
import { getStore } from "@/lib/store";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const store = await getStore();
  const settings = await store.settings();
  // Nothing before the first month (Settings): no months to pick, no older sales in the chart.
  const periods = monthsFrom(settings.start_period);
  const period = m && periods.includes(m) ? m : defaultPeriod(settings.start_period);
  const prev = previousPeriod(period);
  const shown = periods.slice(0, 12);
  const yearStart = monthBounds(shown[shown.length - 1]).first;
  const [overview, contracts, history] = await Promise.all([
    loadOverview(store, period), store.contracts(),
    store.salesDaily(yearStart, addDays(monthBounds(periods[0]).last, 0)),
  ]);
  const totalsClients = totals(overview.rows);
  // Your own machines count in the month's sales and items, not in the commission.
  const sum = {
    ...totalsClients,
    sales: roundMoney(totalsClients.sales + overview.own.reduce((a, o) => a + o.revenue, 0)),
    items: totalsClients.items + overview.own.reduce((a, o) => a + o.items, 0),
  };
  const prevSales = roundMoney(history.filter((r) => r.day.startsWith(prev)).reduce((a, r) => a + Number(r.revenue), 0));
  const delta = prevSales && periods.includes(prev) ? ((sum.sales - prevSales) / prevSales) * 100 : null;
  const made = overview.rows.filter((r) => r.statement).length;
  const months = [...shown].reverse().map((p) => ({
    period: p, revenue: roundMoney(history.filter((r) => r.day.startsWith(p)).reduce((a, r) => a + Number(r.revenue), 0)),
  }));
  const peak = Math.max(...months.map((x) => x.revenue), 1);
  const labels = Object.fromEntries(periods.map((p) => [p, periodLabel(p)]));

  const steps: [boolean, string, string][] = [
    [Boolean(settings.company_name && settings.company_vat && settings.company_iban), "Fill in your company details", "/settings"],
    [overview.clients.every((c) => !c.active || (c.iban && c.email && c.vat_number)), "Complete your clients: VAT number, address, e-mail, IBAN", "/clients"],
    [contracts.length > 0, "Enter your contracts", "/contracts"],
    [Boolean(settings.billit_api_key), "Connect Billit for Peppol", "/settings#billit"],
    [Boolean(settings.smtp_host), "Set up e-mail sending", "/settings#email"],
  ];

  return (
    <>
      <PageHeader title="Dashboard">
        <MonthPicker periods={periods} value={period} labels={labels} />
      </PageHeader>

      {steps.some(([done]) => !done) && (
        <Section title="Getting started">
          <ul className="space-y-2 text-sm">
            {steps.map(([done, text, href]) => (
              <li key={text} className="flex items-center gap-2">
                <span>{done ? "✅" : "⬜"}</span>
                {done ? <span className="text-slate-400 line-through">{text}</span> : <TextLink href={href}>{text}</TextLink>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Sales (omzet)" value={fmtEur(sum.sales)}
             hint={delta === null ? undefined : `${delta >= 0 ? "+" : ""}${fmtNum(delta, 1)}% vs ${periodLabel(prev)}`} />
        <Kpi label="Items sold" value={fmtNum(sum.items, 0)} />
        <Kpi label="Commission excl. VAT" value={fmtEur(sum.commission)} />
        <Kpi label="Afrekeningen made" value={`${made} / ${overview.rows.length}`} />
      </div>

      {overview.unassigned.length > 0 && (
        <Notice kind="warning">
          Sales not on anyone&apos;s afrekening: {overview.unassigned.map((u) => `${u.label} (${fmtEur(u.revenue)})`).join(", ")}.{" "}
          <TextLink href="/clients">Check your clients</TextLink>
        </Notice>
      )}
      {made < overview.rows.length && (
        <Notice>
          {overview.rows.length - made} client(s) still need an afrekening for {periodLabel(period)}.{" "}
          <TextLink href={`/month?m=${period}`}>Close the month</TextLink>
        </Notice>
      )}

      <Section title={`Per client · ${periodLabel(period)}`}>
        <TableWrap>
          <table className="table">
            <thead>
              <tr><th>Client</th><th className="num">Items</th><th className="num">Sales</th><th>Contract(s)</th><th className="num">Commission</th><th>Invoice</th></tr>
            </thead>
            <tbody>
              {[...overview.rows].sort((a, b) => b.calc.sales_total - a.calc.sales_total).map((r) => (
                <tr key={r.client.id}>
                  <td className="font-medium">{r.client.name}</td>
                  <td className="num">{fmtNum(r.calc.items, 0)}</td>
                  <td className="num">{fmtEur(r.calc.sales_total)}</td>
                  <td className="text-slate-600">{r.calc.deal || <span className="text-amber-700">no contract</span>}</td>
                  <td className="num">{fmtEur(r.calc.subtotal)}</td>
                  <td>{r.invoice?.number ?? ""}</td>
                </tr>
              ))}
              {overview.own.map((o) => (
                <tr key={o.key} className="text-slate-600">
                  <td className="font-medium">{o.label}</td>
                  <td className="num">{fmtNum(o.items, 0)}</td>
                  <td className="num">{fmtEur(o.revenue)}</td>
                  <td>Your own: no commission</td>
                  <td className="num text-slate-400">-</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section title="Sales per month">
        <div className="flex h-48 items-end gap-1 sm:gap-2">
          {months.map((x) => (
            <div key={x.period} className="flex h-full flex-1 flex-col items-center justify-end">
              <div className="mb-1 hidden text-[10px] tabular-nums text-slate-500 sm:block">{x.revenue ? fmtNum(x.revenue / 1000, 1) + "k" : ""}</div>
              <div className={`w-full rounded-t ${x.period === period ? "bg-brand-700" : "bg-brand-100"}`}
                   style={{ height: `${(x.revenue / peak) * 100}%`, minHeight: x.revenue ? 2 : 0 }} title={`${periodLabel(x.period)}: ${fmtEur(x.revenue)}`} />
              <div className="mt-1 text-[10px] text-slate-500">{periodLabel(x.period).slice(0, 3)}</div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
