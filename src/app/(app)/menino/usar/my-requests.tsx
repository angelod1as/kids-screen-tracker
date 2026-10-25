"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { OwnSpendRequest } from "../../../../db/spend-requests";
import { saoPauloDay } from "../../../../engine/day";
import { Button } from "../../../../ui/button";
import { formatDay, formatTime } from "../../../../ui/dates";
import { ErrorNote } from "../../../../ui/error-note";
import { failureText } from "../../../../ui/failure";
import { formatHours } from "../../../../ui/hours";
import { PanelText } from "../../../../ui/panel";
import { PendingMark } from "../../../../ui/pending";
import { META_CLASS, ROW_CLASS } from "../../../../ui/style";
import { cancelSpendRequestAction } from "../../../actions/spend-requests";

const STATUS_TEXT: Record<OwnSpendRequest["status"], string> = {
  pending: "Esperando",
  approved: "Aprovado",
  rejected: "Recusado",
  cancelled: "Cancelado",
};

/** D59: his own requests, and the one write on them — cancelling a pending one. */
export function MyRequests({
  requests,
}: {
  requests: readonly OwnSpendRequest[];
}) {
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  function cancel(requestId: number) {
    startAction(async () => {
      try {
        await cancelSpendRequestAction(requestId);
        setFailed(null);
      } catch (error) {
        setFailed(failureText(error));
      }
      router.refresh();
    });
  }

  if (requests.length === 0) {
    return <PanelText>Nenhum pedido ainda.</PanelText>;
  }

  return (
    <div className="flex flex-col">
      {failed === null ? null : <ErrorNote>{failed}</ErrorNote>}
      <ul>
        {requests.map((request) => (
          <li className={ROW_CLASS} key={request.id}>
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="break-words text-base font-bold text-black">
                {request.destination}
              </span>
              <span className={`${META_CLASS} text-black`}>
                {formatDay(saoPauloDay(request.createdAt))} às{" "}
                {formatTime(request.createdAt.getTime())}
              </span>
              <span>
                {request.status === "pending" ? (
                  <PendingMark>{STATUS_TEXT.pending}</PendingMark>
                ) : (
                  <span className={`${META_CLASS} text-black`}>
                    {STATUS_TEXT[request.status]}
                    {request.approvedHours !== null &&
                    request.approvedHours !== request.hours
                      ? ` · ${formatHours(request.approvedHours)}`
                      : ""}
                  </span>
                )}
              </span>
              {request.status === "pending" ? (
                <Button
                  disabled={busy}
                  onClick={() => cancel(request.id)}
                  type="button"
                  variant="secondary"
                >
                  Cancelar pedido
                </Button>
              ) : null}
            </span>
            <span className="shrink-0 font-mono text-2xl font-bold tabular-nums text-black">
              {formatHours(request.hours)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
