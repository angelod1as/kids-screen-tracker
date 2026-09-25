"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { VoidTarget } from "../../../../../db/voiding";
import { Button } from "../../../../../ui/button";
import { failureText } from "../../../../../ui/failure";
import { formatHours } from "../../../../../ui/hours";
import { balanceToneClass } from "../../../../../ui/style";
import { voidEntryAction } from "../../../../actions/void";

/** D52: two taps, and the second one is taken knowing what the balance becomes. */
export function VoidControl({
  target,
  before,
  after,
}: {
  target: VoidTarget;
  before: number;
  after: number;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  function confirm() {
    startAction(async () => {
      try {
        const result = await voidEntryAction(target);

        if ("refused" in result) {
          setFailed(result.refused);
          return;
        }

        setAsking(false);
        router.refresh();
      } catch (error) {
        setFailed(failureText(error));
      }
    });
  }

  if (!asking) {
    return (
      <Button onClick={() => setAsking(true)} type="button" variant="secondary">
        Anular
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-base text-black">
        Anular esta entrada? Ela continua no histórico, riscada, e deixa de
        contar no saldo.
      </p>
      <p className="text-base font-bold text-black">
        Saldo:{" "}
        <span className={`${balanceToneClass(before)} tabular-nums`}>
          {formatHours(before)}
        </span>{" "}
        →{" "}
        <span className={`${balanceToneClass(after)} tabular-nums`}>
          {formatHours(after)}
        </span>
      </p>
      {failed === null ? null : (
        <p className="text-base text-black">{failed}</p>
      )}
      <Button disabled={busy} onClick={confirm} type="button">
        Confirmar anulação
      </Button>
      <Button
        disabled={busy}
        onClick={() => {
          setAsking(false);
          setFailed(null);
        }}
        type="button"
        variant="secondary"
      >
        Voltar
      </Button>
    </div>
  );
}
