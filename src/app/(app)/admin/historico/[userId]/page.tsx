import { notFound } from "next/navigation";

import {
  EntryList,
  HISTORY_LIMIT,
  historyDays,
  MAX_HISTORY_DAYS,
  signedHours,
} from "../../../../../ui/entries";
import { LinkButton } from "../../../../../ui/link-button";
import { Panel, PanelText } from "../../../../../ui/panel";
import { fetchBalanceAction } from "../../../../actions/balance";
import { fetchHistoryDaysAction } from "../../../../actions/history";
import { listKidsAction } from "../../../../actions/people";
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
  searchParams: Promise<{ dias?: string | string[] }>;
}) {
  const [{ userId }, { dias }, kids] = await Promise.all([
    params,
    searchParams,
    listKidsAction(),
  ]);
  const days = historyDays(dias);
  const kid = kids.find((candidate) => String(candidate.id) === userId);

  if (kid === undefined) {
    notFound();
  }

  // #64: the same cut as the boy's own screen.
  const [{ entries, more }, balance] = await Promise.all([
    fetchHistoryDaysAction(kid.id, days),
    fetchBalanceAction(kid.id),
  ]);

  return (
    <div className="flex flex-col gap-4 lg:max-w-2xl lg:gap-6">
      {/* Shortcut for the common case: the adult spots a wrong entry here and debits at once. */}
      <LinkButton href={`/admin/tirar?menino=${kid.id}`}>
        Tirar horas
      </LinkButton>

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
          emptyText={`${kid.displayName} ainda não tem lançamentos. O que ele ganhar, gastar ou tiver recusado aparece aqui, do mais recente para o mais antigo.`}
          entries={entries}
          nameDecider
        />
      </Panel>

      {more && days < MAX_HISTORY_DAYS ? (
        <LinkButton
          href={`/admin/historico/${kid.id}?dias=${days + 1}`}
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
