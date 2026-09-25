"use client";

import { useState, useTransition } from "react";

import { Button } from "../../../../ui/button";
import type { Choice } from "../../../../ui/choice";
import { ChoiceGroup } from "../../../../ui/choice";
import { ConfirmMovement } from "../../../../ui/confirm-movement";
import { failureText, previewFailureText } from "../../../../ui/failure";
import { Field } from "../../../../ui/field";
import { formatHours, parseTypedHours } from "../../../../ui/hours";
import { KidSelect } from "../../../../ui/kid-select";
import { BORDER_CLASS, balanceToneClass } from "../../../../ui/style";
import type { Movement, MovementPreview } from "../../../actions/ledger";
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

const HOUR_CHOICES: readonly Choice[] = [0.5, 1, 1.5, 2, 3, 4].map((hours) => ({
  value: hours,
  label: formatHours(hours),
}));

const DEFAULT_HOURS = "1";

export function ReleaseForm({ kids }: { kids: Kid[] }) {
  const [userId, setUserId] = useState(kids[0]?.id ?? 0);
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [destination, setDestination] = useState("");

  const [preview, setPreview] = useState<MovementPreview | null>(null);
  const [done, setDone] = useState<Movement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  const typed = parseTypedHours(hours);
  const kid = kids.find((candidate) => candidate.id === userId);

  function change(apply: () => void) {
    apply();
    setDone(null);
    setFailed(null);
  }

  function ask() {
    if (typed === null) return;

    startAction(async () => {
      try {
        setPreview(
          await previewReleaseAction({
            userId,
            hours: typed,
            destination: destination.trim() === "" ? null : destination.trim(),
          }),
        );
        setFailed(null);
      } catch (error) {
        setFailed(previewFailureText(error));
      }
    });
  }

  function release() {
    if (typed === null) return;

    startAction(async () => {
      try {
        setDone(
          await releaseHoursAction({
            userId,
            hours: typed,
            destination: destination.trim() === "" ? null : destination.trim(),
          }),
        );
        setFailed(null);
      } catch (error) {
        setFailed(failureText(error));
      }

      setPreview(null);
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
      {preview === null ? null : (
        <ConfirmMovement
          action="Liberar"
          busy={busy}
          confirmLabel="Confirmar liberação"
          onCancel={() => setPreview(null)}
          onConfirm={release}
          preview={preview}
        />
      )}

      {failed === null ? null : (
        <p className={`${BORDER_CLASS} bg-white p-4 text-lg text-black`}>
          {failed}
        </p>
      )}

      {done === null ? null : (
        <section className={`${BORDER_CLASS} flex flex-col gap-3 bg-white p-4`}>
          <p className="text-lg font-bold text-black">
            Liberado {formatHours(done.hours)} para {kid?.displayName}
            {destination.trim() === "" ? "" : ` em ${destination.trim()}`}.
          </p>
          <p
            className={`${balanceToneClass(done.balance)} text-2xl font-bold tabular-nums`}
          >
            {formatHours(done.balance)}
          </p>
          <p className="text-base text-black">
            Agora, nos aparelhos: ligue o que você liberou e ajuste o limite à
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
        onSelect={(chosen) => change(() => setHours(String(chosen)))}
        options={HOUR_CHOICES}
        value={typed ?? 0}
      />

      <Field
        id="horas"
        inputMode="decimal"
        label="Horas"
        onChange={(event) => change(() => setHours(event.target.value))}
        type="text"
        value={hours}
      />

      <Field
        id="destino"
        label="Destino (opcional)"
        maxLength={500}
        onChange={(event) => change(() => setDestination(event.target.value))}
        type="text"
        value={destination}
      />

      <Button disabled={busy || typed === null} onClick={ask} type="button">
        Liberar
      </Button>
    </div>
  );
}
