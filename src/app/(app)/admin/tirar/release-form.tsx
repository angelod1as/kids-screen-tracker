"use client";

import { useState, useTransition } from "react";
import { Button } from "../../../../ui/button";
import type { Choice } from "../../../../ui/choice";
import { ChoiceGroup } from "../../../../ui/choice";
import { ConfirmMovement } from "../../../../ui/confirm-movement";
import { ErrorNote } from "../../../../ui/error-note";
import { failureText, previewFailureText } from "../../../../ui/failure";
import { Field, TimeFields } from "../../../../ui/field";
import type { TypedTime } from "../../../../ui/hours";
import {
  formatDuration,
  formatHours,
  isZeroTime,
  parseTypedTime,
  timeFromMinutes,
  typedMinutes,
  ZERO_TIME_TEXT,
} from "../../../../ui/hours";
import { KidSelect } from "../../../../ui/kid-select";
import { BORDER_CLASS, balanceToneClass } from "../../../../ui/style";
import type {
  Movement,
  MovementPreview,
  ReleaseRequest,
} from "../../../actions/ledger";
import {
  previewReleaseAction,
  releaseHoursAction,
} from "../../../actions/ledger";
import type { Kid } from "../../../actions/people";

/**
 * No check against the balance: it may go below zero without limit, because a
 * release describes something already done on a device. The app turns nothing
 * on, and what is configured there is not its business (D41).
 */

const MINUTE_CHOICES: readonly Choice[] = [30, 60, 90, 120, 180, 240].map(
  (minutes) => ({ value: minutes, label: formatDuration(minutes) }),
);

const DEFAULT_TIME: TypedTime = { hours: "1", minutes: "" };

export function ReleaseForm({
  initialUserId,
  kids,
}: {
  initialUserId?: number;
  kids: Kid[];
}) {
  const [userId, setUserId] = useState(initialUserId ?? kids[0]?.id ?? 0);
  const [time, setTime] = useState(DEFAULT_TIME);
  const [destination, setDestination] = useState("");

  /** D53: confirming writes the request that was previewed, never the form as it is now. */
  const [asked, setAsked] = useState<{
    request: ReleaseRequest;
    preview: MovementPreview;
  } | null>(null);
  const [done, setDone] = useState<Movement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  const typed = isZeroTime(time) ? null : parseTypedTime(time);
  const kid = kids.find((candidate) => candidate.id === userId);

  function change(apply: () => void) {
    apply();
    setAsked(null);
    setDone(null);
    setFailed(null);
  }

  function ask() {
    if (typed === null) return;

    const request: ReleaseRequest = {
      userId,
      time: typed,
      destination: destination.trim() === "" ? null : destination.trim(),
    };

    startAction(async () => {
      try {
        setAsked({ request, preview: await previewReleaseAction(request) });
        setFailed(null);
      } catch (error) {
        setFailed(previewFailureText(error));
      }
    });
  }

  function release() {
    if (asked === null) return;

    startAction(async () => {
      try {
        setDone(await releaseHoursAction(asked.request));
        setFailed(null);
      } catch (error) {
        setFailed(failureText(error));
      }

      setAsked(null);
    });
  }

  if (kids.length === 0) {
    return (
      <p className={`${BORDER_CLASS} bg-white p-4 text-lg text-black`}>
        Nenhum menino cadastrado.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {asked === null ? null : (
        <ConfirmMovement
          action="Tirar"
          busy={busy}
          confirmLabel="Confirmar e tirar"
          onCancel={() => setAsked(null)}
          onConfirm={release}
          preview={asked.preview}
        />
      )}

      {/* The form is out of reach; leaving by the nav is a cancel (D53). */}
      <div className="flex flex-col gap-6" inert={asked !== null}>
        {failed === null ? null : <ErrorNote>{failed}</ErrorNote>}

        {done === null ? null : (
          <section
            className={`${BORDER_CLASS} flex flex-col gap-3 bg-white p-4`}
          >
            <p className="text-lg font-bold text-black">
              Tirado {formatHours(done.hours)} de {kid?.displayName}
              {destination.trim() === "" ? "" : ` em ${destination.trim()}`}.
            </p>
            <p
              className={`${balanceToneClass(done.balance)} text-2xl font-bold tabular-nums`}
            >
              {formatHours(done.balance)}
            </p>
            <p className="text-base text-black">
              Agora, nos aparelhos: ligue o que ele vai usar e ajuste o limite à
              mão. O app não liga nem desliga nada — ele só guarda o saldo.
            </p>
          </section>
        )}

        <KidSelect
          kids={kids}
          onChange={(chosen) => change(() => setUserId(chosen))}
          value={userId}
        />

        <ChoiceGroup
          legend="Quanto"
          onSelect={(chosen) => change(() => setTime(timeFromMinutes(chosen)))}
          options={MINUTE_CHOICES}
          value={typedMinutes(time) ?? 0}
        />

        <TimeFields
          id="tempo"
          legend="Ou digite"
          onChange={(typed) => change(() => setTime(typed))}
          value={time}
        />

        {isZeroTime(time) ? (
          <p
            className={`${BORDER_CLASS} bg-white p-3 text-base font-bold text-black`}
          >
            {ZERO_TIME_TEXT}
          </p>
        ) : null}

        <Field
          id="destino"
          label="Destino (opcional)"
          maxLength={500}
          onChange={(event) => change(() => setDestination(event.target.value))}
          type="text"
          value={destination}
        />

        <Button disabled={busy || typed === null} onClick={ask} type="button">
          Tirar
        </Button>
      </div>
    </div>
  );
}
