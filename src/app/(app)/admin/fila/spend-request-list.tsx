"use client";

import { useState, useTransition } from "react";
import type { HoursMinutes } from "../../../../db/input";
import type { PendingSpendRequest } from "../../../../db/spend-requests";
import { Button } from "../../../../ui/button";
import { formatSignedHours } from "../../../../ui/dates";
import { DeviceReminder } from "../../../../ui/device-reminder";
import { ErrorNote } from "../../../../ui/error-note";
import { failureText } from "../../../../ui/failure";
import { Field, TimeFields } from "../../../../ui/field";
import type { TypedTime } from "../../../../ui/hours";
import { isBlankTime, isZeroTime, parseTypedTime } from "../../../../ui/hours";
import { Panel } from "../../../../ui/panel";
import { PendingMark } from "../../../../ui/pending";
import {
  balanceToneClass,
  META_CLASS,
  READOUT_CLASS,
  ROW_CLASS,
} from "../../../../ui/style";
import {
  approveSpendRequestAction,
  rejectSpendRequestAction,
} from "../../../actions/spend-requests";

/**
 * D58: the boy's spend requests, beside the earn queue. One tap approves, with
 * no balance preview (D58 emenda, #107); the amount may be corrected first
 * (default: exactly what he asked). Rejecting moves nothing.
 */

const EMPTY_TIME: TypedTime = { hours: "", minutes: "" };

/**
 * A correction that was typed, is not blank, and does not parse (minutes ≥ 60,
 * say): distinct from a blank field, so it blocks instead of silently falling
 * back to the asked amount.
 */
export function correctionInvalid(typed: TypedTime | undefined): boolean {
  return (
    typed !== undefined && !isBlankTime(typed) && parseTypedTime(typed) === null
  );
}

export function SpendRequestList({
  initial,
}: {
  initial: PendingSpendRequest[];
}) {
  const [requests, setRequests] = useState(initial);
  const [edits, setEdits] = useState<Record<number, TypedTime>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [reminded, setReminded] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  if (requests.length === 0 && !reminded) {
    return null;
  }

  function editOf(requestId: number): HoursMinutes | undefined {
    const typed = edits[requestId];
    if (typed === undefined || isZeroTime(typed)) return undefined;

    return parseTypedTime(typed) ?? undefined;
  }

  function drop(requestId: number) {
    setRequests((current) =>
      current.filter((request) => request.id !== requestId),
    );
  }

  function approve(requestId: number) {
    const time = editOf(requestId);

    startAction(async () => {
      try {
        await approveSpendRequestAction(
          requestId,
          time === undefined ? {} : { time },
        );
        drop(requestId);
        setReminded(true);
        setFailed(null);
      } catch (error) {
        setFailed(failureText(error));
      }
    });
  }

  function reject(requestId: number) {
    const reason = reasons[requestId] ?? "";

    startAction(async () => {
      try {
        await rejectSpendRequestAction(requestId, reason);
        drop(requestId);
        setFailed(null);
      } catch (error) {
        setFailed(failureText(error));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {failed === null ? null : <ErrorNote>{failed}</ErrorNote>}

      {reminded ? (
        <Panel title="Pedido aprovado">
          <div className="px-3 py-4">
            <DeviceReminder />
          </div>
        </Panel>
      ) : null}

      {requests.length === 0 ? null : (
        <Panel
          note={
            <PendingMark>
              {requests.length === 1
                ? "1 esperando"
                : `${requests.length} esperando`}
            </PendingMark>
          }
          title="Pedidos de uso"
          top
        >
          <ul>
            {requests.map((request) => (
              <li className={ROW_CLASS} key={request.id}>
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="break-words text-base font-bold text-black">
                      {request.userName}
                    </span>
                    <span className={`${META_CLASS} text-black`}>
                      Usar {request.destination}
                    </span>
                    {request.note === null ? null : (
                      <span className={`${META_CLASS} text-black`}>
                        {request.note}
                      </span>
                    )}
                  </div>

                  <TimeFields
                    id={`corrigir-${request.id}`}
                    legend="Corrigir horas (opcional)"
                    onChange={(typed) => {
                      setEdits((current) => ({
                        ...current,
                        [request.id]: typed,
                      }));
                      setFailed(null);
                    }}
                    value={edits[request.id] ?? EMPTY_TIME}
                  />

                  {correctionInvalid(edits[request.id]) ? (
                    <ErrorNote>Minutos de 0 a 59.</ErrorNote>
                  ) : null}

                  <Field
                    id={`motivo-${request.id}`}
                    label="Motivo da recusa (opcional)"
                    maxLength={500}
                    onChange={(event) => {
                      const { value } = event.target;
                      setReasons((current) => ({
                        ...current,
                        [request.id]: value,
                      }));
                      setFailed(null);
                    }}
                    type="text"
                    value={reasons[request.id] ?? ""}
                  />

                  <div className="flex flex-col gap-3">
                    <Button
                      disabled={busy || correctionInvalid(edits[request.id])}
                      onClick={() => approve(request.id)}
                      type="button"
                    >
                      Aprovar
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => reject(request.id)}
                      type="button"
                      variant="secondary"
                    >
                      Recusar
                    </Button>
                  </div>
                </div>

                {/* D58: the minus sign carries the direction, apart from an earn's plus. */}
                <span
                  className={`${READOUT_CLASS} shrink-0 ${balanceToneClass(-request.hours)}`}
                >
                  {formatSignedHours(-request.hours)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
