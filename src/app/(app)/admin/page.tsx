import { formatHours } from "../../../ui/hours";
import { CardLink, LinkButton } from "../../../ui/link-button";
import { Panel, PanelText } from "../../../ui/panel";
import { PendingMark } from "../../../ui/pending";
import { balanceToneClass, META_CLASS } from "../../../ui/style";
import { fetchBalanceAction } from "../../actions/balance";
import { listKidsAction } from "../../actions/people";
import { countPendingLogsAction } from "../../actions/queue";

/**
 * The admin's home screen (#21): where both boys stand, what is waiting, and
 * the three things an adult does on an ordinary day.
 *
 * The order is the order of an adult opening the app: the two numbers he came
 * to read, then the one thing that needs a decision from him, then the three
 * actions. Everything else — the queue itself, the configuration — is in the
 * bar at the bottom, because it is either already counted here or not part of a
 * Tuesday.
 *
 * The balances go through `fetchBalanceAction`, the same endpoint a kid is
 * refused on for his brother's id. That is "admin vê e altera tudo dos dois"
 * from the other side: the rule is about who is asking, not about which screen
 * is drawing.
 *
 * **Liberar and Estornar are not in the bottom bar.** Four tabs already share
 * the width of a phone (`src/ui/navigation.ts`), and #21 puts these where an
 * adult looks for them: on the screen he lands on.
 *
 * **Each balance is a link to that boy's history (#73).** "Kid1 17h13" is
 * the thing an adult reads first and then wants to ask a question about, and
 * the question is always the same one: from what. One tap from the screen he
 * lands on, and the card is the target — not a word beside it — so the whole
 * block a thumb aims at is the block that answers.
 *
 * **The two of them are one panel split down the middle** (#74), not two cards
 * side by side. The adult reads them against each other, so the 2 px rule
 * between them is the same rule that would separate two dials on one
 * instrument, and both numbers are set in the monospace face at the same size —
 * which is the only way `−5h30` and `17h13` can be compared at a glance.
 * Neither is the size of the boy's own balance: this is a reading an adult
 * takes, not the number a screen exists to hold.
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
            Side by side, which is the criterion and also the only arrangement
            that answers the question an adult is actually asking — the two
            numbers are read against each other. At 320 CSS px each cell is
            156 px wide, so the name sits above the number rather than beside
            it, and the number keeps `tabular-nums` so the digits do not shift
            between the two cells.

            Each cell is the link to that boy's history (#73), and it is the
            whole cell rather than a word inside it: the block a thumb aims at
            is the block that answers the question. `flush` is what keeps it a
            cell of this panel instead of a card with a frame of its own.
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

        {/*
          The pendency, in the one colour CLAUDE.md spends on it and on nothing
          else — and only when there is one. A yellow mark reading "nada
          esperando" would teach an adult to stop seeing the yellow, which is
          the whole value of having spent a colour on it.
        */}
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
