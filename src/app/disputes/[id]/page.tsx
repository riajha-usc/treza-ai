import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Chip, Empty, Panel } from "@/components/ui";
import { format } from "@/lib/money/money";
import { loadDisputeDetail } from "@/lib/queries/disputes";
import { decideEscalationAction, issuerRejectsAction, resolveAction } from "../actions";
import { DecisionPanel, EvidencePanel } from "./panels";

const btn = "rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-90";

export default function DisputeDetailPage({ params }: PageProps<"/disputes/[id]">) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/disputes" className="text-xs text-muted hover:text-text">
        All disputes
      </Link>
      <Suspense fallback={<Empty>Loading dispute...</Empty>}>{params.then(({ id }) => <Detail id={id} />)}</Suspense>
    </main>
  );
}

