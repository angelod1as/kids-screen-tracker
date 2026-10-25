"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "../../../../ui/button";
import type { Choice } from "../../../../ui/choice";
import { ChoiceGroup } from "../../../../ui/choice";
import { ErrorNote } from "../../../../ui/error-note";
import { failureText } from "../../../../ui/failure";
import { Field, TimeFields } from "../../../../ui/field";
import type { TypedTime } from "../../../../ui/hours";
import {
  formatDuration,
  isZeroTime,
  parseTypedTime,
  timeFromMinutes,
  typedMinutes,
  ZERO_TIME_TEXT,
} from "../../../../ui/hours";
import { BORDER_CLASS } from "../../../../ui/style";
import { requestSpendAction } from "../../../actions/spend-requests";

/**
 * D58: hours and minutes (#48), a destination that is required (unlike the
 * adult's Tirar) and an optional comment. No balance check: the request may go
 * past the balance, and the adult is the gate.
 */

const MINUTE_CHOICES: readonly Choice[] = [30, 60, 90, 120, 180, 240].map(
  (minutes) => ({ value: minutes, label: formatDuration(minutes) }),
);

const DEFAULT_TIME: TypedTime = { hours: "1", minutes: "" };

export function SpendRequestForm({ userId }: { userId: number }) {
  const router = useRouter();
  const [time, setTime] = useState(DEFAULT_TIME);
  const [destination, setDestination] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  const typed = isZeroTime(time) ? null : parseTypedTime(time);
  const ready = typed !== null && destination.trim() !== "";

  function change(apply: () => void) {
    apply();
    setDone(false);
    setFailed(null);
  }

  function send() {
    if (typed === null || destination.trim() === "") return;

    startAction(async () => {
      try {
        await requestSpendAction(userId, {
          time: typed,
          destination: destination.trim(),
          note: note.trim() === "" ? null : note.trim(),
        });
        setTime(DEFAULT_TIME);
        setDestination("");
        setNote("");
        setDone(true);
        setFailed(null);
        router.refresh();
      } catch (error) {
        setFailed(failureText(error));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {failed === null ? null : <ErrorNote>{failed}</ErrorNote>}

      {done ? (
        <section className={`${BORDER_CLASS} bg-white p-4`}>
          <p className="text-lg font-bold text-black">
            Pedido enviado. Um adulto vai aprovar, e o tempo sai do seu saldo.
          </p>
        </section>
      ) : null}

      <ChoiceGroup
        legend="Quanto você quer usar"
        onSelect={(chosen) => change(() => setTime(timeFromMinutes(chosen)))}
        options={MINUTE_CHOICES}
        value={typedMinutes(time) ?? 0}
      />

      <TimeFields
        id="tempo"
        legend="Ou digite"
        onChange={(typedTime) => change(() => setTime(typedTime))}
        value={time}
      />

      {isZeroTime(time) ? <ErrorNote>{ZERO_TIME_TEXT}</ErrorNote> : null}

      <Field
        id="destino"
        label="Para quê"
        maxLength={500}
        onChange={(event) => change(() => setDestination(event.target.value))}
        type="text"
        value={destination}
      />

      <Field
        id="comentario"
        label="Comentário (opcional)"
        maxLength={500}
        onChange={(event) => change(() => setNote(event.target.value))}
        type="text"
        value={note}
      />

      <Button disabled={busy || !ready} onClick={send} type="button">
        Pedir pra usar
      </Button>
    </div>
  );
}
