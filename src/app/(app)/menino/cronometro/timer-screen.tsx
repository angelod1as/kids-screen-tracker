"use client";

import { useEffect, useState, useTransition } from "react";

import type { NewRequest } from "../../../../db/requests";
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
  requestLogAction,
  resumeTimerAction,
  startTimerAction,
  stopTimerAction,
} from "../../../actions/timer";

/**
 * Nothing interrupts him: no alert, confirm, notification or second interval,
 * and `timer-screen.test.tsx` fails if one appears. The state is the server's;
 * *Parar* pauses on the server so the duration freezes at that tap, and a tab
 * closed in between leaves a pause that D16 already covers.
 */

const SECONDS_PER_MINUTE = 60;

export function TimerScreen({ initial }: { initial: TimerScreenData }) {
  const [data, setData] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [chosen, setChosen] = useState(initial.activities[0]?.id ?? 0);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  /** Zero on the first render, so the hydrated markup matches the server's. */
  const [watchedMs, setWatchedMs] = useState(0);
  const open = data.open;

  // `open` is fresh on every answer, so the anchor resets and the digits never
  // count the browser's elapsed time twice.
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

        // The confirmation and the typed note survive a failure, so the retry is
        // the same tap. Only a read saying the session is over closes it.
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
        <div className="flex flex-col gap-4">
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
          <RequestPanel
            busy={busy}
            data={data}
            onRequest={(request, done) =>
              act(() => requestLogAction(data.userId, request), done)
            }
          />
        </div>
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
            // Pausing first freezes the duration at this tap. Idempotent, so an
            // existing pause keeps the instant D16's twelve hours count from.
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
 * A lost answer may already have paused or filed (#29), so the screen reads
 * again; if that fails too, nothing is replaced.
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

/** Capped for display only: the cut itself is the server's, from the stamps (D16). */
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
  // #86: the server refuses under the floor (D44); the screen says so before the tap.
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
 * A request for an activity nobody timed (D49): two taps for anything but a
 * `duration`, which also asks how long, starting from the presumed minutes (#18).
 */
function RequestPanel({
  busy,
  data,
  onRequest,
}: {
  busy: boolean;
  data: TimerScreenData;
  onRequest: (request: NewRequest, done: () => void) => void;
}) {
  const [chosen, setChosen] = useState(data.requestable[0]?.id ?? 0);
  const [occurredOn, setOccurredOn] = useState(data.today);
  const [minutes, setMinutes] = useState(
    String(data.requestable[0]?.presumedMinutes ?? ""),
  );
  const [note, setNote] = useState("");

  const activity = data.requestable.find((item) => item.id === chosen);
  const timed = activity?.calcMode === "duration";
  const typed = Number(minutes);
  const ready =
    activity !== undefined &&
    occurredOn !== "" &&
    (!timed || (Number.isInteger(typed) && typed >= 1));
  const categories = [
    ...new Map(
      data.requestable.map((item) => [item.categoryId, item.categoryName]),
    ),
  ];

  if (data.requestable.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      {data.requested === null ? null : (
        <Box>
          Pedido enviado para aprovação: {data.requested.activityName} ·{" "}
          {formatDay(data.requested.occurredOn)}.
        </Box>
      )}

      <Panel title="Pedir sem cronômetro">
        <div className="flex flex-col gap-3 p-3">
          <Select
            id="pedido-atividade"
            label="O que você fez"
            onChange={(value) => {
              const next = Number(value);
              setChosen(next);
              setMinutes(
                String(
                  data.requestable.find((item) => item.id === next)
                    ?.presumedMinutes ?? "",
                ),
              );
            }}
            value={String(chosen)}
          >
            {categories.map(([id, name]) => (
              <optgroup key={id} label={name}>
                {data.requestable
                  .filter((item) => item.categoryId === id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>

          <Field
            id="pedido-dia"
            label="Quando"
            onChange={(event) => setOccurredOn(event.target.value)}
            type="date"
            value={occurredOn}
          />

          {timed ? (
            <Field
              id="pedido-duracao"
              inputMode="numeric"
              label="Quantos minutos"
              onChange={(event) => setMinutes(event.target.value)}
              type="text"
              value={minutes}
            />
          ) : null}

          <Field
            id="pedido-nota"
            label="Quer contar alguma coisa? (opcional)"
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            type="text"
            value={note}
          />

          <Button
            disabled={busy || !ready}
            onClick={() =>
              onRequest(
                {
                  activityId: chosen,
                  occurredOn,
                  durationMinutes: timed ? typed : null,
                  note: note.trim() === "" ? null : note.trim(),
                },
                () => setNote(""),
              )
            }
            type="button"
          >
            Pedir
          </Button>
        </div>
      </Panel>
    </section>
  );
}

/**
 * Four endings, four sentences: an ending that files nothing and does not admit
 * it is how a boy comes to believe the app eats his afternoons. `tooShort` names
 * the floor (D44).
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

export function shortText(minSessionMinutes: number): string {
  const floor =
    minSessionMinutes === 0 ? "30 segundos" : formatDuration(minSessionMinutes);

  return `A sessão mínima desta atividade é de ${floor}. Se encerrar agora, nada vai para aprovação. Para enviar, toque em Voltar e continue o cronômetro.`;
}

/** The one lasting sign that a session became something: the notice above is gone on refresh. */
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
          Nada esperando. Quando você enviar uma sessão ou um pedido, ele
          aparece aqui até um adulto decidir.
        </PanelText>
      ) : (
        <ul>
          {data.pending.map((proposal) => (
            <li
              className={`${ROW_CLASS} flex-col items-stretch`}
              key={proposal.id}
            >
              {/* On the entry, not only the band: the count says how many, this says which (#18). */}
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
