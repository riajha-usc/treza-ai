import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { FACTS, type Fact } from "./facts";

export interface PacketInput {
  merchant: string;
  disputeId: string;
  reasonCode: string;
  reasonLabel: string;
  amount: string;
  orderId: string;
  orderSummary: string[];
  facts: Fact[];
  documents: { id: string; title: string; body: string }[];
}

/** Standard PDF fonts only cover basic Latin, so normalise everything else. */
const clean = (s: string) =>
  s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E\n]/g, "");

/**
 * Builds the evidence package. Every statement in it is either a verified
 * quote with its source, or a copy of the source document itself. Nothing
 * is generated, so the agent can only submit evidence that already exists.
 */
export async function buildEvidencePdf(input: PacketInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const writer = new Writer(pdf, font, bold);

  writer.heading(`Dispute evidence: ${input.merchant}`);
  writer.line(`Dispute ${input.disputeId}  |  Reason ${input.reasonCode} ${input.reasonLabel}  |  Amount ${input.amount}`);
  writer.line(`Order ${input.orderId}`);
  for (const l of input.orderSummary) writer.line(l);
  writer.gap();

  writer.heading("Evidence");
  const titles = new Map(input.documents.map((d) => [d.id, d.title]));
  for (const f of input.facts) {
    writer.line(`- ${FACTS[f.code]}`, true);
    writer.line(`  "${f.quote}"`);
    writer.line(`  Source: ${f.source === "order_record" ? "merchant order record" : (titles.get(f.source) ?? f.source)}`);
  }
  for (const d of input.documents) {
    writer.gap();
    writer.heading(`Source document: ${d.title}`);
    for (const l of d.body.split("\n")) writer.line(l);
  }
  return pdf.save();
}

