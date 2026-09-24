"use client";

import { useEffect, useState, useTransition } from "react";

import type { TimerSettlement } from "../../../../db/timers";
import { reachesMinimum } from "../../../../engine/timer";
import { Button } from "../../../../ui/button";
import { formatDay } from "../../../../ui/dates";
import { RESYNCED_TEXT, timerFailureText } from "../../../../ui/failure";
import { Field } from "../../../../ui/field";
import {
  formatClock,
  formatDuration,
  formatRecordedDuration,
} from "../../../../ui/hours";
import { Panel, PanelText } from "../../../../ui/panel";
import { PendingMark } from "../../../../ui/pending";
import { Select } from "../../../../ui/select";
import { BALANCE_CLASS, META_CLASS, ROW_CLASS } from "../../../../ui/style";
import type { OpenSessionView, TimerScreenData } from "../../../actions/timer";
import {
  fetchTimerScreenAction,
  pauseTimerAction,
  resumeTimerAction,
  startTimerAction,
  stopTimerAction,
} from "../../../actions/timer";

/**
 * The boy's timer (#18).
 *
 * **Nothing on this screen interrupts him.** No confirmation every so often, no
 * alert when the limit is near, no notification, no dialog, no sound. That is
 * the spec's rule and not a preference, and it is the reason the only timer in
 * this file is the one that redraws the digits: `timer-screen.test.tsx` reads
 * this source and fails if `alert`, `confirm`, `Notification` or a second
 * `setInterval` ever turns up in it.
 *
 * **The state is the server's.** Everything here is drawn from what an action
 * answered, and every button is an action: closing the tab loses nothing,
 * because there is nothing in the browser to lose. The digits do count up
 * locally between two answers — a clock that only moved when the network did
 * would be a clock nobody believes — and they count up from the number the
 * server gave, using the difference between two readings of the browser's own
 * `Date.now()`. The value that reaches the record is never this one.
 *
 * **The clock is the readout and the panel is the instrument** (#74). The
 * digits are set in the monospace face at the same size as the balance on the
 * home screen, because they are the same kind of thing: the one number the
 * screen exists to show. What the session is, and whether it is counting, sit
 * in the band above it, so the number below never has to share its line.
 *
 * The stop is two taps and the first of them is real: *Parar* pauses the
 * session on the server, so the duration is frozen at the moment he said he was
 * finished and not at the moment he finishes typing. If he closes the tab in
 * between, he comes back to a paused session — and a paused session left for
 * twelve hours is D16's `abandoned`, which is the rule that already covers "he
 * never came back", rather than a fourth state invented here.
 */

/** Seconds in a minute, for the cap below. */
const SECONDS_PER_MINUTE = 60;

export function TimerScreen({ initial }: { initial: TimerScreenData }) {
  const [data, setData] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [chosen, setChosen] = useState(initial.activities[0]?.id ?? 0);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  /**
   * Milliseconds the browser has watched pass since `data` arrived.
   *
   * Zero on the first render, on the server and in the browser alike, so the
   * markup React hydrates is the markup it produced. It only ever grows from an
   * interval, and only while something is running.
   */
  const [watchedMs, setWatchedMs] = useState(0);
  const open = data.open;

  // `open` is a fresh object on every answer, so the anchor is reset every time
  // the server says something new: the digits never add the browser's elapsed
  // time to a number that already contains it.
  useEffect(() => {
    setWatchedMs(0);

    if (open === null || open.status !== "running") return;

    const from = Date.now();
    const clock = setInterval(() => setWatchedMs(Date.now() - from), 1000);

    return () => clearInterval(clock);
  }, [open]);

  function act(call: () => Promise<TimerScreenData>, done?: () => void) {
    startAction(async () => {
      try {
        setData(await call());
        setFailed(null);
        done?.();
      } catch (error) {
        const recovered = await recoverFrom(error, () =>
          fetchTimerScreenAction(data.userId),
        );

        // Nothing on screen is thrown away on a failure: the confirmation and
        // the note he typed stay, so the retry is the same tap. Only a fresh
        // read that says the session is already over closes the confirmation.
        if (recovered.data !== null) {
          setData(recovered.data);
          if (recovered.data.open === null) setConfirming(false);
        }

        setFailed(recovered.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      {failed === null ? null : (
        <div className="lg:col-span-2">
          <Panel title="O que aconteceu">
            <PanelText>{failed}</PanelText>
          </Panel>
        </div>
      )}

      {open === null ? (
        <Idle
          busy={busy}
          chosen={chosen}
          data={data}
          onChoose={setChosen}
          onStart={() =>
            act(
              () => startTimerAction(data.userId, chosen),
              () => {
                setNote("");
              },
            )
          }
        />
      ) : confirming ? (
        <Confirm
          busy={busy}
          note={note}
          onBack={() => setConfirming(false)}
          onConfirm={() =>
            act(
              () => stopTimerAction(data.userId, note),
              () => {
                setConfirming(false);
                setNote("");
              },
            )
          }
          onNote={setNote}
          open={open}
        />
      ) : (
        <Session
          busy={busy}
          onPause={() => act(() => pauseTimerAction(data.userId))}
          onResume={() => act(() => resumeTimerAction(data.userId))}
          onStop={() =>
            // Pausing first is what freezes the duration at this tap. It is
            // idempotent, so tapping it while already paused keeps the pause
            // the twelve hours of D16 are counted from.
            act(
              () => pauseTimerAction(data.userId),
              () => setConfirming(true),
            )
          }
          seconds={displayedSeconds(open, watchedMs)}
          open={open}
        />
      )}

      <PendingList data={data} />
    </div>
  );
}

/**
 * What the screen does after a request failed (#29).
 *
 * The session is the server's, so the one thing a failure can cost is a screen
 * that no longer matches it: a *Parar* whose answer was lost on the way back
 * has already paused, and an *Enviar* whose answer was lost has already created
 * the record — tapping it again would be refused, because there is no open
 * session left to stop. So the screen asks again. If the read comes back, the
 * screen is redrawn from it and says so; if it does not, nothing is replaced and
 * the sentence says what to do, with the session untouched on the server.
 */
export async function recoverFrom(
  error: unknown,
  read: () => Promise<TimerScreenData>,
  online?: boolean,
): Promise<{ data: TimerScreenData | null; message: string }> {
  try {
    return { data: await read(), message: RESYNCED_TEXT };
  } catch {
    return { data: null, message: timerFailureText(error, online) };
  }
}

/**
 * The digits: what the server said, plus what the browser has watched go by.
 *
 * Capped at the activity's own limit, which is a statement about the *display*
 * and not a second copy of D16's rule — the cut itself is decided on the server,
 * from the stamps, and this only keeps the screen from reading 3h05 for a
 * session that ended at 3h00 while nobody was tapping anything.
 */
export function displayedSeconds(
  open: OpenSessionView,
  watchedMs: number,
): number {
  if (open.status !== "running") return open.activeSeconds;

  const counted = open.activeSeconds + Math.max(0, watchedMs) / 1000;
  const limit =
    open.maxSessionMinutes === null
      ? null
      : open.maxSessionMinutes * SECONDS_PER_MINUTE;

  return limit === null ? counted : Math.min(counted, limit);
}

/** A sentence the screen has to say, in a panel of its own. */
function Box({ children }: { children: React.ReactNode }) {
  return (
    <Panel title="Aviso">
      <PanelText>{children}</PanelText>
    </Panel>
  );
}

function Session({
  busy,
  onPause,
  onResume,
  onStop,
  open,
  seconds,
}: {
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  open: OpenSessionView;
  seconds: number;
}) {
  const paused = open.status === "paused";

  return (
    <section className="flex flex-col gap-4">
      <Panel
        note={paused ? "pausado" : "contando"}
        title={open.activityName}
        top
      >
        <p
          className={`${BALANCE_CLASS} block px-2 py-6 text-center font-mono font-bold leading-none tabular-nums text-black`}
        >
          {formatClock(seconds)}
        </p>
        <p className="border-t border-black px-3 py-3 text-base text-black">
          {paused
            ? "Pausado. O tempo parado não conta."
            : "Contando. Pode fechar o app; o cronômetro continua aqui."}
        </p>
      </Panel>

      <Button
        disabled={busy}
        onClick={paused ? onResume : onPause}
        type="button"
        variant="secondary"
      >
        {paused ? "Continuar" : "Pausar"}
      </Button>

      <Button disabled={busy} onClick={onStop} type="button">
        Parar
      </Button>
    </section>
  );
}

function Confirm({
  busy,
  note,
  onBack,
  onConfirm,
  onNote,
  open,
}: {
  busy: boolean;
  note: string;
  onBack: () => void;
  onConfirm: () => void;
  onNote: (value: string) => void;
  open: OpenSessionView;
}) {
  // #86: the server refuses a session under the floor (D44); the screen says so
  // before the tap rather than after it.
  const short = !reachesMinimum(open.activeSeconds, open.minSessionMinutes);

  return (
    <section className="flex flex-col gap-4">
      <Panel note="para aprovação" title="Confirme o que você fez" top>
        <p className={ROW_CLASS}>
          <span className="break-words text-base font-bold text-black">
            {open.activityName}
          </span>
          <span className="shrink-0 font-mono text-lg font-bold tabular-nums text-black">
            {short
              ? formatClock(open.activeSeconds)
              : formatRecordedDuration(open.activeSeconds)}
          </span>
        </p>
      </Panel>

      {short ? <Box>{shortText(open.minSessionMinutes)}</Box> : null}

      <Field
        id="nota"
        label="Quer contar alguma coisa? (opcional)"
        maxLength={500}
        onChange={(event) => onNote(event.target.value)}
        type="text"
        value={note}
      />

      <Button disabled={busy} onClick={onConfirm} type="button">
        {short ? "Encerrar sem enviar" : "Enviar para aprovação"}
      </Button>

      <Button
        disabled={busy}
        onClick={onBack}
        type="button"
        variant="secondary"
      >
        Voltar
      </Button>
    </section>
  );
}

function Idle({
  busy,
  chosen,
  data,
  onChoose,
  onStart,
}: {
  busy: boolean;
  chosen: number;
  data: TimerScreenData;
  onChoose: (id: number) => void;
  onStart: () => void;
}) {
  const settlement = data.settlement;
  const proposed = data.proposed;
  const categories = [
    ...new Map(
      data.activities.map((activity) => [
        activity.categoryId,
        activity.categoryName,
      ]),
    ),
  ];

  return (
    <section className="flex flex-col gap-4">
      {settlement === null ? null : <Box>{settlementText(settlement)}</Box>}

      {proposed === null ? null : (
        <Box>
          Enviado para aprovação: {proposed.activityName} ·{" "}
          {formatRecordedDuration(proposed.durationSeconds)}.
        </Box>
      )}

      {data.activities.length === 0 ? (
        <Box>Nenhuma atividade de cronômetro disponível.</Box>
      ) : (
        <Panel title="Começar uma atividade" top>
          <div className="flex flex-col gap-3 p-3">
            <Select
              id="atividade"
              label="O que você vai fazer"
              onChange={(value) => onChoose(Number(value))}
              value={String(chosen)}
            >
              {categories.map(([id, name]) => (
                <optgroup key={id} label={name}>
                  {data.activities
                    .filter((activity) => activity.categoryId === id)
                    .map((activity) => (
                      <option key={activity.id} value={activity.id}>
                        {activity.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>

            <Button disabled={busy} onClick={onStart} type="button">
              Começar
            </Button>
          </div>
        </Panel>
      )}
    </section>
  );
}

/**
 * What the boy is told about a session that ended without him filing it
 * (D16, D3, #71).
 *
 * Four sentences and not one, because the four endings are four different
 * things to him: the limit stopped a session he was in the middle of, the turn
 * of the day stopped one he began yesterday, an abandonment threw one away, and
 * a session under the activity's floor was not sent (D44). The last two create
 * nothing, and both say so — an ending that files no record and does not admit
 * it is how a boy comes to believe the app eats his afternoons.
 *
 * `tooShort` names the floor out loud, with the time he reached beside it;
 * "não deu para enviar" would leave him tapping the same button again.
 */
export function settlementText(settlement: TimerSettlement): string {
  const minutes = formatRecordedDuration(settlement.durationSeconds ?? 0);

  switch (settlement.kind) {
    case "autoStopped":
      return `A sessão de ${settlement.activityName} bateu o limite e parou sozinha em ${minutes}. O registro foi enviado para aprovação.`;
    case "dayEnded":
      return `A sessão de ${settlement.activityName} fechou na virada do dia, com ${minutes}, e conta para o dia em que começou. O registro foi enviado para aprovação. Para continuar, comece outra.`;
    case "tooShort":
      return (settlement.minSessionMinutes ?? 0) === 0
        ? `A sessão de ${settlement.activityName} durou ${minutes} e não chegou a 30 segundos, então não virou registro. Nada foi enviado para aprovação. Da próxima vez, deixe o cronômetro correr pelo menos 30 segundos.`
        : `A sessão de ${settlement.activityName} durou ${formatClock(settlement.durationSeconds ?? 0)} e não chegou à sessão mínima de ${formatDuration(settlement.minSessionMinutes ?? 0)}, então não virou registro. Nada foi enviado para aprovação.`;
    default:
      return `A sessão de ${settlement.activityName} ficou pausada por mais de 12 horas e foi descartada. Nenhum registro foi criado.`;
  }
}

/** The warning on the confirmation of a session under its floor (#86, D44). */
export function shortText(minSessionMinutes: number): string {
  const floor =
    minSessionMinutes === 0 ? "30 segundos" : formatDuration(minSessionMinutes);

  return `A sessão mínima desta atividade é de ${floor}. Se encerrar agora, nada vai para aprovação. Para enviar, toque em Voltar e continue o cronômetro.`;
}

/**
 * What he has already sent and nobody has decided on yet.
 *
 * The one lasting sign that a session became something: the notice above it
 * belongs to a single answer and is gone on the next refresh, and a boy who
 * cannot see his own entry has no reason to believe it was ever made.
 */
function PendingList({ data }: { data: TimerScreenData }) {
  return (
    <Panel
      note={
        data.pending.length === 0
          ? undefined
          : data.pending.length === 1
            ? "1 esperando"
            : `${data.pending.length} esperando`
      }
      title="Esperando aprovação"
    >
      {data.pending.length === 0 ? (
        <PanelText>
          Nada esperando. Quando você enviar uma sessão, ela aparece aqui até um
          adulto decidir.
        </PanelText>
      ) : (
        <ul>
          {data.pending.map((proposal) => (
            <li
              className={`${ROW_CLASS} flex-col items-stretch`}
              key={proposal.id}
            >
              {/*
                The mark is on the entry and not only on the panel's band: the
                count says how many are waiting, and this says *which*. #18 asks
                for the boy's own waiting entries to carry the pendency colour,
                and a count in a band is not that.
              */}
              <span className="flex items-center gap-2">
                <PendingMark>Pendente</PendingMark>
                <span className="break-words text-base font-bold text-black">
                  {proposal.activityName}
                </span>
              </span>
              <span className={`${META_CLASS} mt-1 text-black`}>
                {formatDay(proposal.occurredOn)}
                {proposal.durationSeconds === null
                  ? ""
                  : ` · ${formatRecordedDuration(proposal.durationSeconds)}`}
                {proposal.autoStopped ? " · parou sozinha" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
