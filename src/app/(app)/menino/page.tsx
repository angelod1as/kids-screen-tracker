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
 * The boy's home screen (#15) — "a tela que eles vão abrir dez vezes por dia".
 *
 * Everything on it goes through a server action rather than a query written
 * here, and the id every one of them gets is `session.userId`, the only id this
 * page has. That is not politeness: it means the screen and the endpoint behind
 * it pass through the same guard, so there is no second path to a number that
 * could be guarded differently (#13).
 *
 * The order is what a boy opening the app ten times a day is looking for, in
 * order: how much he has, and how to earn more.
 *
 * **Two panels and one control** (#74). The balance panel is a readout and
 * nothing else — a band with the date on it, then the number, centred, in the
 * monospace face, at 3.75 rem against the 1 rem of every label on the screen.
 * Nothing else here is allowed to be bigger than a label, which is what "por
 * larga margem" costs: the two lists below are dense rows, not headlines.
 *
 * **On a wide screen the same panels become two columns.** The left is the
 * state of things — what he has and what he can start — and the right is what
 * happened, which is the only part that grows without limit.
 * No screen is duplicated and no component is conditional: one `lg:grid` on the
 * wrapper, and the phone layout is what happens when the grid is off.
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
              The largest thing on the screen by a factor of nearly four. A
              negative balance is shown exactly like any other — same place,
              same size, same two decimals — and only its ink changes, because
              hiding it or capping it at zero would be the app lying about the
              one number it exists to hold.
            */}
            <p
              className={`${balanceToneClass(balance)} ${BALANCE_CLASS} ${BALANCE_FACE_CLASS}`}
            >
              {formatHours(balance)}
            </p>
          </Panel>

          {/*
            One tap to start earning, and it is the biggest control on the
            screen — the only thing on it that is not either a reading or a
            label.
          */}
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
