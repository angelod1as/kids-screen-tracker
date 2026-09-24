import { requireSession } from "../../../../auth/guard";
import { EntryList, HISTORY_LIMIT } from "../../../../ui/entries";
import { Panel, PanelText } from "../../../../ui/panel";
import { fetchHistoryAction } from "../../../actions/history";

/**
 * The boy's history (#16): what he earned and what he spent, most recent
 * first.
 *
 * The id handed to the action is `session.userId` and there is no other id on
 * this page — but that is the weaker half of "não vaza nenhum dado do outro
 * menino". The half that holds is inside the action: it filters on the id and
 * `requireAccess` refuses a request carrying the brother's, which is what a
 * POST sent by hand would carry. `src/app/actions/history.test.ts` sends it.
 *
 * It asks for the history and not for the ledger (#72): an entry an adult
 * refused moved no hours and so has no ledger row, and the boy watching it
 * vanish from this screen was how the refusal read as a bug. It is back, on the
 * day it happened, crediting nothing (D19).
 *
 * **One panel, however long the list is** (#74). This is the screen the
 * direction is really for: a ledger is a column of numbers, and the whole point
 * of the monospace face and the 1 px rule between rows is that two hundred of
 * them can be read by running a finger down the right-hand edge. The count sits
 * in the band, so the panel says how much of the ledger it is showing before
 * the first row is read.
 *
 * On a wide screen it stays one column. Two columns of a chronological list
 * would mean deciding whether it reads down the left and then down the right,
 * or across — and a reader who has to work that out has lost more than the
 * width was worth.
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

      {/*
        A list that stops without saying so is worse than one that stops. The
        ledger takes a handful of rows a day, so this line is years away; it is
        here because the limit is real and a screen may not imply it is showing
        everything when it is not.
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
