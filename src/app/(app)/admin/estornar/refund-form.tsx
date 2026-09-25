"use client";

import { useState, useTransition } from "react";
import type { Refund } from "../../../../db/ledger";
import { Button } from "../../../../ui/button";
import { ConfirmMovement } from "../../../../ui/confirm-movement";
import { failureText, previewFailureText } from "../../../../ui/failure";
import { Field } from "../../../../ui/field";
import { formatHours, parseTypedHours } from "../../../../ui/hours";
import { KidSelect } from "../../../../ui/kid-select";
import { BORDER_CLASS, balanceToneClass } from "../../../../ui/style";
import type { Movement, MovementPreview } from "../../../actions/ledger";
import {
  previewRefundAction,
  refundHoursAction,
} from "../../../actions/ledger";
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

  /** D52: confirming writes the request that was previewed, never the form as it is now. */
  const [asked, setAsked] = useState<{
    request: Refund;
    preview: MovementPreview;
  } | null>(null);
  const [done, setDone] = useState<Movement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  const kid = kids.find((candidate) => candidate.id === userId);

  function change(apply: () => void) {
    apply();
    setAsked(null);
    setDone(null);
    setFailed(null);
  }

  function ask() {
    const typed = parseTypedHours(hours);

    if (typed === null || reason.trim() === "") return;

    const request: Refund = {
      userId,
      hours: typed,
      occurredOn,
      reason: reason.trim(),
    };

    startAction(async () => {
      try {
        setAsked({ request, preview: await previewRefundAction(request) });
        setFailed(null);
      } catch (error) {
        setFailed(previewFailureText(error));
      }
    });
  }

  function refund() {
    if (asked === null) return;

    startAction(async () => {
      try {
        setDone(await refundHoursAction(asked.request));
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
          action="Estornar"
          busy={busy}
          confirmLabel="Confirmar estorno"
          onCancel={() => setAsked(null)}
          onConfirm={refund}
          preview={asked.preview}
        />
      )}

      {/* aria-modal promises the rest is out of reach (D52). */}
      <div className="flex flex-col gap-6" inert={asked !== null}>
        {failed === null ? null : (
          <p className={`${BORDER_CLASS} bg-white p-4 text-lg text-black`}>
            {failed}
          </p>
        )}

        {done === null ? null : (
          <section
            className={`${BORDER_CLASS} flex flex-col gap-2 bg-white p-4`}
          >
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
          onClick={ask}
          type="button"
        >
          Estornar
        </Button>
      </div>
    </div>
  );
}
