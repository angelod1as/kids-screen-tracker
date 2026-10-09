import { notFound } from "next/navigation";

import {
  entriesForTab,
  HISTORY_LIMIT,
  HistoryStatement,
  historyDays,
  historyTab,
  MAX_HISTORY_DAYS,
  signedHours,
} from "../../../../../ui/entries";
import { LinkButton } from "../../../../../ui/link-button";
import { Panel, PanelText } from "../../../../../ui/panel";
import { fetchRunningTimersAction } from "../../../../actions/admin-timers";
import { fetchBalanceAction } from "../../../../actions/balance";
import { fetchHistoryDaysAction } from "../../../../actions/history";
import { listKidsAction } from "../../../../actions/people";
import { TimerControl } from "./timer-control";
import { VoidControl } from "./void-control";

/**
 * The boy's own list component, so the two screens cannot drift. The URL id is
 * not a permission (`requireAccess` in the action is); the check below makes a
 * non-kid id a 404 rather than an empty history.
 */
export default async function AdminKidHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ dias?: string | string[]; aba?: string | string[] }>;
}) {
  const [{ userId }, { dias, aba }, kids] = await Promise.all([
    params,
    searchParams,
    listKidsAction(),
  ]);
  const days = historyDays(dias);
  const tab = historyTab(aba);
  const kid = kids.find((candidate) => String(candidate.id) === userId);

  if (kid === undefined) {
    notFound();
  }

  // #64: the same cut as the boy's own screen.
  const [{ entries, more }, balance, running] = await Promise.all([
    fetchHistoryDaysAction(kid.id, days),
    fetchBalanceAction(kid.id),
    fetchRunningTimersAction(),
  ]);
  const openTimer = running.find((timer) => timer.userId === kid.id) ?? null;
  const shown = entriesForTab(entries, tab);

  return (
    <div className="flex flex-col gap-4 lg:max-w-2xl lg:gap-6">
      {/* #84: only when a session is open, and in the boy's own space. */}
      {openTimer === null ? null : (
        <Panel title="Cronômetro">
          <TimerControl timer={openTimer} />
        </Panel>
      )}

      {/* Shortcut for the common case: the adult spots a wrong entry here and debits at once. */}
      <LinkButton href={`/admin/tirar?menino=${kid.id}`}>
        Tirar horas
      </LinkButton>

      <Panel
        note={
          shown.length === 1 ? "1 lançamento" : `${shown.length} lançamentos`
        }
        title={`Histórico de ${kid.displayName}`}
        top
      >
        <HistoryStatement
          action={(entry) => (
            <VoidControl
              after={
                entry.kind === "zero"
                  ? balance
                  : // D9: two decimals, as the balance itself.
                    Math.round((balance - signedHours(entry)) * 100) / 100
              }
              before={balance}
              // A zero has no ledger row (D10); its id is the log's.
              target={{
                kind: entry.kind === "zero" ? "log" : "ledger",
                id: entry.id,
              }}
            />
          )}
          basePath={`/admin/historico/${kid.id}`}
          days={days}
          emptyText={`${kid.displayName} ainda não tem lançamentos. O que ele ganhar, gastar ou tiver recusado aparece aqui, do mais recente para o mais antigo.`}
          entries={shown}
          nameDecider
          tab={tab}
        />
      </Panel>

      {more && days < MAX_HISTORY_DAYS ? (
        <LinkButton
          href={`/admin/historico/${kid.id}?dias=${days + 1}&aba=${tab}`}
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
