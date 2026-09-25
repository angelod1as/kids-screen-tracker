import { ABANDON_AFTER_HOURS } from "../../../../engine/timer";
import { Result } from "../../../../ui/explanation";
import { formatDuration, formatHours } from "../../../../ui/hours";
import { LinkButton } from "../../../../ui/link-button";
import { Panel, PanelText } from "../../../../ui/panel";
import type { HowItWorksData } from "../../../actions/how-it-works";
import {
  activitiesOf,
  categoriesThatDecay,
  decayRows,
  exampleAsymptote,
  exampleOf,
  formatDays,
  formatPercent,
  returnExample,
  SHORT_SESSION_MINUTES,
} from "./explainer";
import { ActivityValues, DecayTable, Paragraph, Points } from "./parts";

/** The boy's version (#107): no jargon, every number from `data` or the engine. */
export function KidGuide({ data }: { data: HowItWorksData }) {
  const example = exampleOf(data);
  const decaying = categoriesThatDecay(data);
  const steady = data.categories.filter(
    (category) => category.decayStepHours === null,
  );
  const withBonus = data.categories.filter(
    (category) => category.returnBonusPct > 0,
  );
  const comeback =
    example === null ? null : returnExample(example, data.occurredOn);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <Panel title="Como funciona" top>
        <Paragraph>
          Você ganha tempo de tela fazendo coisas longe da tela. Você marca no
          cronômetro, ou pede o que não deu para cronometrar, um adulto aprova,
          e o tempo entra no seu saldo.
        </Paragraph>
        <Paragraph>
          Os números desta página vêm da configuração de agora. Se um adulto
          mudar alguma coisa, eles mudam aqui também.
        </Paragraph>
      </Panel>

      {decaying.length === 0 ? null : (
        <Panel title="Quanto mais, menos vale">
          <Points>
            {decaying.map((category) => {
              const timed = activitiesOf(data, category)
                .filter((activity) => activity.calcMode === "duration")
                .map((activity) => activity.name);

              return (
                <li key={category.id}>
                  <strong>{category.name}</strong>: a cada{" "}
                  {formatDuration(Math.round(category.decayStepHours * 60))} no
                  mesmo dia, o tempo seguinte vale metade.
                  {timed.length === 0
                    ? null
                    : ` Soma junto o tempo de: ${timed.join(", ")}.`}
                </li>
              );
            })}
            {steady.length === 0 ? null : (
              <li>
                {steady.map((category) => category.name).join(", ")}: não perdem
                valor ao longo do dia.
              </li>
            )}
          </Points>
          <PanelText>
            À meia-noite tudo volta ao começo. Trocar de categoria também começa
            do zero.
          </PanelText>

          {example === null ? null : (
            <>
              <DecayTable
                example={example}
                rows={decayRows(example, data.occurredOn)}
              />
              <PanelText>
                Você pode fazer quanto quiser. Mas, sem contar o bônus de volta,{" "}
                {example.activity.name} chega cada vez mais perto de{" "}
                {formatHours(exampleAsymptote(example))} de tela num dia, e
                nunca passa disso.
              </PanelText>
            </>
          )}
        </Panel>
      )}

      {withBonus.length === 0 ? null : (
        <Panel title="Bônus de volta">
          <Points>
            {withBonus.map((category) => (
              <li key={category.id}>
                <strong>{category.name}</strong>: faz mais de{" "}
                {formatDays(category.returnBonusAfterDays)} sem nada de{" "}
                {category.name}? A primeira vez que você voltar ganha +
                {formatPercent(category.returnBonusPct)}.
              </li>
            ))}
          </Points>
          <PanelText>
            O bônus vem por cima do que a atividade rendeu. Depois que você
            voltou, a próxima vez do mesmo dia já não ganha. E a primeira vez
            que você faz uma categoria não tem bônus: só volta quem já esteve.
          </PanelText>

          {example === null || comeback === null ? null : (
            <div className="flex flex-col gap-2 px-3 pb-4">
              <p className="text-base text-black">
                Exemplo: {formatDuration(SHORT_SESSION_MINUTES)} de{" "}
                {example.activity.name}, depois de mais de{" "}
                {formatDays(example.category.returnBonusAfterDays)} sem{" "}
                {example.category.name}. A conta é esta:
              </p>
              <Result calculation={comeback} heading="Você ganharia" />
            </div>
          )}
        </Panel>
      )}

      <Panel title="Cronômetro">
        <Points>
          <li>Conta só o tempo que você fez. Pausa não conta.</li>
          <li>
            Cada atividade tem um tempo mínimo e um máximo (estão na lista lá
            embaixo).
          </li>
          <li>
            Parou antes do mínimo? Não vira nada. O cronômetro avisa antes, e
            você pode voltar e continuar.
          </li>
          <li>Chegou no máximo, o cronômetro para sozinho.</li>
          <li>
            À meia-noite ele para sozinho, e o tempo conta para o dia em que
            você começou.
          </li>
          <li>
            Pausado por {formatDuration(ABANDON_AFTER_HOURS * 60)}, a sessão se
            perde e nada é enviado.
          </li>
        </Points>
      </Panel>

      <Panel title="Depois de enviar">
        <Points>
          <li>
            A sessão vai para um adulto e aparece como Pendente. Ainda não está
            no seu saldo.
          </li>
          <li>
            O adulto aprova. Se precisar, ele corrige a atividade, o tempo ou a
            nota.
          </li>
          <li>
            Ele também pode decidir quanto a entrada vale, sem a conta. Aí o
            Histórico diz “valor decidido por um adulto”.
          </li>
          <li>
            A conta é feita na hora em que ele aprova, contando o que já foi
            aprovado no seu dia. Por isso pode sair diferente do que a
            Calculadora mostrou antes.
          </li>
          <li>
            Se ele recusar, aparece Recusado no seu Histórico, com o motivo
            quando ele escreve um. Vale {formatHours(0)} e não conta para nada:
            nem para o dia valer menos, nem para o bônus, nem para a regra de
            repetir.
          </li>
        </Points>
      </Panel>

      <ActivityValues audience="kid" data={data} />

      <LinkButton href="/menino/calculadora" variant="secondary">
        Testar na Calculadora
      </LinkButton>
    </div>
  );
}
