import { formatHours } from "../../../ui/hours";
import { CardLink, LinkButton } from "../../../ui/link-button";
import { Panel, PanelText } from "../../../ui/panel";
import { PendingMark } from "../../../ui/pending";
import { balanceToneClass, META_CLASS } from "../../../ui/style";
import { fetchBalanceAction } from "../../actions/balance";
import { listKidsAction } from "../../actions/people";
import { countPendingLogsAction } from "../../actions/queue";

/**
 * Balances go through `fetchBalanceAction`, the endpoint a kid is refused on for
 * his brother's id. Liberar and Estornar live here: the bottom bar already holds
 * four tabs. Each balance cell links to that boy's history (#73).
 */
export default async function AdminHomePage() {
  const kids = await listKidsAction();
  const [pending, balances] = await Promise.all([
    countPendingLogsAction(),
    Promise.all(
      kids.map(async (kid) => ({
        ...kid,
        hours: await fetchBalanceAction(kid.id),
      })),
    ),
  ]);

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      <div className="flex flex-col gap-4 lg:gap-6">
        <Panel title="Saldos" top>
          {/*
            Side by side, because they are read against each other. The whole
            cell is the link, and `flush` keeps it a cell of this panel.
          */}
          {balances.length === 0 ? (
            <PanelText>Nenhum menino cadastrado.</PanelText>
          ) : null}
          <ul className="grid grid-cols-2 divide-x-2 divide-black">
            {balances.map((kid) => (
              <li key={kid.id}>
                <CardLink flush href={`/admin/historico/${kid.id}`}>
                  <span className={`${META_CLASS} break-words text-black`}>
                    {kid.displayName}
                  </span>
                  <span
                    className={`${balanceToneClass(kid.hours)} font-mono text-2xl font-bold leading-none tabular-nums`}
                  >
                    {formatHours(kid.hours)}
                  </span>
                  <span className={`${META_CLASS} text-black`}>
                    Ver histórico
                  </span>
                </CardLink>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Yellow only when something waits, or the adult learns to stop seeing it. */}
        <LinkButton href="/admin/fila" variant="secondary">
          Fila de aprovação
          {pending === 0 ? (
            <span className={META_CLASS}>nada esperando</span>
          ) : (
            <PendingMark>
              {pending === 1 ? "1 esperando" : `${pending} esperando`}
            </PendingMark>
          )}
        </LinkButton>
      </div>

      <div className="flex flex-col gap-4 lg:gap-6">
        <Panel title="Do dia a dia">
          <div className="flex flex-col gap-3 p-3">
            <LinkButton href="/admin/lancar">Lançar atividade</LinkButton>
            <LinkButton href="/admin/liberar">Liberar horas</LinkButton>
            <LinkButton href="/admin/estornar">Estornar horas</LinkButton>
          </div>
        </Panel>
      </div>
    </div>
  );
}
