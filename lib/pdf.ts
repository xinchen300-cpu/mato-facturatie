// PDF documents: the commission invoice (factuur) and the monthly afrekening. Built from stored snapshots, so a
// document looks the same every time it is downloaded.

import PDFDocument from "pdfkit";

import { fmtDate, fmtEur, fmtNum, fmtPct, formatIban, monthBounds, periodLabel, roundMoney } from "./belgium";
import { vatOfLines } from "./contracts";
import type { Calc, Client, Invoice, Settings, Statement } from "./types";

const DARK = "#1c2126";
const GREY = "#646b73";
const LINE = "#dde1e6";
const W = 595.28;
const H = 841.89;
const M = 50;
const CW = W - 2 * M;

type Company = Partial<Settings>;
type Doc = PDFKit.PDFDocument;

function tint(hex: string, amount = 0.9): string {
  const v = (hex || "#0F766E").replace("#", "");
  const rgb = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0);
  return `#${rgb.map((c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function start(title: string, company: Company): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({
    size: "A4", margins: { top: M, bottom: 60, left: M, right: M }, bufferPages: true,
    info: { Title: title, Author: company.company_name || "", Creator: "Mato Facturatie" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  return { doc, done };
}

function finish(doc: Doc, company: Company) {
  const range = doc.bufferedPageRange();
  const parts = [company.company_name, company.company_vat && `BTW ${company.company_vat}`,
    company.company_iban && `IBAN ${formatIban(company.company_iban)}`, company.company_email, company.company_phone,
    company.company_website].filter(Boolean);
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(M, H - 42).lineTo(W - M, H - 42).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font("Helvetica").fontSize(7).fillColor(GREY)
      .text(parts.join("  ·  "), M, H - 34, { width: CW - 40, lineBreak: false })
      .text(`${i + 1}/${range.count}`, W - M - 40, H - 34, { width: 40, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
}

function header(doc: Doc, company: Company, title: string, lines: [string, string][], accent: string) {
  doc.font("Helvetica-Bold").fontSize(18).fillColor(accent).text(company.company_name || "", M, M, { width: 260 });
  doc.font("Helvetica-Bold").fontSize(22).fillColor(accent).text(title, 300, M - 2, { width: W - M - 300, align: "right" });
  let y = M + 30;
  for (const [label, value] of lines) {
    doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text(label, 330, y, { width: 110 });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(DARK).text(value, 440, y, { width: W - M - 440, align: "right" });
    y += 13;
  }
  return y;
}

function sectionTitle(doc: Doc, text: string, accent: string) {
  if (doc.y > H - 140) doc.addPage();
  doc.moveDown(0.8);
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(accent).text(text, M, y);
  doc.moveTo(M, doc.y + 1).lineTo(M + 50, doc.y + 1).lineWidth(1.2).strokeColor(accent).stroke();
  doc.y += 8;
}

type Col = { head: string; width: number; align?: "left" | "right" };

function table(doc: Doc, cols: Col[], rows: string[][], accent: string, opts: { boldLast?: boolean; head?: boolean } = {}) {
  const drawHead = () => {
    if (opts.head === false) return;
    const y = doc.y;
    doc.rect(M, y, CW, 18).fill(accent);
    let x = M;
    for (const c of cols) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
        .text(c.head, x + 4, y + 5, { width: c.width - 8, align: c.align ?? "left", lineBreak: false });
      x += c.width;
    }
    doc.y = y + 18;
  };
  drawHead();
  rows.forEach((row, i) => {
    if (doc.y > H - 80) {
      doc.addPage();
      drawHead();
    }
    const y = doc.y;
    const last = opts.boldLast && i === rows.length - 1;
    if (i % 2 === 1 && !last) doc.rect(M, y, CW, 16).fill("#f7f8f9");
    let x = M;
    row.forEach((value, j) => {
      doc.font(last ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor(DARK)
        .text(value, x + 4, y + 4, { width: cols[j].width - 8, align: cols[j].align ?? "left", lineBreak: false, ellipsis: true });
      x += cols[j].width;
    });
    doc.moveTo(M, y + 16).lineTo(W - M, y + 16).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y = y + 16;
  });
  doc.x = M;
}

function addressLines(name: string, street: string, zipcode: string, city: string, country: string) {
  const lines = [name, street, `${zipcode ?? ""} ${city ?? ""}`.trim()];
  if (country && country.toUpperCase() !== "BE") lines.push(country.toUpperCase());
  return lines.filter(Boolean);
}

// ---------------------------------------------------------------- factuur

export async function invoicePdf(invoice: Invoice, company: Company, client: Client): Promise<Buffer> {
  const accent = company.accent_color || "#0F766E";
  const { doc, done } = start(`Factuur ${invoice.number}`, company);
  const metaEnd = header(doc, company, "FACTUUR", [
    ["Factuurnummer", invoice.number], ["Factuurdatum", fmtDate(invoice.invoice_date)],
    ["Vervaldatum", fmtDate(invoice.due_date)], ["Periode", periodLabel(invoice.period)],
  ], accent);

  const top = Math.max(metaEnd, M + 80) + 16;
  const colW = (CW - 20) / 2;
  const blocks: [string, string[], string[]][] = [
    ["VAN", addressLines(company.company_name || "", company.company_street || "", company.company_zipcode || "",
                         company.company_city || "", company.company_country || "BE"),
     [company.company_vat ? `BTW ${company.company_vat}` : "", company.company_email || ""]],
    ["FACTUUR AAN", addressLines(client.name, client.street, client.zipcode, client.city, client.country),
     [client.vat_number ? `BTW ${client.vat_number}` : ""]],
  ];
  blocks.forEach(([title, lines, extra], i) => {
    const x = M + i * (colW + 20);
    if (i === 1) doc.rect(x - 8, top - 8, colW + 8, 92).fill(tint(accent, 0.92));
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GREY).text(title, x, top, { width: colW });
    let y = top + 12;
    lines.forEach((line, j) => {
      doc.font(j === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(j === 0 ? 10 : 9).fillColor(DARK).text(line, x, y, { width: colW });
      y += 13;
    });
    extra.filter(Boolean).forEach((line) => {
      doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text(line, x, y, { width: colW });
      y += 12;
    });
  });

  // Lines
  const cols: Col[] = [
    { head: "Omschrijving", width: 245 }, { head: "Aantal", width: 45, align: "right" },
    { head: "Eenheidsprijs", width: 75, align: "right" }, { head: "Btw", width: 45, align: "right" },
    { head: "Totaal excl.", width: 85, align: "right" },
  ];
  let y = top + 108;
  doc.rect(M, y, CW, 20).fill(accent);
  let x = M;
  for (const c of cols) {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff").text(c.head, x + 5, y + 6, { width: c.width - 10, align: c.align ?? "left" });
    x += c.width;
  }
  y += 26;
  for (const line of invoice.lines) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK).text(line.description, M + 5, y, { width: cols[0].width - 10 });
    let end = doc.y;
    if (line.detail) {
      doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(line.detail, M + 5, end + 1, { width: cols[0].width - 10 });
      end = doc.y;
    }
    const values = [fmtNum(line.quantity, Number.isInteger(line.quantity) ? 0 : 2), fmtEur(line.unit_price),
      fmtPct(line.vat_pct ?? invoice.vat_pct), fmtEur(roundMoney(line.quantity * line.unit_price))];
    x = M + cols[0].width;
    values.forEach((v, i) => {
      doc.font("Helvetica").fontSize(9).fillColor(DARK).text(v, x + 5, y, { width: cols[i + 1].width - 10, align: "right" });
      x += cols[i + 1].width;
    });
    y = end + 6;
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.5).strokeColor(LINE).stroke();
    y += 8;
  }

  // Totals
  const bx = W - M - 230;
  y += 4;
  // VAT per rate; lines without VAT (transaction costs passed on) are listed apart.
  const { rates } = vatOfLines(invoice.lines, Number(invoice.vat_pct));
  const vatRows = rates.length > 1
    ? rates.map((r) => r.pct ? [`Btw ${fmtPct(r.pct)} over ${fmtEur(r.base)}`, fmtEur(r.vat)] : [`Zonder btw`, fmtEur(r.base)])
    : [[`Btw ${fmtPct(invoice.vat_pct)}`, fmtEur(invoice.vat_amount)]];
  for (const [label, value] of [["Subtotaal excl. btw", fmtEur(invoice.subtotal)], ...vatRows]) {
    doc.font("Helvetica").fontSize(9).fillColor(GREY).text(label, bx, y, { width: 140 });
    doc.fillColor(DARK).text(value, bx + 140, y, { width: 90, align: "right" });
    y += 16;
  }
  doc.rect(bx, y, 230, 26).fill(accent);
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#ffffff").text("Totaal te betalen", bx + 8, y + 8, { width: 140 })
    .text(fmtEur(invoice.total), bx + 140, y + 8, { width: 82, align: "right" });
  y += 46;

  // Payment
  const bic = company.company_bic ? ` (BIC ${company.company_bic})` : "";
  const pay = `Gelieve ${fmtEur(invoice.total)} over te schrijven vóór ${fmtDate(invoice.due_date)} op rekening ` +
    `${formatIban(company.company_iban) || "-"}${bic} op naam van ${company.company_name || "-"}, met gestructureerde ` +
    `mededeling ${invoice.payment_ref}.`;
  const payH = doc.font("Helvetica").fontSize(9).heightOfString(pay, { width: CW - 24 }) + 34;
  doc.rect(M, y, CW, payH).fill(tint(accent, 0.92));
  doc.font("Helvetica-Bold").fontSize(9).fillColor(accent).text("Betaling", M + 12, y + 10);
  doc.font("Helvetica").fontSize(9).fillColor(DARK).text(pay, M + 12, y + 24, { width: CW - 24 });
  y += payH + 14;
  for (const note of [company.invoice_vat_note, company.invoice_footer]) {
    if (!note) continue;
    doc.font("Helvetica").fontSize(8).fillColor(GREY).text(note, M, y, { width: CW });
    y = doc.y + 6;
  }

  finish(doc, company);
  return done;
}

// ---------------------------------------------------------------- afrekening

/** "Wij storten … aan u door", with the transaction costs taken off when the contract says so. */
function payoutText(statement: Statement, calc: Calc): string {
  const deducted = roundMoney(Number(statement.sales_total) - Number(statement.payout));
  if (deducted <= 0) return `Wij storten de volledige omzet van ${fmtEur(statement.payout)} aan u door`;
  const pcts = [...new Set((calc.contracts ?? []).filter((c) => c.fee_mode === "payout" && c.fee_pct).map((c) => fmtPct(c.fee_pct)))];
  return `Omzet ${fmtEur(statement.sales_total)} min ${pcts.length ? `${pcts.join(" / ")} ` : ""}transactiekosten ` +
    `(${fmtEur(deducted)}): wij storten ${fmtEur(statement.payout)} aan u door`;
}

export async function statementPdf(statement: Statement, company: Company): Promise<Buffer> {
  const accent = company.accent_color || "#0F766E";
  const snap = statement.snapshot;
  const client = snap.client;
  const { doc, done } = start(`Afrekening ${periodLabel(statement.period)} - ${client.name}`, company);

  doc.font("Helvetica-Bold").fontSize(16).fillColor(accent).text(company.company_name || "", M, M, { width: 250 });
  doc.font("Helvetica-Bold").fontSize(18).fillColor(accent).text("Afrekening", 300, M - 2, { width: W - M - 300, align: "right" });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK)
    .text(`${client.name}  ·  ${periodLabel(statement.period)}`, 260, M + 22, { width: W - M - 260, align: "right" });
  doc.font("Helvetica").fontSize(8).fillColor(GREY)
    .text(`Opgemaakt op ${fmtDate(statement.made_on)}`, 260, M + 36, { width: W - M - 260, align: "right" });

  // Tiles
  let y = M + 62;
  const tiles: [string, string][] = [
    ["OMZET", fmtEur(statement.sales_total)], ["VERKOPEN", fmtNum(statement.items, 0)],
    ["UITBETALING AAN U", fmtEur(statement.payout)], ["COMMISSIE (EXCL. BTW)", fmtEur(snap.calc.subtotal)],
  ];
  const tw = (CW - 3 * 10) / 4;
  tiles.forEach(([label, value], i) => {
    const x = M + i * (tw + 10);
    doc.rect(x, y, tw, 48).fill(tint(accent, 0.92));
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor(GREY).text(label, x + 8, y + 9, { width: tw - 16 });
    doc.font("Helvetica-Bold").fontSize(13).fillColor(DARK).text(value, x + 8, y + 24, { width: tw - 16 });
  });
  y += 60;

  // Payout
  const iban = client.iban ? ` op rekening ${formatIban(client.iban)}` : "";
  const payout = payoutText(statement, snap.calc) + `${iban}.`;
  const box = 30 + doc.font("Helvetica").fontSize(9).heightOfString(payout, { width: CW - 24 });
  doc.rect(M, y, CW, box).fill(tint(accent, 0.92));
  doc.font("Helvetica-Bold").fontSize(9).fillColor(accent).text("Uitbetaling", M + 12, y + 8);
  doc.font("Helvetica").fontSize(9).fillColor(DARK).text(payout, M + 12, y + 22, { width: CW - 24 });
  doc.y = y + box + 8;
  if (snap.manual) {
    const source = snap.manual.note ? `de cijfers van ${snap.manual.note}` : "een eigen opgave";
    doc.font("Helvetica").fontSize(8).fillColor(GREY)
      .text(`De omzet van deze maand is gebaseerd op ${source}, niet op de gegevens van de betaalterminal.`, M, doc.y, { width: CW });
    doc.y += 6;
  }

  if (snap.daily.length) {
    sectionTitle(doc, "Omzet per dag", accent);
    dailyChart(doc, statement.period, snap.daily, accent);
  }
  if (snap.machines.length) {
    sectionTitle(doc, "Per automaat", accent);
    const rows = snap.machines.map((m) => [m.label, m.terminal ?? "", fmtNum(m.items, 0), fmtEur(m.revenue),
      `${fmtNum(statement.sales_total ? (m.revenue / statement.sales_total) * 100 : 0, 1)}%`]);
    if (snap.machines.length > 1) rows.push(["Totaal", "", fmtNum(statement.items, 0), fmtEur(statement.sales_total), "100%"]);
    table(doc, [{ head: "Automaat", width: 190 }, { head: "Terminal", width: 95 }, { head: "Verkopen", width: 70, align: "right" },
      { head: "Omzet", width: 85, align: "right" }, { head: "Aandeel", width: 55, align: "right" }], rows, accent,
      { boldLast: snap.machines.length > 1 });
  }
  if (snap.products.length) {
    sectionTitle(doc, "Per product", accent);
    table(doc, [{ head: "Product", width: 325 }, { head: "Verkopen", width: 85, align: "right" }, { head: "Omzet", width: 85, align: "right" }],
      snap.products.slice(0, 25).map((p) => [p.product, fmtNum(p.items, 0), fmtEur(p.revenue)]), accent);
    if (snap.products.length > 25) {
      doc.font("Helvetica").fontSize(8).fillColor(GREY).text(`+ ${snap.products.length - 25} andere producten`, M, doc.y + 4);
    }
  }

  sectionTitle(doc, "Commissie", accent);
  if (snap.calc.lines.length) {
    const rows = snap.calc.lines.map((l) => [l.description, fmtEur(roundMoney(l.quantity * l.unit_price))]);
    rows.push(["Totaal excl. btw", fmtEur(snap.calc.subtotal)]);
    table(doc, [{ head: "", width: 395 }, { head: "", width: 100, align: "right" }], rows, accent, { boldLast: true, head: false });
    const note = snap.invoice
      ? `Gefactureerd op factuur ${snap.invoice.number}: ${fmtEur(snap.invoice.total)} incl. btw, te betalen vóór ` +
        `${fmtDate(snap.invoice.due_date)} met mededeling ${snap.invoice.payment_ref}.`
      : "De factuur volgt apart.";
    doc.font("Helvetica").fontSize(8).fillColor(GREY).text(note, M, doc.y + 6, { width: CW });
  } else {
    doc.font("Helvetica").fontSize(9).fillColor(GREY).text("Geen commissie voor deze maand.", M, doc.y);
  }

  if (snap.sales?.length) {
    doc.addPage();
    doc.y = M;
    sectionTitle(doc, `Alle verkopen · ${periodLabel(statement.period)}`, accent);
    const rows = snap.sales.map((s) => [fmtDate(s.at), s.at.slice(11, 16), s.machine, s.slot, s.product, fmtEur(s.amount)]);
    rows.push(["", "", "", "", `Totaal · ${snap.sales.length} verkopen`, fmtEur(statement.sales_total)]);
    table(doc, [{ head: "Datum", width: 60 }, { head: "Uur", width: 38 }, { head: "Automaat", width: 160 },
      { head: "Vak", width: 32, align: "right" }, { head: "Product", width: 140 }, { head: "Bedrag", width: 65, align: "right" }],
      rows, accent, { boldLast: true });
  }

  finish(doc, company);
  return done;
}

function dailyChart(doc: Doc, period: string, daily: { day: string; revenue: number }[], accent: string) {
  const { days } = monthBounds(period);
  const values = new Map(daily.map((d) => [Number(d.day.slice(8, 10)), Number(d.revenue)]));
  const peak = Math.max(...values.values(), 0.01);
  const chartH = 90;
  const labelW = 40;
  const x0 = M + labelW;
  const y0 = doc.y + 4;
  const width = CW - labelW;
  const slot = width / days;
  for (const frac of [0, 0.5, 1]) {
    const gy = y0 + chartH - chartH * frac;
    doc.moveTo(x0, gy).lineTo(x0 + width, gy).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font("Helvetica").fontSize(6.5).fillColor(GREY).text(fmtNum(peak * frac, 0), M, gy - 3, { width: labelW - 6, align: "right" });
  }
  for (let day = 1; day <= days; day++) {
    const value = values.get(day) ?? 0;
    if (value > 0) {
      const h = (chartH * value) / peak;
      doc.rect(x0 + (day - 1) * slot + slot * 0.18, y0 + chartH - h, slot * 0.64, h).fill(accent);
    }
    if (day === 1 || day % 5 === 0) {
      doc.font("Helvetica").fontSize(6.5).fillColor(GREY)
        .text(String(day), x0 + (day - 1) * slot, y0 + chartH + 3, { width: slot, align: "center", lineBreak: false });
    }
  }
  doc.y = y0 + chartH + 16;
  doc.x = M;
}
