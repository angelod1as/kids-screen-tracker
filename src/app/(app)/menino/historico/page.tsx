import { requireSession } from "../../../../auth/guard";
import {
  EntryList,
  HISTORY_LIMIT,
  historyDays,
  MAX_HISTORY_DAYS,
} from "../../../../ui/entries";
import { LinkButton } from "../../../../ui/link-button";
import { Panel, PanelText } from "../../../../ui/panel";
import { fetchHistoryDaysAction } from "../../../actions/history";

/**
 * The action, not this page, keeps the brother's data out (`requireAccess`).
 * History, not ledger (#72): a refusal moves no hours but must not vanish (D19).
 */
export default async function KidHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string | string[] }>;
}) {
  const session = await requireSession();
  const days = historyDays((await searchParams).dias);
  const { entries, more } = await fetchHistoryDaysAction(session.userId, days);

  return (
    <div className="flex flex-col gap-4 lg:gap-6 lg:max-w-2xl">
      <Panel
        note={
          entries.length === 1
            ? "1 lançamento"
            : `${entries.length} lançamentos`
        }
        title="Histórico"
        top
      >
        <EntryList
          emptyText="Você ainda não tem lançamentos. Quando ganhar ou gastar horas, elas aparecem aqui, da mais recente para a mais antiga."
          entries={entries}
        />
      </Panel>

      {more && days < MAX_HISTORY_DAYS ? (
        <LinkButton
          href={`/menino/historico?dias=${days + 1}`}
          scroll={false}
          variant="secondary"
        >
          Ver mais
        </LinkButton>
      ) : null}

      {/* A list that stops must say so. */}
      {entries.length === HISTORY_LIMIT ? (
        <Panel title="Aviso">
          <PanelText>
            Mostrando os {HISTORY_LIMIT} lançamentos mais recentes.
          </PanelText>
        </Panel>
      ) : more && days === MAX_HISTORY_DAYS ? (
        <Panel title="Aviso">
          <PanelText>
            Mostrando os {MAX_HISTORY_DAYS} dias mais recentes com lançamentos.
          </PanelText>
        </Panel>
      ) : null}
    </div>
  );
}
