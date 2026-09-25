import {
  asymptoteHours,
  MIN_DECAY_STEP_HOURS,
  MIN_RETURN_BONUS_AFTER_DAYS,
} from "../../../../engine/limits";
import { ABANDON_AFTER_HOURS } from "../../../../engine/timer";
import { Result } from "../../../../ui/explanation";
import { formatDuration, formatHours } from "../../../../ui/hours";
import { LinkButton } from "../../../../ui/link-button";
import { Panel, PanelText } from "../../../../ui/panel";
import { READOUT_CLASS } from "../../../../ui/style";
import type { HowItWorksData } from "../../../actions/how-it-works";
import {
  decayRows,
  exampleAsymptote,
  exampleOf,
  formatDays,
  formatPercent,
  returnExample,
  SHORT_SESSION_MINUTES,
} from "./explainer";
import { ActivityValues, DecayTable, Paragraph, Points } from "./parts";

/** The adults' version (#107): the same model, plus where each number lives. */
export function AdultGuide({ data }: { data: HowItWorksData }) {
  const example = exampleOf(data);
  const comeback =
    example === null ? null : returnExample(example, data.occurredOn);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <Panel title="Como funciona" top>
        <Paragraph>
          O app guarda o saldo dos meninos e mais nada. Eles ganham horas
          fazendo atividades fora da tela; vocês aprovam, leem o saldo aqui e
          configuram os aparelhos na mão.
        </Paragraph>
        <Paragraph>
          Todo número desta página é lido da Configuração agora, e os exemplos
          são calculados pelo mesmo motor que aprova as entradas.
        </Paragraph>
      </Panel>

      <Panel title="A conta de uma entrada">
        <Points>
          <li>
            Na ordem: valor da atividade, nota, repetição, desgaste e bônus de
            retorno. O bônus multiplica o que sobrou depois do desgaste.
          </li>
          <li>
            <strong>Desgaste:</strong> a cada passo de horas de atividade
            acumuladas na categoria no dia, a hora seguinte vale metade da
            anterior. Sem piso e sem teto. O acumulado é por categoria e zera à
            meia-noite. Só atividade com duração enche o acumulado.
          </li>
          <li>
            <strong>Assíntota:</strong> taxa × passo × 2. É o que um dia inteiro
            de uma atividade se aproxima de render, sem contar o bônus de
            retorno.
          </li>
          <li>
            <strong>Bônus de retorno:</strong> incide na entrada que volta à
            categoria depois de mais dias sem ela do que o limiar. O próprio dia
            conta: uma segunda entrada no mesmo dia já não ganha. A estreia da
            categoria nunca ganha: o bônus exige uma entrada aprovada dela antes
            da janela.
          </li>
          <li>
            <strong>Repetição:</strong> a mesma atividade de novo dentro dos
            dias de espera vale metade.
          </li>
          <li>
            O valor final é arredondado uma vez só, no fim, e as linhas da
            explicação somam o total.
          </li>
        </Points>

        <table className="w-full border-t-2 border-black text-left text-black">
          <caption className="px-3 pt-3 text-left text-base font-bold text-black">
            Categorias, hoje
          </caption>
          <thead>
            <tr>
              <th className="px-1.5 py-3 text-sm font-bold" scope="col">
                Categoria
              </th>
              <th className="px-1.5 py-3 text-sm font-bold" scope="col">
                Passo
              </th>
              <th className="px-1.5 py-3 text-sm font-bold" scope="col">
                Assíntota
              </th>
              <th className="px-1.5 py-3 text-sm font-bold" scope="col">
                Bônus
              </th>
            </tr>
          </thead>
          <tbody>
            {data.categories.map((category) => {
              const asymptote = asymptoteHours(
                category.baseRate,
                category.decayStepHours,
              );

              return (
                <tr className="border-t border-black" key={category.id}>
                  <td className="break-words px-1.5 py-3 text-base font-bold">
                    {category.name}
                  </td>
                  <td
                    className={`${READOUT_CLASS} whitespace-nowrap px-1.5 py-3`}
                  >
                    {category.decayStepHours === null
                      ? "—"
                      : formatDuration(
                          Math.round(category.decayStepHours * 60),
                        )}
                  </td>
                  <td
                    className={`${READOUT_CLASS} whitespace-nowrap px-1.5 py-3`}
                  >
                    {asymptote === null ? "—" : formatHours(asymptote)}
                  </td>
                  <td className="px-1.5 py-3 text-base">
                    {category.returnBonusPct > 0
                      ? `+${formatPercent(category.returnBonusPct)}, mais de ${formatDays(category.returnBonusAfterDays)} sem`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <PanelText>
          A assíntota da tabela usa a taxa sugerida da categoria. Uma atividade
          com taxa própria chega à própria assíntota.
        </PanelText>
      </Panel>

      {example === null ? null : (
        <Panel title="Exemplo, calculado agora">
          <DecayTable
            example={example}
            rows={decayRows(example, data.occurredOn)}
          />
          <PanelText>
            Sem bônus, um dia inteiro de {example.activity.name} se aproxima de{" "}
            {formatHours(exampleAsymptote(example))} e nunca chega lá.
          </PanelText>

          {comeback === null ? null : (
            <div className="flex flex-col gap-2 px-3 pb-4">
              <p className="text-base text-black">
                {formatDuration(SHORT_SESSION_MINUTES)} de{" "}
                {example.activity.name}, primeira entrada de{" "}
                {example.category.name} em mais de{" "}
                {formatDays(example.category.returnBonusAfterDays)}:
              </p>
              <Result calculation={comeback} heading="O menino ganharia" />
            </div>
          )}
        </Panel>
      )}

      <Panel title="Onde mudar cada número">
        <Points>
          <li>
            <strong>Taxa ou valor de uma atividade:</strong> Configuração,
            atividade, campo “Taxa por hora” ou “Valor em horas”.
          </li>
          <li>
            <strong>Passo do desgaste:</strong> Configuração, categoria, campo
            “Passo do desgaste, em horas”. Vazio desliga o desgaste. O mínimo é{" "}
            {formatDuration(MIN_DECAY_STEP_HOURS * 60)}.
          </li>
          <li>
            <strong>Bônus de retorno:</strong> Configuração, categoria, campos
            “Bônus de retorno (%)” e “Bônus a partir de quantos dias sem fazer”.
            Com bônus, o limiar é de pelo menos{" "}
            {formatDays(MIN_RETURN_BONUS_AFTER_DAYS)}.
          </li>
          <li>
            <strong>Repetição:</strong> Configuração, atividade, campo “Só
            repete depois de quantos dias”. Zero desliga.
          </li>
          <li>
            <strong>Sessão mínima e limite:</strong> Configuração, atividade,
            campos “Sessão mínima, em minutos” e “Limite da sessão, em minutos”.
          </li>
          <li>
            A taxa sugerida da categoria só preenche a taxa de uma atividade
            nova. Ela não entra na conta.
          </li>
          <li>
            Mudar um número não mexe no que já foi aprovado. E enquanto houver
            entrada na fila ou cronômetro aberto que dependa dele, a
            Configuração recusa a mudança e diz qual entrada decidir antes.
          </li>
        </Points>
        <div className="px-3 pb-4">
          <LinkButton href="/admin/configuracao" variant="secondary">
            Configuração
          </LinkButton>
        </div>
      </Panel>

      <Panel title="Cronômetro">
        <Points>
          <li>Mede só o tempo ativo. Pausa não conta.</li>
          <li>
            Sessão abaixo da sessão mínima da atividade não vira registro, nem
            quando para no limite ou à meia-noite. O cronômetro avisa o menino
            antes. O que um adulto lança não tem mínimo.
          </li>
          <li>Para sozinho no limite da sessão da atividade.</li>
          <li>
            Para sozinho à meia-noite, e o registro fica no dia em que começou.
          </li>
          <li>
            Pausado por {formatDuration(ABANDON_AFTER_HOURS * 60)}, é descartado
            sem registro.
          </li>
        </Points>
      </Panel>

      <Panel title="A fila">
        <Points>
          <li>
            O que o cronômetro manda, e o que o menino pede sem cronômetro,
            chega como Pendente. Aprovar congela o valor. Recusar não gera hora,
            não conta para desgaste, bônus nem repetição, e o motivo é anexado à
            observação.
          </li>
          <li>
            Na aprovação dá para corrigir atividade, duração, nota e observação,
            e dar o valor de uma atividade avulsa pedida.
          </li>
          <li>
            <strong>Valor final:</strong> em vez de corrigir o relato, dá para
            dizer quanto a entrada vale, em horas, em qualquer atividade, fixa
            inclusive. A regra não é consultada. O desgaste do dia continua
            contando o tempo que a atividade durou, e a repetição e o bônus a
            contam como feita. O menino vê no histórico que o valor foi decidido
            por um adulto, quanto a regra daria e o motivo, se você escrever um.
          </li>
          <li>
            <strong>Ordem:</strong> uma entrada não pode ser aprovada enquanto
            houver outra pendente anterior a ela, pela data e pela hora em que
            foi criada, dentro do período que a conta dela lê. A fila já lista
            da mais antiga para a mais nova. Recusar a anterior também libera.
          </li>
          <li>
            Quem é aprovado primeiro paga cheio: o desgaste e o bônus de uma
            entrada leem o que foi aprovado antes dela.
          </li>
          <li>
            O que um adulto lança em Lançar atividade não passa pela fila.
          </li>
        </Points>
      </Panel>

      <Panel title="O que o app não faz">
        <Points>
          <li>
            Não liga nem desliga aparelho, e não guarda o que está configurado
            em cada um. Depois de Liberar horas, ajuste o aparelho na mão.
          </li>
          <li>
            O saldo pode ficar negativo. Liberar mais do que o menino tem é
            permitido, e o saldo aparece em vermelho.
          </li>
        </Points>
      </Panel>

      <ActivityValues audience="adult" data={data} />
    </div>
  );
}
