import { requireSession } from "../../../auth/guard";
import { saoPauloDay } from "../../../engine/calculate";
import { formatDay } from "../../../ui/dates";
import { EntryList, RECENT_ENTRIES_LIMIT } from "../../../ui/entries";
import { formatHours } from "../../../ui/hours";
import { LinkButton } from "../../../ui/link-button";
import { Panel } from "../../../ui/panel";
import {
  BALANCE_CLASS,
  BALANCE_FACE_CLASS,
  balanceToneClass,
} from "../../../ui/style";
import { fetchBalanceAction } from "../../actions/balance";
import { fetchLedgerEntriesAction } from "../../actions/history";

/**
 * Everything goes through server actions with `session.userId`, so screen and
 * endpoint share one guard (#13). The balance is the largest thing by far; one
 * `lg:grid` makes the same panels two columns on a wide screen.
 */
export default async function KidHomePage() {
  const session = await requireSession();
  const today = saoPauloDay(new Date());

  const [balance, entries] = await Promise.all([
    fetchBalanceAction(session.userId),
    fetchLedgerEntriesAction(session.userId, RECENT_ENTRIES_LIMIT),
  ]);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4 lg:gap-6">
          <Panel note={formatDay(today)} title="Seu saldo" top>
            {/*
              A negative balance is shown like any other, only its ink changes:
              hiding or capping it would be the app lying about its one number.
            */}
            <p
              className={`${balanceToneClass(balance)} ${BALANCE_CLASS} ${BALANCE_FACE_CLASS}`}
            >
              {formatHours(balance)}
            </p>
          </Panel>

          <LinkButton href="/menino/cronometro">Começar atividade</LinkButton>
        </div>

        <div className="flex flex-col gap-4 lg:gap-6">
          <Panel note="últimos 5" title="Lançamentos">
            <EntryList
              emptyText="Nada lançado ainda. O que você ganhar e o que gastar aparece aqui."
              entries={entries}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
