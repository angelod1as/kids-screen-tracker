import { requireSession } from "../../../../auth/guard";
import { EntryList, HISTORY_LIMIT } from "../../../../ui/entries";
import { Panel, PanelText } from "../../../../ui/panel";
import { fetchHistoryAction } from "../../../actions/history";

/**
 * The action, not this page, keeps the brother's data out (`requireAccess`).
 * History, not ledger (#72): a refusal moves no hours but must not vanish (D19).
 */
export default async function KidHistoryPage() {
  const session = await requireSession();
  const entries = await fetchHistoryAction(session.userId, HISTORY_LIMIT);

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

      {/* A list that stops must say so. */}
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
