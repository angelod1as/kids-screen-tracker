import { notFound } from "next/navigation";

import { EntryList, HISTORY_LIMIT } from "../../../../../ui/entries";
import { Panel, PanelText } from "../../../../../ui/panel";
import { fetchHistoryAction } from "../../../../actions/history";
import { listKidsAction } from "../../../../actions/people";

/**
 * One boy's history, read by an adult (#73).
 *
 * The same list the boy sees on `/menino/historico` — the ledger and the
 * refusals in one order — drawn by the same component, so the two screens
 * cannot drift into disagreeing about what a row says.
 *
 * **The id in the URL is not a permission.** `/admin/*` sends a kid back to his
 * own home, and that is the cheap half; the half that holds is that
 * `fetchHistoryAction` calls `requireAccess` with this id, so Kid1 POSTing
 * Kid2's number at the endpoint is refused whatever address he typed
 * (`history.test.ts` sends it). What the check below does is a different job:
 * it decides whether the address names one of the boys at all, so
 * `/admin/historico/1` is a 404 rather than an empty screen implying an admin
 * has a history of his own.
 */
export default async function AdminKidHistoryPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const [{ userId }, kids] = await Promise.all([params, listKidsAction()]);
  const kid = kids.find((candidate) => String(candidate.id) === userId);

  if (kid === undefined) {
    notFound();
  }

  const entries = await fetchHistoryAction(kid.id, HISTORY_LIMIT);

  return (
    <div className="flex flex-col gap-4 lg:max-w-2xl lg:gap-6">
      <Panel
        note={
          entries.length === 1
            ? "1 lançamento"
            : `${entries.length} lançamentos`
        }
        title={`Histórico de ${kid.displayName}`}
        top
      >
        <EntryList
          emptyText={`${kid.displayName} ainda não tem lançamentos. O que ele ganhar, gastar ou tiver recusado aparece aqui, do mais recente para o mais antigo.`}
          entries={entries}
        />
      </Panel>

      {/*
        The same ceiling the boy's own screen draws, and the same sentence: a
        list that stops without saying so is worse than one that stops.
      */}
      {entries.length === HISTORY_LIMIT ? (
        <Panel title="Aviso">
          <PanelText>
            Mostrando os {HISTORY_LIMIT} lançamentos mais recentes.
          </PanelText>
        </Panel>
      ) : null}
    </div>
  );
}
