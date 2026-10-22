// The monthly calculation over a client's contracts. Same rules as the desktop version:
// a client can have several contracts (one after the other, or per machine). Each can combine a percentage of
// sales, an amount per item sold, a fixed amount per month and a monthly minimum. Only the days of the month on
// which a contract runs count; the fixed amount and the minimum go pro rata when asked.

import { daysBetween, fmtDate, fmtEur, fmtPct, monthBounds, percentOf, periodLabel, roundMoney, sumMoney } from "./belgium";
import type { Calc, Client, Contract, ContractResult, DailyRow, InvoiceLine, ManualSales } from "./types";

export const machineKey = (row: { owner: string; machine_id: string }) => `${row.owner}@${row.machine_id}`;

export function activeIn(contract: Contract, first: string, last: string): [string, string] | null {
  const lo = contract.starts_on > first ? contract.starts_on : first;
  const end = contract.ends_on || last;
  const hi = end < last ? end : last;
  return lo <= hi ? [lo, hi] : null;
}

export function summary(contract: Contract): string {
  const parts: string[] = [];
  if (contract.pct) parts.push(`${fmtPct(contract.pct)} of sales ${contract.base === "excl" ? "excl." : "incl."} VAT`);
  if (contract.per_item) parts.push(`${fmtEur(contract.per_item)}/item`);
  if (contract.fixed_monthly) parts.push(`${fmtEur(contract.fixed_monthly)}/month`);
  let text = parts.join(" + ") || "nothing to charge";
  if (contract.minimum_monthly) text += ` (min. ${fmtEur(contract.minimum_monthly)})`;
  if (contract.machines.length) text += ` · ${contract.machines.length} machine(s)`;
  return text;
}

export function describePeriod(contract: Contract): string {
  return contract.ends_on
    ? `${fmtDate(contract.starts_on)} - ${fmtDate(contract.ends_on)}`
    : `since ${fmtDate(contract.starts_on)}`;
}

/** Owner (and machine) of a client's sales typed in by hand. */
export const manualOwner = (clientId: number) => `manual:${clientId}`;

/** The owners whose sales count for a client: its MATO Info owners, and its sales typed in by hand. */
export function ownersOf(client: Client): Set<string> {
  return new Set([...client.owners, manualOwner(client.id)]);
}

/** Sales rows that belong to a client (by its MATO Info owners). */
export function clientRows(client: Client, rows: DailyRow[]): DailyRow[] {
  const owners = ownersOf(client);
  return rows.filter((r) => owners.has(r.owner));
}

/**
 * The month's sales with the figures typed in by hand: for such a client its MATO Info sales of that month are
 * replaced by one row with the typed total, on the last day of the month.
 */
export function applyManual(rows: DailyRow[], clients: Client[], manual: ManualSales[], period: string): DailyRow[] {
  const { first, last } = monthBounds(period);
  const entries = manual.filter((m) => m.period === period && clients.some((c) => c.id === m.client_id));
  if (!entries.length) return rows;
  const replaced = new Set(entries.flatMap((m) => clients.find((c) => c.id === m.client_id)!.owners));
  const kept = rows.filter((r) => !(replaced.has(r.owner) && r.day >= first && r.day <= last));
  return [...kept, ...entries.map((m) => ({
    owner: manualOwner(m.client_id), machine_id: manualOwner(m.client_id), day: last, items: Number(m.items), revenue: Number(m.amount),
  }))];
}

export function compute(client: Client, period: string, rows: DailyRow[], contracts: Contract[]): Calc {
  const { first, last, days: daysInMonth } = monthBounds(period);
  const own = contracts.filter((c) => c.client_id === client.id);
  const sales = clientRows(client, rows).filter((r) => r.day >= first && r.day <= last);
  const covered = new Set<number>();
  const maand = periodLabel(period);
  const lines: InvoiceLine[] = [];
  const details: ContractResult[] = [];

  for (const contract of own) {
    const span = activeIn(contract, first, last);
    if (!span) continue;
    const [lo, hi] = span;
    const days = daysBetween(lo, hi) + 1;
    const partial = days < daysInMonth;
    const scope = new Set(contract.machines);
    const part: DailyRow[] = [];
    sales.forEach((r, i) => {
      if (r.day >= lo && r.day <= hi && (!scope.size || scope.has(machineKey(r)))) {
        covered.add(i);
        part.push(r);
      }
    });
    const salesTotal = sumMoney(part.map((r) => Number(r.revenue)));
    const items = part.reduce((acc, r) => acc + Number(r.items), 0);
    const spanText = partial ? `${fmtDate(lo)} - ${fmtDate(hi)}` : maand;
    const label = contract.name && own.length > 1 ? ` (${contract.name})` : "";

    const baseKind = contract.base === "excl" ? "excl" : "incl";
    const base = baseKind === "incl" ? salesTotal : roundMoney(salesTotal / (1 + Number(contract.sales_vat_pct || 0) / 100));
    const pctAmount = percentOf(base, Number(contract.pct || 0));
    const itemAmount = roundMoney(items * Number(contract.per_item || 0));
    const factor = partial && contract.prorate ? days / daysInMonth : 1;
    const fixed = roundMoney(Number(contract.fixed_monthly || 0) * factor);
    const minimum = roundMoney(Number(contract.minimum_monthly || 0) * factor);
    const topup = minimum ? roundMoney(Math.max(0, minimum - pctAmount - itemAmount)) : 0;

    let detail = `Omzet ${spanText}: ${fmtEur(salesTotal)} incl. btw`;
    if (baseKind === "excl" && contract.pct) {
      detail += ` = ${fmtEur(base)} excl. btw (${fmtPct(Number(contract.sales_vat_pct || 0))})`;
    }
    detail += `, ${items} verkopen`;
    if (contract.pct) {
      lines.push({ description: `Commissie ${fmtPct(Number(contract.pct))} op omzet ${spanText}${label}`, detail,
                   quantity: 1, unit_price: pctAmount, kind: "pct" });
    }
    if (contract.per_item) {
      lines.push({ description: `Vergoeding per verkoop ${spanText}${label}`,
                   detail: `${items} verkopen × ${fmtEur(Number(contract.per_item))}`,
                   quantity: items, unit_price: Number(contract.per_item), kind: "per_item" });
    }
    if (contract.fixed_monthly) {
      const proRata = factor !== 1 ? ` (pro rata ${days}/${daysInMonth} dagen)` : "";
      lines.push({ description: `Vaste vergoeding ${spanText}${label}${proRata}`,
                   detail: contract.pct || contract.per_item ? "" : detail, quantity: 1, unit_price: fixed, kind: "fixed" });
    }
    if (topup) {
      lines.push({ description: `Aanvulling tot minimum ${fmtEur(minimum)} ${spanText}${label}`,
                   detail: `Commissie ${fmtEur(pctAmount + itemAmount)} < minimum ${fmtEur(minimum)}`,
                   quantity: 1, unit_price: topup, kind: "minimum" });
    }
    details.push({
      contract_id: contract.id, name: contract.name, from: lo, to: hi, sales_total: salesTotal, items,
      base_kind: baseKind, base, pct: Number(contract.pct || 0), pct_amount: pctAmount,
      per_item: Number(contract.per_item || 0), item_amount: itemAmount, fixed, minimum, topup, summary: summary(contract),
    });
  }

  const kept = lines.filter((l) => roundMoney(l.quantity * l.unit_price) !== 0);
  const uncovered = sales.filter((_, i) => !covered.has(i));
  return {
    period,
    sales_total: sumMoney(sales.map((r) => Number(r.revenue))),
    items: sales.reduce((acc, r) => acc + Number(r.items), 0),
    lines: kept,
    subtotal: sumMoney(kept.map((l) => roundMoney(l.quantity * l.unit_price))),
    contracts: details,
    uncovered_total: sumMoney(uncovered.map((r) => Number(r.revenue))),
    uncovered_items: uncovered.reduce((acc, r) => acc + Number(r.items), 0),
    deal: details.map((d) => d.summary).join(" | "),
  };
}
