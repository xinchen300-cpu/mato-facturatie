// The monthly calculation over a client's contracts. Same rules as the desktop version:
// a client can have several contracts (one after the other, or per machine). Each can combine a percentage of
// sales, an amount per item sold, a fixed amount per month and a monthly minimum. Only the days of the month on
// which a contract runs count; the fixed amount and the minimum go pro rata when asked.

import {
  MONTHS_SHORT_NL, daysBetween, fmtDate, fmtEur, fmtNum, fmtPct, monthBounds, nextPeriod, percentOf, periodLabel, previousPeriod,
  roundMoney, sumMoney,
} from "./belgium";
import type { Calc, Client, Contract, ContractResult, DailyRow, ExtraLine, InvoiceLine, ManualSales } from "./types";

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
  if (contract.fixed_monthly || contract.fixed_alt_months?.length) {
    const alt = contract.fixed_alt_months?.length
      ? ` (${fmtEur(contract.fixed_alt)} in ${contract.fixed_alt_months.map((m) => MONTHS_SHORT_NL[m - 1]).join(", ")})` : "";
    parts.push(`${fmtEur(contract.fixed_monthly)}/month${alt}`);
  }
  let text = parts.join(" + ") || "nothing to charge";
  if (contract.minimum_monthly) text += ` (min. ${fmtEur(contract.minimum_monthly)})`;
  if (contract.fee_pct) {
    text += ` · ${fmtPct(contract.fee_pct)} transaction costs ${contract.fee_mode === "invoice" ? "invoiced" : "from the payout"}`;
  }
  if (contract.indexed) text += ` · indexed yearly${contract.index_from ? ` from ${fmtDate(contract.index_from)}` : ""}`;
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

/**
 * Yearly indexation with the health index: the start index is the month before the contract starts; from the first
 * whole month after each anniversary the amounts follow the index of the month before. Returns the months needed
 * for a period: `current` is null before the first anniversary.
 */
export function indexMonths(contract: Pick<Contract, "indexed" | "starts_on"> & { index_from?: string | null }, period: string):
  { base: string; current: string | null; since: string | null; first: string } | null {
  if (!contract.indexed) return null;
  const start = contract.index_from || contract.starts_on;
  const [year, month, day] = start.split("-").map(Number);
  const anniversary = `${year + 1}-${String(month).padStart(2, "0")}`;
  const first = day === 1 ? anniversary : nextPeriod(anniversary);
  const base = previousPeriod(start.slice(0, 7));
  if (period < first) return { base, current: null, since: null, first };
  const firstMonth = Number(first.slice(5));
  const since = `${Number(period.slice(5)) >= firstMonth ? period.slice(0, 4) : Number(period.slice(0, 4)) - 1}-${first.slice(5)}`;
  return { base, current: previousPeriod(since), since, first };
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

export function compute(client: Client, period: string, rows: DailyRow[], contracts: Contract[],
                        healthIndex: Record<string, number> = {}): Calc {
  const { first, last, days: daysInMonth } = monthBounds(period);
  const own = contracts.filter((c) => c.client_id === client.id);
  const sales = clientRows(client, rows).filter((r) => r.day >= first && r.day <= last);
  const covered = new Set<number>();
  const maand = periodLabel(period);
  const lines: InvoiceLine[] = [];
  const details: ContractResult[] = [];
  const indexMissing = new Set<string>();
  // When another contract charges on the sales, a fixed fee's line does not repeat the sales.
  const salesBased = own.some((c) => activeIn(c, first, last) && (c.pct || c.per_item));

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

    // Indexation: the amounts (not the percentages) follow the health index after each anniversary.
    let indexFactor = 1;
    let indexText = "";
    const months = indexMonths(contract, period);
    if (months?.current) {
      const start = healthIndex[months.base];
      const now = healthIndex[months.current];
      if (start && now) {
        indexFactor = now / start;
        indexText = `geïndexeerd: gezondheidsindex ${fmtNum(now)} (${periodLabel(months.current)}) / ${fmtNum(start)} (${periodLabel(months.base)})`;
      } else {
        if (!start) indexMissing.add(months.base);
        if (!now) indexMissing.add(months.current);
      }
    }
    const index = (amount: number) => roundMoney(amount * indexFactor);
    const monthNo = Number(period.slice(5));
    const fixedBase = contract.fixed_alt_months?.includes(monthNo) ? Number(contract.fixed_alt || 0) : Number(contract.fixed_monthly || 0);
    const perItem = Math.round(Number(contract.per_item || 0) * indexFactor * 10000) / 10000;

    const baseKind = contract.base === "excl" ? "excl" : "incl";
    const base = baseKind === "incl" ? salesTotal : roundMoney(salesTotal / (1 + Number(contract.sales_vat_pct || 0) / 100));
    const pctAmount = percentOf(base, Number(contract.pct || 0));
    const itemAmount = roundMoney(items * perItem);
    const factor = partial && contract.prorate ? days / daysInMonth : 1;
    const fixed = roundMoney(index(fixedBase) * factor);
    const minimum = roundMoney(index(Number(contract.minimum_monthly || 0)) * factor);
    const topup = minimum ? roundMoney(Math.max(0, minimum - pctAmount - itemAmount)) : 0;
    const feePct = Number(contract.fee_pct || 0);
    // With their own terminal there is no payout to take the transaction costs from.
    const feeMode = client.own_terminal || contract.fee_mode === "invoice" ? "invoice" : "payout";
    const fee = percentOf(salesTotal, feePct);

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
                   detail: `${items} verkopen × ${fmtEur(perItem)}${indexText ? ` (${indexText})` : ""}`,
                   quantity: items, unit_price: perItem, kind: "per_item" });
    }
    if (fixedBase) {
      const proRata = factor !== 1 ? ` (pro rata ${days}/${daysInMonth} dagen)` : "";
      const indexed = indexText ? `${fmtEur(fixedBase)} ${indexText} = ${fmtEur(index(fixedBase))}` : "";
      lines.push({ description: `Vaste vergoeding ${spanText}${label}${proRata}`,
                   detail: indexed || (salesBased ? "" : detail), quantity: 1, unit_price: fixed, kind: "fixed" });
    }
    if (topup) {
      lines.push({ description: `Aanvulling tot minimum ${fmtEur(minimum)} ${spanText}${label}`,
                   detail: `Commissie ${fmtEur(pctAmount + itemAmount)} < minimum ${fmtEur(minimum)}`,
                   quantity: 1, unit_price: topup, kind: "minimum" });
    }
    if (fee && feeMode === "invoice") {
      lines.push({ description: `Transactiekosten ${fmtPct(feePct)} op omzet ${spanText}${label}`,
                   detail: `Omzet ${fmtEur(salesTotal)} incl. btw`, quantity: 1, unit_price: fee, kind: "fee" });
    }
    details.push({
      contract_id: contract.id, name: contract.name, from: lo, to: hi, sales_total: salesTotal, items,
      base_kind: baseKind, base, pct: Number(contract.pct || 0), pct_amount: pctAmount,
      per_item: Number(contract.per_item || 0), item_amount: itemAmount, fixed, minimum, topup,
      fee_pct: feePct, fee, fee_mode: feeMode, index_factor: indexFactor, summary: summary(contract),
    });
  }

  const kept = lines.filter((l) => roundMoney(l.quantity * l.unit_price) !== 0);
  const uncovered = sales.filter((_, i) => !covered.has(i));
  const salesTotal = sumMoney(sales.map((r) => Number(r.revenue)));
  const feeDeducted = sumMoney(details.filter((d) => d.fee_mode === "payout").map((d) => d.fee));
  return {
    period,
    sales_total: salesTotal,
    items: sales.reduce((acc, r) => acc + Number(r.items), 0),
    lines: kept,
    subtotal: sumMoney(kept.map((l) => roundMoney(l.quantity * l.unit_price))),
    contracts: details,
    uncovered_total: sumMoney(uncovered.map((r) => Number(r.revenue))),
    uncovered_items: uncovered.reduce((acc, r) => acc + Number(r.items), 0),
    fee_deducted: feeDeducted,
    // Own terminal: they received the money themselves.
    payout: client.own_terminal ? 0 : roundMoney(salesTotal - feeDeducted),
    index_missing: [...indexMissing].sort(),
    deal: details.map((d) => d.summary).join(" | "),
  };
}

/** The month's calculation with the client's one-off charges added as invoice lines. */
export function withExtras(calc: Calc, clientId: number, extras: ExtraLine[]): Calc {
  const own = extras.filter((e) => e.client_id === clientId && e.period === calc.period);
  if (!own.length) return calc;
  const lines = [...calc.lines, ...own.map((e) => ({
    description: e.description, detail: "", quantity: Number(e.quantity), unit_price: Number(e.unit_price), kind: "extra",
  }))];
  return { ...calc, lines, subtotal: sumMoney(lines.map((l) => roundMoney(l.quantity * l.unit_price))) };
}

/** The VAT rate of an invoice line: transaction costs are passed on without VAT, the rest at the invoice rate. */
export function lineVatPct(line: Pick<InvoiceLine, "kind" | "vat_pct">, defaultPct: number): number {
  if (line.vat_pct !== undefined && line.vat_pct !== null) return Number(line.vat_pct);
  return line.kind === "fee" ? 0 : defaultPct;
}

/** VAT per rate over the lines: each rate's total is rounded once. Returns the rates and the VAT. */
export function vatOfLines(lines: InvoiceLine[], defaultPct: number): { rates: { pct: number; base: number; vat: number }[]; vat: number } {
  const bases = new Map<number, number>();
  for (const l of lines) {
    const pct = lineVatPct(l, defaultPct);
    bases.set(pct, roundMoney((bases.get(pct) ?? 0) + roundMoney(l.quantity * l.unit_price)));
  }
  const rates = [...bases.entries()].sort((a, b) => b[0] - a[0]).map(([pct, base]) => ({ pct, base, vat: percentOf(base, pct) }));
  return { rates, vat: sumMoney(rates.map((r) => r.vat)) };
}
