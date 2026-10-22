// Billit API: create the invoice in your Billit account and send it over Peppol.
// Docs: https://docs.billit.be  (POST /v1/orders, POST /v1/orders/commands/send). Test in the sandbox first.

import { normalizeVat, periodLabel, splitStreet } from "./belgium";
import type { Client, Invoice } from "./types";

const URLS: Record<string, string> = {
  sandbox: "https://api.sandbox.billit.be/v1",
  production: "https://api.billit.be/v1",
};

export class BillitError extends Error {}

function errorText(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const errors = (d.errors ?? d.Errors) as unknown[] | undefined;
    const parts = (errors ?? []).map((e) =>
      e && typeof e === "object" ? [(e as Record<string, string>).Code, (e as Record<string, string>).Description].filter(Boolean).join(" ") : String(e),
    );
    for (const key of ["Message", "message", "title", "detail"]) if (d[key]) parts.push(String(d[key]));
    if (parts.length) return parts.join("; ");
  }
  return fallback.slice(0, 500);
}

export class BillitClient {
  private base: string;
  private headers: Record<string, string>;

  constructor(apiKey: string, partyId: string, private env = "sandbox") {
    if (!apiKey || !partyId) throw new BillitError("Billit API key and Party ID are not filled in (Settings → Billit).");
    this.base = process.env.FACT_BILLIT_URL || URLS[env] || URLS.sandbox;
    this.headers = { ApiKey: apiKey.trim(), PartyID: partyId.trim(), "Content-Type": "application/json", Accept: "application/json" };
  }

  private async request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    let response: Response;
    try {
      response = await fetch(this.base + path, {
        method, headers: { ...this.headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
    } catch (error) {
      throw new BillitError(`Could not reach Billit (${(error as Error).name}).`);
    }
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (response.status === 401 || response.status === 403) {
      throw new BillitError(`Billit refused the request (${response.status}). Check the API key and Party ID, and that they belong to the ${this.env} environment. ${errorText(data, text)}`);
    }
    if (!response.ok) throw new BillitError(`Billit error ${response.status}: ${errorText(data, text)}`);
    return data;
  }

  accountInfo() {
    return this.request("GET", "/account/accountInformation");
  }

  async createOrder(payload: unknown): Promise<string> {
    const result = await this.request("POST", "/orders", payload);
    if ((typeof result === "number" || typeof result === "string") && /^\d+$/.test(String(result).replace(/"/g, ""))) {
      return String(result).replace(/"/g, "");
    }
    if (result && typeof result === "object") {
      for (const key of ["OrderID", "OrderId", "orderID", "Id", "ID", "id"]) {
        const value = (result as Record<string, unknown>)[key];
        if (value) return String(value);
      }
    }
    throw new BillitError(`Billit created the invoice but returned an unexpected answer: ${JSON.stringify(result).slice(0, 300)}`);
  }

  /** StrictTransportType: no fallback to Billit's own e-mail; this app e-mails the afrekening itself. */
  sendOrders(orderIds: string[], transport = "Peppol") {
    return this.request("POST", "/orders/commands/send", { Transporttype: transport, OrderIDs: orderIds.map(Number) },
                        { StrictTransportType: "true" });
  }
}

export function buildOrderPayload(invoice: Invoice, client: Client, pdf?: Buffer) {
  const [street, number] = splitStreet(client.street || "");
  const payload: Record<string, unknown> = {
    OrderType: "Invoice",
    OrderDirection: "Income",
    OrderNumber: invoice.number,
    OrderDate: invoice.invoice_date,
    ExpiryDate: invoice.due_date,
    Currency: "EUR",
    Reference: `Commissie ${periodLabel(invoice.period)}`,
    PaymentReference: invoice.payment_ref,
    Customer: {
      Name: client.name,
      PartyType: "Customer",
      VATNumber: normalizeVat(client.vat_number),
      Email: client.email || "",
      Addresses: [{
        AddressType: "InvoiceAddress", Name: client.name, Street: street, StreetNumber: number,
        Zipcode: client.zipcode || "", City: client.city || "", CountryCode: (client.country || "BE").toUpperCase(),
      }],
    },
    OrderLines: invoice.lines.map((l) => ({
      Quantity: l.quantity, UnitPriceExcl: l.unit_price,
      Description: l.detail ? `${l.description} - ${l.detail}` : l.description, VATPercentage: l.vat_pct ?? invoice.vat_pct,
    })),
  };
  if (pdf) payload.OrderPDF = { FileName: `Factuur ${invoice.number}.pdf`, FileContent: pdf.toString("base64") };
  return payload;
}
