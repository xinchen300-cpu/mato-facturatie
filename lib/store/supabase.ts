import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_KEY, SUPABASE_URL } from "../config";
import { DEFAULT_SETTINGS } from "../types";
import type { Catalog, Client, Contract, DailyRow, DetailRow, Invoice, Settings, Statement } from "../types";
import type { NewInvoice, StatementInput, Store } from "./types";

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a server component: the middleware refreshes the session instead.
        }
      },
    },
  });
}

type Db = Awaited<ReturnType<typeof supabaseServer>>;

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

function toInvoice(row: Record<string, unknown>): Invoice {
  return {
    ...(row as unknown as Invoice),
    sales_total: num(row.sales_total), subtotal: num(row.subtotal), vat_pct: num(row.vat_pct),
    vat_amount: num(row.vat_amount), total: num(row.total), items: num(row.items),
  };
}

function toStatement(row: Record<string, unknown>): Statement {
  return {
    ...(row as unknown as Statement),
    sales_total: num(row.sales_total), payout: num(row.payout), items: num(row.items),
  };
}

function toContract(row: Record<string, unknown>): Contract {
  return {
    ...(row as unknown as Contract),
    pct: num(row.pct), sales_vat_pct: num(row.sales_vat_pct), per_item: num(row.per_item),
    fixed_monthly: num(row.fixed_monthly), minimum_monthly: num(row.minimum_monthly),
  };
}

export class SupabaseStore implements Store {
  constructor(private db: Db, readonly orgId: string) {}

  async user() {
    const { data } = await this.db.auth.getUser();
    return data.user ? { email: data.user.email ?? "" } : null;
  }

  async isOwner() {
    const { data, error } = await this.db.rpc("fact_is_owner", { target_org: this.orgId });
    return !error && data === true;
  }

  async catalog() {
    return check(await this.db.rpc("fact_catalog", { target_org: this.orgId })) as Catalog;
  }

  async settings(): Promise<Settings> {
    const row = check(await this.db.from("fact_settings").select("data").eq("org_id", this.orgId).maybeSingle());
    return { ...DEFAULT_SETTINGS, ...((row?.data as Partial<Settings>) ?? {}) };
  }

  async saveSettings(patch: Partial<Settings>) {
    const current = check(await this.db.from("fact_settings").select("data").eq("org_id", this.orgId).maybeSingle());
    const data = { ...((current?.data as object) ?? {}), ...patch };
    check(await this.db.from("fact_settings").upsert({ org_id: this.orgId, data, updated_at: new Date().toISOString() }));
  }

  async clients() {
    return check(await this.db.from("fact_clients").select("*").eq("org_id", this.orgId).order("name")) as Client[];
  }

  async insertClient(client: Omit<Client, "id">) {
    return check(await this.db.from("fact_clients").insert({ ...client, org_id: this.orgId }).select().single()) as Client;
  }

  async updateClient(id: number, patch: Partial<Client>) {
    check(await this.db.from("fact_clients").update(patch).eq("id", id).eq("org_id", this.orgId));
  }

  async deleteClient(id: number) {
    check(await this.db.from("fact_clients").delete().eq("id", id).eq("org_id", this.orgId));
  }

  async contracts() {
    const rows = check(await this.db.from("fact_contracts").select("*").eq("org_id", this.orgId).order("starts_on"));
    return (rows as Record<string, unknown>[]).map(toContract);
  }

  async insertContract(contract: Omit<Contract, "id">) {
    check(await this.db.from("fact_contracts").insert({ ...contract, org_id: this.orgId }));
  }

  async updateContract(id: number, patch: Partial<Contract>) {
    check(await this.db.from("fact_contracts").update(patch).eq("id", id).eq("org_id", this.orgId));
  }

  async deleteContract(id: number) {
    check(await this.db.from("fact_contracts").delete().eq("id", id).eq("org_id", this.orgId));
  }

  async salesDaily(from: string, to: string) {
    const out: DailyRow[] = [];
    // PostgREST returns at most 1000 rows per request (a year is a few thousand): page through.
    for (let offset = 0; ; offset += 1000) {
      const rows = check(await this.db
        .rpc("fact_sales_daily", { target_org: this.orgId, from_day: from, to_day: to })
        .range(offset, offset + 999)) as Record<string, unknown>[];
      out.push(...rows.map((r) => ({
        owner: String(r.owner), machine_id: String(r.machine_id), day: String(r.day).slice(0, 10),
        items: num(r.items), revenue: num(r.revenue),
      })));
      if (rows.length < 1000) break;
    }
    return out;
  }

  async salesDetail(from: string, to: string, owners: string[]) {
    const out: DetailRow[] = [];
    // PostgREST returns at most 1000 rows per request: page through.
    for (let offset = 0; ; offset += 1000) {
      const rows = check(await this.db
        .rpc("fact_sales_detail", { target_org: this.orgId, from_day: from, to_day: to, owner_keys: owners })
        .range(offset, offset + 999)) as Record<string, unknown>[];
      out.push(...rows.map((r) => ({
        owner: String(r.owner), machine_id: String(r.machine_id), at: String(r.at), slot: (r.slot as string) ?? null,
        product: (r.product as string) ?? null, units: num(r.units), amount: num(r.amount),
      })));
      if (rows.length < 1000) break;
    }
    return out;
  }

  async invoices(filter: { period?: string; clientId?: number } = {}) {
    let query = this.db.from("fact_invoices").select("*").eq("org_id", this.orgId);
    if (filter.period) query = query.eq("period", filter.period);
    if (filter.clientId) query = query.eq("client_id", filter.clientId);
    const rows = check(await query.order("year", { ascending: false }).order("seq", { ascending: false }));
    return (rows as Record<string, unknown>[]).map(toInvoice);
  }

  async invoice(id: number) {
    const row = check(await this.db.from("fact_invoices").select("*").eq("id", id).eq("org_id", this.orgId).maybeSingle());
    return row ? toInvoice(row as Record<string, unknown>) : null;
  }

  async createInvoice(input: NewInvoice) {
    const row = check(await this.db.rpc("fact_create_invoice", {
      target_org: this.orgId, p_client: input.clientId, p_period: input.period, p_invoice_date: input.invoiceDate,
      p_due_days: input.dueDays, p_lines: input.lines, p_snapshot: input.snapshot, p_sales_total: input.salesTotal,
      p_items: input.items, p_subtotal: input.subtotal, p_vat_pct: input.vatPct,
    }));
    return toInvoice(row as Record<string, unknown>);
  }

  async updateInvoice(id: number, patch: Partial<Invoice>) {
    check(await this.db.from("fact_invoices").update(patch).eq("id", id).eq("org_id", this.orgId));
  }

  async deleteInvoice(id: number) {
    check(await this.db.from("fact_invoices").delete().eq("id", id).eq("org_id", this.orgId));
  }

  async statements(filter: { period?: string; clientId?: number } = {}) {
    let query = this.db.from("fact_statements").select("*").eq("org_id", this.orgId);
    if (filter.period) query = query.eq("period", filter.period);
    if (filter.clientId) query = query.eq("client_id", filter.clientId);
    const rows = check(await query.order("period", { ascending: false }));
    return (rows as Record<string, unknown>[]).map(toStatement);
  }

  async statement(id: number) {
    const row = check(await this.db.from("fact_statements").select("*").eq("id", id).eq("org_id", this.orgId).maybeSingle());
    return row ? toStatement(row as Record<string, unknown>) : null;
  }

  async saveStatement(input: StatementInput, existingId?: number) {
    const query = existingId
      ? this.db.from("fact_statements").update(input).eq("id", existingId).eq("org_id", this.orgId)
      : this.db.from("fact_statements").insert({ ...input, org_id: this.orgId });
    return toStatement(check(await query.select().single()) as Record<string, unknown>);
  }

  async updateStatement(id: number, patch: Partial<Statement>) {
    check(await this.db.from("fact_statements").update(patch).eq("id", id).eq("org_id", this.orgId));
  }

  async deleteStatement(id: number) {
    check(await this.db.from("fact_statements").delete().eq("id", id).eq("org_id", this.orgId));
  }
}
