import { Suspense } from "react";
import { connection } from "next/server";
import { dateTime } from "@/components/time";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { format } from "@/lib/money/money";
import { loadJournal } from "@/lib/queries/controls";

export default function JournalPage() {
  return (
    <main className="flex flex-col gap-4 p-6">
      <PageHeader title="Journal" subtitle="Double-entry ledger in integer minor units. The database rejects any entry that does not balance." />
      <Suspense fallback={<Panel title="Entries"><Empty>Loading journal...</Empty></Panel>}>
        <Journal />
      </Suspense>
    </main>
  );
}

async function Journal() {
  await connection();
  const entries = await loadJournal();
  return (
    <Panel title="Entries" meta={`latest ${entries.length}`}>
      {entries.length === 0 ? (
        <Empty>No entries yet. A settled deposit, a card charge or a settlement cycle will post here.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Posted</th><th>Entry</th><th>Tenant</th><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr>
            </thead>
            <tbody>
              {entries.flatMap((e) =>
                e.postings.map((p, i) => (
                  <tr key={`${e.id}-${i}`} className={i === 0 ? "[&>td]:border-t [&>td]:border-line-strong" : ""}>
                    <td className="whitespace-nowrap text-muted">{i === 0 ? dateTime(e.created_at) : ""}</td>
                    <td>{i === 0 ? <><span>{e.description}</span> <span className="font-mono text-2xs text-muted">{e.kind}</span></> : ""}</td>
                    <td className="text-ink-2">{p.tenant}</td>
                    <td className="font-mono text-xs">{p.code}</td>
                    <td className="num">{p.amount_minor > 0 ? format(p.amount_minor, p.currency) : ""}</td>
                    <td className="num">{p.amount_minor < 0 ? format(-p.amount_minor, p.currency) : ""}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
