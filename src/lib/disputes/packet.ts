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

class Writer {
  private page: PDFPage;
  private y = 0;
  private readonly size = 10;
  private readonly margin = 50;

  constructor(
    private readonly pdf: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.page = this.newPage();
  }

  private newPage() {
    const p = this.pdf.addPage([612, 792]);
    this.y = 792 - this.margin;
    return p;
  }

  heading(text: string) {
    this.write(clean(text), this.bold, 12);
  }

  line(text: string, emphasise = false) {
    this.write(clean(text), emphasise ? this.bold : this.font, this.size);
  }

  gap() {
    this.y -= 8;
  }

  private write(text: string, font: PDFFont, size: number) {
    const width = 612 - this.margin * 2;
    const words = text.split(" ");
    let current = "";
    const flush = () => {
      if (this.y < this.margin) this.page = this.newPage();
      this.page.drawText(current, { x: this.margin, y: this.y, size, font, color: rgb(0.1, 0.1, 0.12) });
      this.y -= size + 4;
      current = "";
    };
    for (const w of words) {
      const next = current ? `${current} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && current) {
        flush();
        current = w;
      } else current = next;
    }
    flush();
  }
}
