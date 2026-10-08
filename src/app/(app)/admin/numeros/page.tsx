import type { CategoryStats } from "../../../../db/dashboard";
import { BONUS_ENABLED } from "../../../../engine/flags";
import { ChoiceLinks } from "../../../../ui/choice-links";
import { formatHours } from "../../../../ui/hours";
import { Panel, PanelText } from "../../../../ui/panel";
import {
  balanceToneClass,
  META_CLASS,
  READOUT_CLASS,
  ROW_CLASS,
} from "../../../../ui/style";
import type { DashboardPeriod } from "../../../actions/dashboard";
import { fetchDashboardAction } from "../../../actions/dashboard";
import { listKidsAction } from "../../../actions/people";
import { BalanceLine, bucketed, DayBars, FlowBars, ShareBar } from "./charts";

/**
 * #9, the instrument for #54: each panel answers one of its questions. The
 * filters are links, so the page is the server's; the guard is the action's.
 */

function rate(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function href(kid: number | null, period: DashboardPeriod): string {
  const query = new URLSearchParams();
  if (kid !== null) query.set("menino", String(kid));
  if (period === "all") query.set("periodo", "tudo");
  const text = query.toString();

  return text === "" ? "/admin/numeros" : `/admin/numeros?${text}`;
}

function DecayAndBonus({ category }: { category: CategoryStats }) {
  const { split } = category;
  const total = split.rule + split.decay + split.bonus;

  return (
    <li className="flex flex-col gap-2 border-t border-black px-3 py-3 first:border-t-0">
      <span className="text-base font-bold text-black">{category.name}</span>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-base text-black">
        <dt>Pela tabela</dt>
        <dd className="text-right font-mono tabular-nums">
          {formatHours(split.rule)}
        </dd>
        {category.decayStepHours === null ? null : (
          <>
            <dt>Desgaste</dt>
            <dd className="text-right font-mono tabular-nums">
              {formatHours(split.decay)}
            </dd>
          </>
        )}
        {BONUS_ENABLED && category.alternationBonusPct > 0 ? (
          <>
            <dt>Bônus de alternância</dt>
            <dd className="text-right font-mono tabular-nums">
              +{formatHours(split.bonus)}
            </dd>
          </>
        ) : null}
        <dt className="font-bold">Resultado</dt>
        <dd className="text-right font-mono font-bold tabular-nums">
          {formatHours(Math.round(total * 100) / 100)}
        </dd>
      </dl>
      {category.decayStepHours === null ? (
        <p className="text-base text-black">Sem desgaste.</p>
      ) : (
        <p className="text-base text-black">
          Passou de um passo ({formatHours(category.decayStepHours)}) em{" "}
          {category.kidDaysPastStep} de {count(category.kidDays, "dia", "dias")}
          .
        </p>
      )}
      {BONUS_ENABLED && category.alternationBonusPct > 0 ? (
        <p className="text-base text-black">
          {count(category.bonusEntries, "entrada", "entradas")} com bônus de
          alternância.
        </p>
      ) : null}
      {category.excluded > 0 ? (
        <p className="text-base text-black">
          {category.excluded === 1
            ? "1 entrada desta categoria ficou fora desta conta"
            : `${category.excluded} entradas desta categoria ficaram fora desta conta`}
          , e o desgaste{BONUS_ENABLED ? " e o bônus" : ""} del
          {category.excluded === 1 ? "a" : "as"} não aparece
          {BONUS_ENABLED ? "m" : ""} aqui.
        </p>
      ) : null}
    </li>
  );
}

export default async function AdminNumbersPage({
  searchParams,
}: {
  searchParams: Promise<{ menino?: string; periodo?: string }>;
}) {
  const [query, kids] = await Promise.all([searchParams, listKidsAction()]);
  const kid = kids.find((candidate) => String(candidate.id) === query.menino);
  const kidId = kid?.id ?? null;
  const period: DashboardPeriod = query.periodo === "tudo" ? "all" : "4w";

  const dashboard = await fetchDashboardAction({ kidId, period });

  const used = dashboard.categories.filter((category) => category.entries > 0);
  const series = dashboard.categories.map((category) =>
    bucketed(category.earnedPerDay),
  );
  const tallest = Math.max(0, ...series.flat());
  const weekly =
    bucketed(dashboard.days.map(() => 0)).length !== dashboard.days.length;
  const mostEntries = Math.max(1, ...dashboard.used.map((use) => use.entries));

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <Panel title="Números" top>
        <div className="flex flex-col gap-3 p-3 lg:flex-row lg:gap-6">
          <div className="lg:flex-1">
            <ChoiceLinks
              label="Menino"
              options={[
                {
                  href: href(null, period),
                  label: "Os dois",
                  chosen: kidId === null,
                },
                ...kids.map((option) => ({
                  href: href(option.id, period),
                  label: option.displayName,
                  chosen: option.id === kidId,
                })),
              ]}
            />
          </div>
          <div className="lg:flex-1">
            <ChoiceLinks
              label="Período"
              options={[
                {
                  href: href(kidId, "4w"),
                  label: "4 semanas",
                  chosen: period === "4w",
                },
                {
                  href: href(kidId, "all"),
                  label: "Tudo",
                  chosen: period === "all",
                },
              ]}
            />
          </div>
        </div>
      </Panel>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4 lg:gap-6">
          <Panel
            note={weekly ? "por semana" : "por dia"}
            title="Horas por categoria"
          >
            <ul>
              {dashboard.categories.map((category, index) => (
                <li
                  className="flex flex-col gap-1 border-t border-black px-3 py-3 first:border-t-0"
                  key={category.id}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-base font-bold text-black">
                      {category.name}
                    </span>
                    <span className={`${READOUT_CLASS} text-black`}>
                      {formatHours(category.earned)}
                    </span>
                  </div>
                  <DayBars
                    label={`${category.name}: ${formatHours(category.earned)} ganhas no período`}
                    max={tallest}
                    values={series[index] ?? []}
                  />
                  <span className={`${META_CLASS} text-black`}>
                    {category.entries === 0
                      ? "nenhum registro"
                      : [
                          count(category.entries, "registro", "registros"),
                          category.activityMinutes > 0
                            ? `atividade ${formatHours(category.activityMinutes / 60)}`
                            : null,
                          category.activityMinutes > 0
                            ? `rende ${rate(category.activityEarned / (category.activityMinutes / 60))} por hora`
                            : null,
                        ]
                          .filter((part) => part !== null)
                          .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title={BONUS_ENABLED ? "Desgaste e bônus" : "Desgaste"}>
            {used.length === 0 ? (
              <PanelText>Nenhum registro no período.</PanelText>
            ) : (
              <ul>
                {used.map((category) => (
                  <DecayAndBonus category={category} key={category.id} />
                ))}
              </ul>
            )}
            {dashboard.overridden + dashboard.unreproduced > 0 ? (
              <PanelText>
                Fora desta conta:{" "}
                {[
                  dashboard.overridden > 0
                    ? `${count(dashboard.overridden, "entrada", "entradas")} com valor decidido por um adulto`
                    : null,
                  dashboard.unreproduced > 0
                    ? `${count(dashboard.unreproduced, "entrada", "entradas")} que a tabela de hoje não reproduz`
                    : null,
                ]
                  .filter((part) => part !== null)
                  .join(" e ")}
                .
              </PanelText>
            ) : null}
          </Panel>
        </div>

        <div className="flex flex-col gap-4 lg:gap-6">
          {dashboard.balances.map((balance) => {
            const end = balance.points.at(-1)?.balance ?? 0;

            return (
              <Panel
                key={balance.id}
                note={
                  <span className={`${balanceToneClass(end)} bg-white px-1`}>
                    {formatHours(end)}
                  </span>
                }
                title={`Saldo de ${balance.displayName}`}
              >
                <div className="flex flex-col gap-2 p-3">
                  <BalanceLine
                    label={`Saldo de ${balance.displayName} no período, terminando em ${formatHours(end)}`}
                    points={balance.points}
                  />
                  <FlowBars
                    flows={[
                      {
                        label: "Lançadas",
                        total: balance.earned,
                        values: bucketed(balance.earnedPerDay),
                      },
                      {
                        label: "Dadas",
                        total: balance.refunded,
                        values: bucketed(balance.givenPerDay),
                      },
                      {
                        label: "Tiradas",
                        total: balance.spent,
                        values: bucketed(balance.takenPerDay),
                      },
                    ]}
                  />
                </div>
              </Panel>
            );
          })}

          <Panel title="Atividades">
            {dashboard.used.length === 0 ? (
              <PanelText>Nenhuma atividade registrada no período.</PanelText>
            ) : (
              <ul>
                {dashboard.used.map((use) => (
                  <li className={`${ROW_CLASS} flex-col`} key={use.id}>
                    <div className="flex w-full items-baseline justify-between gap-3">
                      <span className="text-base text-black">
                        <span className="font-bold">{use.name}</span>
                        <span className={`${META_CLASS} block`}>
                          {use.categoryName}
                        </span>
                      </span>
                      <span className="text-right font-mono text-base tabular-nums text-black">
                        {count(use.entries, "vez", "vezes")} ·{" "}
                        {formatHours(use.earned)}
                      </span>
                    </div>
                    <ShareBar share={use.entries / mostEntries} />
                  </li>
                ))}
              </ul>
            )}
            {dashboard.unused.length > 0 ? (
              <div className="flex flex-col gap-1 border-t-2 border-black px-3 py-3">
                <span className={`${META_CLASS} text-black`}>
                  Sem uso no período ({dashboard.unused.length})
                </span>
                <p className="text-base text-black">
                  {dashboard.unused.map((use) => use.name).join(", ")}
                </p>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
