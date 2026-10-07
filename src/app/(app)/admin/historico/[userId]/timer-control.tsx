"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { isBlankNote } from "../../../../../db/input";
import type { TimerSettlement } from "../../../../../db/timers";
import { Button } from "../../../../../ui/button";
import { timerFailureText } from "../../../../../ui/failure";
import { Field } from "../../../../../ui/field";
import { formatRecordedDuration } from "../../../../../ui/hours";
import { META_CLASS } from "../../../../../ui/style";
import type { RunningTimer } from "../../../../actions/admin-timers";
import {
  adminCancelTimerAction,
  adminStopTimerAction,
} from "../../../../actions/admin-timers";
import {
  noteLabel,
  settlementText,
} from "../../../menino/cronometro/timer-screen";

/** #84: Parar reuses the boy's stop; Cancelar discards, and takes two taps. */
export function TimerControl({ timer }: { timer: RunningTimer }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<TimerSettlement | null>(null);
  const [busy, startAction] = useTransition();

  function stop() {
    startAction(async () => {
      try {
        const result = await adminStopTimerAction(timer.userId, note);

        // D44: a filed record settles to null; anything else closed the session
        // without filing, and the admin is told which, as the boy's screen is.
        if (result === null) {
          router.refresh();
          return;
        }

        setSettlement(result);
      } catch (error) {
        setFailed(timerFailureText(error));
      }
    });
  }

  function cancel() {
    startAction(async () => {
      try {
        const result = await adminCancelTimerAction(timer.userId);

        // D16: a session that auto-ended before the tap was filed, not discarded;
        // say so instead of promising the queue stayed empty.
        if (result === null) {
          router.refresh();
          return;
        }

        setSettlement(result);
      } catch (error) {
        setFailed(timerFailureText(error));
      }
    });
  }

  // #44: the rule the boy's screen holds too; the server refuses the forged tap.
  const stopDisabled = busy || (timer.noteRequired && isBlankNote(note));

  if (settlement !== null) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <p className="text-base text-black">{settlementText(settlement)}</p>
        <Button onClick={() => router.refresh()} type="button">
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1">
        <span className="break-words text-base font-bold text-black">
          {timer.activityName}
        </span>
        <span className={`${META_CLASS} text-black`}>
          {timer.categoryName} ·{" "}
          {timer.status === "paused" ? "pausado" : "rodando"} ·{" "}
          {formatRecordedDuration(timer.activeSeconds)}
        </span>
      </div>

      {timer.noteRequired ? (
        <Field
          id={`cronometro-nota-${timer.userId}`}
          label={noteLabel(true)}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          type="text"
          value={note}
        />
      ) : null}

      {failed === null ? null : (
        <p className="text-base text-black">{failed}</p>
      )}

      {cancelling ? (
        <div className="flex flex-col gap-2">
          <p className="text-base font-bold text-black">
            Descartar este cronômetro? Nada vai para a fila, e a sessão não vira
            registro.
          </p>
          <Button disabled={busy} onClick={cancel} type="button">
            Confirmar descarte
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setCancelling(false);
              setFailed(null);
            }}
            type="button"
            variant="secondary"
          >
            Voltar
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 lg:flex-row lg:gap-3">
          <div className="lg:flex-1">
            <Button disabled={stopDisabled} onClick={stop} type="button">
              Parar
            </Button>
          </div>
          <div className="lg:flex-1">
            <Button
              disabled={busy}
              onClick={() => setCancelling(true)}
              type="button"
              variant="secondary"
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
