import type { LaunchActivity } from "../app/actions/admin";
import type { LedgerEntry } from "../app/actions/history";
import type { OpenSessionView } from "../app/actions/timer";
import type { EntryPreview, NewEntry } from "../db/admin";
import type { QueueEntry } from "../db/queue";
import type { TimerSettlement } from "../db/timers";

/**
 * The screens' pure decisions, one case at a time, run by `screens.test.ts` and
 * `screens.sabotage.test.ts` as in `src/auth/access.rules.ts`.
 */

export type ScreenRules = {
  signedHours: (entry: Pick<LedgerEntry, "hours" | "kind">) => number;
  displayedSeconds: (open: OpenSessionView, watchedMs: number) => number;
  settlementText: (settlement: TimerSettlement) => string;
  canApprove: (
    entry: Pick<QueueEntry, "blockedBy" | "qualityGraded" | "quality"> &
      Partial<Pick<QueueEntry, "durationMinutes" | "calcMode">>,
    editing: boolean,
    minutes: string,
    grade?: number | null,
    value?: string,
    override?: string,
  ) => boolean;
  parseTypedHours: (text: string) => number | null;
  entryOf: (
    form: {
      userId: number;
      activityId: number;
      occurredOn: string;
      durationMinutes: number;
      quality: number;
      freeValue: string;
      note: string;
    },
    activity: Pick<LaunchActivity, "calcMode" | "qualityGraded"> | undefined,
  ) => NewEntry | null;
  canConfirm: (preview: EntryPreview | null) => boolean;
  canRefund: (hours: string, reason: string) => boolean;
};

export type ScreenCase = {
  rule: string;
  name: string;
  run: (rules: ScreenRules) => unknown;
  expected: unknown;
};

const RUNNING: OpenSessionView = {
  activityId: 5,
  activityName: "Ler livro",
  categoryName: "Mente",
  status: "running",
  activeSeconds: 1800,
  maxSessionMinutes: 120,
  minSessionMinutes: 5,
};

const PAUSED: OpenSessionView = { ...RUNNING, status: "paused" };

const NEARLY_DONE: OpenSessionView = { ...RUNNING, activeSeconds: 7199 };

const FORM = {
  userId: 3,
  activityId: 5,
  occurredOn: "2026-09-10",
  durationMinutes: 60,
  quality: 1,
  freeValue: "",
  note: "",
};

const DURATION_ACTIVITY = {
  calcMode: "duration",
  qualityGraded: false,
} as const;
const GRADED_ACTIVITY = { calcMode: "delivery", qualityGraded: true } as const;
const FREE_ACTIVITY = { calcMode: "free", qualityGraded: false } as const;

const PREVIEW: EntryPreview = {
  calculation: { hours: 3, lines: [] },
  blockedBy: null,
};

function entryText(entry: NewEntry | null): string {
  if (entry === null) return "nothing";

  return `${entry.userId}/${entry.activityId} on ${entry.occurredOn} · ${entry.durationMinutes} min · nota ${entry.quality} · avulso ${entry.freeValue} · ${entry.note ?? "no note"}`;
}

export const SCREEN_CASES: readonly ScreenCase[] = [
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "a correction longer than the column takes is not offered",
    // The server refuses it too; this says so before the round trip.
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: false, quality: null },
        true,
        "1000001",
      ),
    expected: false,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "the longest the column takes is still offered",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: false, quality: null },
        true,
        "1000000",
      ),
    expected: true,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "an entry that wants a grade is not approvable without one",
    // The stopwatch never grades, so the adult grades in the correction (D37).
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: true, quality: null },
        false,
        "60",
      ),
    expected: false,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "opening the correction does not make an ungraded entry approvable",
    // The only graded case through the open branch of `canApprove`.
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: true, quality: null },
        true,
        "60",
      ),
    expected: false,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "with the grade chosen in the correction, it is",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: true, quality: null },
        true,
        "60",
        0.7,
      ),
    expected: true,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "a grade of zero counts as chosen (D10)",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: true, quality: null },
        true,
        "60",
        0,
      ),
    expected: true,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "a final value stands in for the missing grade (D50)",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: true, quality: null },
        true,
        "60",
        null,
        "",
        "0,5",
      ),
    expected: true,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "a final value of zero is a value (D50)",
    run: (rules) =>
      rules.canApprove(
        {
          blockedBy: null,
          qualityGraded: false,
          quality: null,
          durationMinutes: null,
          calcMode: "free",
        },
        true,
        "",
        null,
        "",
        "0",
      ),
    expected: true,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "a final value that is not a number is not offered (D50)",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: false, quality: null },
        true,
        "60",
        null,
        "",
        "meia",
      ),
    expected: false,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "a final value does not excuse an unusable duration (D50)",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: false, quality: null },
        true,
        "0",
        null,
        "",
        "1",
      ),
    expected: false,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "a final value typed and then closed is not what the tap sends (D50)",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: true, quality: null },
        false,
        "60",
        null,
        "",
        "1",
      ),
    expected: false,
  },

  {
    rule: "the digits count on from what the server said",
    name: "a running session adds the seconds the browser watched",
    run: (rules) => rules.displayedSeconds(RUNNING, 10_000),
    expected: 1810,
  },
  {
    rule: "the digits count on from what the server said",
    name: "a paused session shows the frozen number, however long it is left",
    run: (rules) => rules.displayedSeconds(PAUSED, 5 * 60 * 60 * 1000),
    expected: 1800,
  },
  {
    rule: "the digits count on from what the server said",
    name: "the digits stop at the limit rather than running past it",
    run: (rules) => rules.displayedSeconds(NEARLY_DONE, 60_000),
    expected: 7200,
  },
  {
    rule: "the digits count on from what the server said",
    name: "an activity with no limit is not capped",
    run: (rules) =>
      rules.displayedSeconds(
        { ...NEARLY_DONE, maxSessionMinutes: null },
        60_000,
      ),
    expected: 7259,
  },
  {
    rule: "the digits count on from what the server said",
    name: "a browser clock that ran backwards does not take seconds away",
    run: (rules) => rules.displayedSeconds(RUNNING, -60_000),
    expected: 1800,
  },

  {
    rule: "the boy is told which rule ended his session",
    name: "the limit",
    run: (rules) =>
      rules.settlementText({
        kind: "autoStopped",
        activityName: "Ler livro",
        durationMinutes: 120,
        durationSeconds: 120 * 60,
      }),
    expected:
      "A sessão de Ler livro bateu o limite e parou sozinha em 2h. O registro foi enviado para aprovação.",
  },
  {
    rule: "the boy is told which rule ended his session",
    name: "the turn of the day, which says which day it counts for",
    run: (rules) =>
      rules.settlementText({
        kind: "dayEnded",
        activityName: "Ler livro",
        durationMinutes: 30,
        durationSeconds: 30 * 60,
      }),
    expected:
      "A sessão de Ler livro fechou na virada do dia, com 30 min, e conta para o dia em que começou. O registro foi enviado para aprovação. Para continuar, comece outra.",
  },
  {
    rule: "the boy is told which rule ended his session",
    // #71: a zero-minute session is never filed, so the boy is told why.
    name: "the session under the threshold, which is not sent and says it",
    run: (rules) =>
      rules.settlementText({
        kind: "tooShort",
        activityName: "Ler livro",
        durationMinutes: null,
        durationSeconds: 21,
      }),
    expected:
      "A sessão de Ler livro durou 21s e não chegou a 30 segundos, então não virou registro. Nada foi enviado para aprovação. Da próxima vez, deixe o cronômetro correr pelo menos 30 segundos.",
  },
  {
    rule: "the boy is told which rule ended his session",
    name: "the session under the activity's floor, which names it (D44)",
    run: (rules) =>
      rules.settlementText({
        kind: "tooShort",
        activityName: "Ler livro",
        durationMinutes: null,
        durationSeconds: 299,
        minSessionMinutes: 5,
      }),
    expected:
      "A sessão de Ler livro durou 04:59 e não chegou à sessão mínima de 5 min, então não virou registro. Nada foi enviado para aprovação.",
  },
  {
    rule: "the boy is told which rule ended his session",
    name: "the abandonment, which is the only one that creates nothing",
    run: (rules) =>
      rules.settlementText({
        kind: "abandoned",
        activityName: "Ler livro",
        durationMinutes: null,
        durationSeconds: null,
      }),
    expected:
      "A sessão de Ler livro ficou pausada por mais de 12 horas e foi descartada. Nenhum registro foi criado.",
  },

  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "an entry nothing stands in front of",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: false, quality: null },
        false,
        "",
      ),
    expected: true,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "an entry with an undecided one before it (D8)",
    run: (rules) =>
      rules.canApprove(
        {
          blockedBy: {
            id: 1,
            activityName: "Ler livro",
            occurredOn: "2026-09-10",
          },
          qualityGraded: false,
          quality: null,
        },
        false,
        "",
      ),
    expected: false,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "a correction with a whole number of minutes",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: false, quality: null },
        true,
        "60",
      ),
    expected: true,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "a correction with no minutes at all",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: false, quality: null },
        true,
        "",
      ),
    expected: false,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "a correction with a fraction of a minute",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: false, quality: null },
        true,
        "1.5",
      ),
    expected: false,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "a correction with something that is not a number",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: false, quality: null },
        true,
        "uma hora",
      ),
    expected: false,
  },
  {
    rule: "approving is one tap, when it is a tap that can be taken",
    name: "a correction of zero minutes",
    run: (rules) =>
      rules.canApprove(
        { blockedBy: null, qualityGraded: false, quality: null },
        true,
        "0",
      ),
    expected: false,
  },

  {
    rule: "an entry moves the balance the way its kind says",
    name: "an earn adds",
    run: (rules) => rules.signedHours({ hours: 2, kind: "earn" }),
    expected: 2,
  },
  {
    rule: "an entry moves the balance the way its kind says",
    name: "a spend subtracts",
    run: (rules) => rules.signedHours({ hours: 1.5, kind: "spend" }),
    expected: -1.5,
  },
  {
    rule: "an entry moves the balance the way its kind says",
    name: "a refund adds, like an earn",
    run: (rules) => rules.signedHours({ hours: 0.25, kind: "refund" }),
    expected: 0.25,
  },
  {
    rule: "a typed number of hours is read the way it was typed",
    name: "a comma is the decimal separator, as it is everywhere else",
    run: (rules) => rules.parseTypedHours("1,5"),
    expected: 1.5,
  },
  {
    rule: "a typed number of hours is read the way it was typed",
    name: "a full stop is taken too",
    run: (rules) => rules.parseTypedHours("1.5"),
    expected: 1.5,
  },
  {
    rule: "a typed number of hours is read the way it was typed",
    name: "zero is a number, and not nothing",
    run: (rules) => rules.parseTypedHours("0"),
    expected: 0,
  },
  {
    rule: "a typed number of hours is read the way it was typed",
    name: "an empty field is nothing, and not zero",
    run: (rules) => rules.parseTypedHours(""),
    expected: null,
  },
  {
    rule: "a typed number of hours is read the way it was typed",
    name: "a field of spaces is nothing either",
    run: (rules) => rules.parseTypedHours("   "),
    expected: null,
  },
  {
    rule: "a typed number of hours is read the way it was typed",
    name: "words are not hours",
    run: (rules) => rules.parseTypedHours("duas"),
    expected: null,
  },
  {
    rule: "a typed number of hours is read the way it was typed",
    name: "two commas are not a number",
    run: (rules) => rules.parseTypedHours("1,5,0"),
    expected: null,
  },
  {
    rule: "a typed number of hours is read the way it was typed",
    name: "a negative amount is not one either",
    run: (rules) => rules.parseTypedHours("-1"),
    expected: null,
  },

  {
    rule: "the form describes an entry before it is sent",
    name: "a duration activity carries its duration and nothing else",
    run: (rules) => entryText(rules.entryOf(FORM, DURATION_ACTIVITY)),
    expected: "3/5 on 2026-09-10 · 60 min · nota null · avulso null · no note",
  },
  {
    rule: "the form describes an entry before it is sent",
    name: "a graded activity carries its grade and no duration",
    run: (rules) => entryText(rules.entryOf(FORM, GRADED_ACTIVITY)),
    expected: "3/5 on 2026-09-10 · null min · nota 1 · avulso null · no note",
  },
  {
    rule: "the form describes an entry before it is sent",
    name: "a free activity carries the value the adult typed",
    run: (rules) =>
      entryText(rules.entryOf({ ...FORM, freeValue: "2,5" }, FREE_ACTIVITY)),
    expected: "3/5 on 2026-09-10 · null min · nota null · avulso 2.5 · no note",
  },
  {
    rule: "the form describes an entry before it is sent",
    name: "a free activity with nothing typed is not an entry yet",
    run: (rules) => entryText(rules.entryOf(FORM, FREE_ACTIVITY)),
    expected: "nothing",
  },
  {
    rule: "the form describes an entry before it is sent",
    name: "no activity at all is not an entry",
    run: (rules) => entryText(rules.entryOf(FORM, undefined)),
    expected: "nothing",
  },
  {
    rule: "the form describes an entry before it is sent",
    name: "a note of spaces is no note",
    run: (rules) =>
      entryText(rules.entryOf({ ...FORM, note: "   " }, DURATION_ACTIVITY)),
    expected: "3/5 on 2026-09-10 · 60 min · nota null · avulso null · no note",
  },
  {
    rule: "the form describes an entry before it is sent",
    name: "a note the adult wrote is carried",
    run: (rules) =>
      entryText(
        rules.entryOf({ ...FORM, note: " leu no carro " }, DURATION_ACTIVITY),
      ),
    expected:
      "3/5 on 2026-09-10 · 60 min · nota null · avulso null · leu no carro",
  },

  {
    rule: "the launch is confirmed only when the preview allows it",
    name: "nothing has been asked yet",
    run: (rules) => rules.canConfirm(null),
    expected: false,
  },
  {
    rule: "the launch is confirmed only when the preview allows it",
    name: "a preview with nothing in the way",
    run: (rules) => rules.canConfirm(PREVIEW),
    expected: true,
  },
  {
    rule: "the launch is confirmed only when the preview allows it",
    name: "an entry waiting to be decided first (D32)",
    run: (rules) =>
      rules.canConfirm({
        ...PREVIEW,
        blockedBy: {
          id: 1,
          activityName: "Ler livro",
          occurredOn: "2026-09-10",
        },
      }),
    expected: false,
  },

  {
    rule: "a refund says how much and why",
    name: "both filled in",
    run: (rules) => rules.canRefund("2", "o Xbox ficou fora do ar"),
    expected: true,
  },
  {
    rule: "a refund says how much and why",
    name: "no amount",
    run: (rules) => rules.canRefund("", "o Xbox ficou fora do ar"),
    expected: false,
  },
  {
    rule: "a refund says how much and why",
    name: "no reason",
    run: (rules) => rules.canRefund("2", "   "),
    expected: false,
  },
  {
    rule: "a refund says how much and why",
    name: "an amount that is not a number",
    run: (rules) => rules.canRefund("duas", "motivo"),
    expected: false,
  },
];

/** Empty means `rules` agrees with the criteria. */
export function failingScreenCases(rules: ScreenRules): ScreenCase[] {
  return SCREEN_CASES.filter(
    (screenCase) => screenCase.run(rules) !== screenCase.expected,
  );
}
