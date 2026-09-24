"use client";

import { useState, useTransition } from "react";

import { Button } from "../../../../ui/button";
import { failureText } from "../../../../ui/failure";
import { Field } from "../../../../ui/field";
import { formatHours, parseTypedHours } from "../../../../ui/hours";
import { KidSelect } from "../../../../ui/kid-select";
import { BORDER_CLASS, balanceToneClass } from "../../../../ui/style";
import type { Movement } from "../../../actions/ledger";
import { refundHoursAction } from "../../../actions/ledger";
import type { Kid } from "../../../actions/people";

/**
 * Dated, unlike a release: a refund is about something that already happened,
 * so it is credited to that day (D13). The reason is required: it is the only
 * thing that explains the row.
 */

/** Almost every refund is this one (#106); the field stays editable. */
export const DEFAULT_REFUND_REASON = "Não usou";

/** A rule, not layout; the endpoint refuses both anyway. */
export function canRefund(hours: string, reason: string): boolean {
  return parseTypedHours(hours) !== null && reason.trim() !== "";
}

export function RefundForm({ kids, today }: { kids: Kid[]; today: string }) {
  const [userId, setUserId] = useState(kids[0]?.id ?? 0);
  const [hours, setHours] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [reason, setReason] = useState(DEFAULT_REFUND_REASON);

  const [done, setDone] = useState<Movement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  const kid = kids.find((candidate) => candidate.id === userId);

  function change(apply: () => void) {
    apply();
    setDone(null);
    setFailed(null);
  }

  function refund() {
    const typed = parseTypedHours(hours);

    if (typed === null || reason.trim() === "") return;

    startAction(async () => {
      try {
        setDone(
          await refundHoursAction({
            userId,
            hours: typed,
            occurredOn,
            reason: reason.trim(),
          }),
        );
        setFailed(null);
      } catch (error) {
        setFailed(failureText(error));
      }
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
      {failed === null ? null : (
        <p className={`${BORDER_CLASS} bg-white p-4 text-lg text-black`}>
          {failed}
        </p>
      )}

      {done === null ? null : (
        <section className={`${BORDER_CLASS} flex flex-col gap-2 bg-white p-4`}>
          <p className="text-lg font-bold text-black">
            Estornado {formatHours(done.hours)} para {kid?.displayName}.
          </p>
          <p
            className={`${balanceToneClass(done.balance)} text-2xl font-bold tabular-nums`}
          >
            {formatHours(done.balance)}
          </p>
          <p className="text-base text-black">
            Aparece no histórico dele como estorno, no dia que você escolheu.
          </p>
        </section>
      )}

      <KidSelect
        kids={kids}
        onChange={(chosen) => change(() => setUserId(chosen))}
        value={userId}
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
        id="dia"
        label="Dia"
        max={today}
        onChange={(event) => change(() => setOccurredOn(event.target.value))}
        type="date"
        value={occurredOn}
      />

      <Field
        id="motivo"
        label="Motivo"
        maxLength={500}
        onChange={(event) => change(() => setReason(event.target.value))}
        type="text"
        value={reason}
      />

      <Button
        disabled={busy || !canRefund(hours, reason)}
        onClick={refund}
        type="button"
      >
        Estornar
      </Button>
    </div>
  );
}
