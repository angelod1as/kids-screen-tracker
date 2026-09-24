import type { ReactNode } from "react";

import { formatDuration, formatHours } from "../../../../ui/hours";
import { Panel } from "../../../../ui/panel";
import { META_CLASS, READOUT_CLASS } from "../../../../ui/style";
import type {
  HowItWorksActivity,
  HowItWorksData,
} from "../../../actions/how-it-works";
import type { DecayRow, Example } from "./explainer";
import { activitiesOf, formatDays } from "./explainer";

export function Paragraph({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-4 text-base text-black last:pb-4">{children}</p>;
}

export function Points({ children }: { children: ReactNode }) {
  return (
    <ul className="flex list-disc flex-col gap-2 px-3 py-4 pl-8 text-base text-black">
      {children}
    </ul>
  );
}

function worth(
  activity: HowItWorksActivity,
  audience: "kid" | "adult",
): string {
  if (activity.value === null) {
    return audience === "kid"
      ? "quanto vale, o adulto decide na hora"
      : "o valor é digitado no lançamento";
  }

  switch (activity.calcMode) {
    case "duration":
      return `cada hora vale ${formatHours(activity.value)} de tela`;
    case "delivery":
      return `vale até ${formatHours(activity.value)} de tela, conforme a nota`;
    default:
      return `vale ${formatHours(activity.value)} de tela`;
  }
}

function extras(activity: HowItWorksActivity): string[] {
  const lines: string[] = [];

  if (activity.qualityGraded && activity.calcMode !== "delivery") {
    lines.push("depende da nota");
  }
  if (activity.repeatCooldownDays > 0) {
    lines.push(
      `repetiu em até ${formatDays(activity.repeatCooldownDays)}: vale metade`,
    );
  }
  if (activity.calcMode === "duration") {
    lines.push(`mínimo de ${formatDuration(activity.minSessionMinutes)}`);
  }
  if (activity.calcMode === "duration" && activity.maxSessionMinutes !== null) {
    lines.push(
      `o cronômetro para sozinho em ${formatDuration(activity.maxSessionMinutes)}`,
    );
  }

  return lines;
}

/** Every activity, by category, with what it is worth today. */
export function ActivityValues({
  audience,
  data,
}: {
  audience: "kid" | "adult";
  data: HowItWorksData;
}) {
  return (
    <Panel title="Quanto vale cada coisa">
      {data.categories.map((category) => (
        <section className="border-t-2 border-black" key={category.id}>
          <h3 className={`${META_CLASS} px-3 pt-3 text-black`}>
            {category.name}
          </h3>
          <ul className="flex flex-col">
            {activitiesOf(data, category).map((activity) => (
              <li
                className="flex flex-col gap-1 border-t border-black px-3 py-3 first:border-t-0"
                key={activity.id}
              >
                <span className="break-words text-base font-bold text-black">
                  {activity.name}
                </span>
                <span className="text-base text-black">
                  {[worth(activity, audience), ...extras(activity)].join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Panel>
  );
}

/** The engine's own numbers for one activity across a day. */
export function DecayTable({
  example,
  rows,
}: {
  example: Example;
  rows: DecayRow[];
}) {
  return (
    <table className="w-full border-t-2 border-black text-left text-black">
      <caption className="px-3 pt-3 text-left text-base font-bold text-black">
        {example.activity.name}, num dia só
      </caption>
      <thead>
        <tr>
          <th className={`${META_CLASS} px-3 py-3`} scope="col">
            Tempo no dia
          </th>
          <th className={`${META_CLASS} px-3 py-3 text-right`} scope="col">
            Esse pedaço
          </th>
          <th className={`${META_CLASS} px-3 py-3 text-right`} scope="col">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr className="border-t border-black" key={row.minutes}>
            <td className={`${READOUT_CLASS} px-3 py-3`}>
              {formatDuration(row.minutes)}
            </td>
            <td className={`${READOUT_CLASS} px-3 py-3 text-right`}>
              +{formatHours(row.gain)}
            </td>
            <td className={`${READOUT_CLASS} px-3 py-3 text-right`}>
              {formatHours(row.total)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
