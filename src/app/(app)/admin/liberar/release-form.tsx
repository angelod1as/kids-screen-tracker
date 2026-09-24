"use client";

import { useState, useTransition } from "react";

import { Button } from "../../../../ui/button";
import type { Choice } from "../../../../ui/choice";
import { ChoiceGroup } from "../../../../ui/choice";
import { failureText } from "../../../../ui/failure";
import { Field } from "../../../../ui/field";
import { formatHours, parseTypedHours } from "../../../../ui/hours";
import { KidSelect } from "../../../../ui/kid-select";
import { BORDER_CLASS, balanceToneClass } from "../../../../ui/style";
import type { Movement } from "../../../actions/ledger";
import { releaseHoursAction } from "../../../actions/ledger";
import type { Kid } from "../../../actions/people";

/**
 * Releasing hours onto the devices (#23).
 *
 * The screen is short because the operation is: a boy, an amount, and where it
 * went. The destination is free text and optional — "WhatsApp", "Xbox", "TV" —
 * because it is what the extract will call the row, and the adult is standing
 * at the console, not filling in a form.
 *
 * **Nothing here checks the balance against what is being released**, and that
 * is the criterion rather than an omission. The balance may go below zero
 * without limit: an adult who releases three hours to a boy who has one is
 * describing something that already happened on a device, and an app that
 * refused it would stop being the record of what happened. The number that
 * comes back is drawn in the one colour CLAUDE.md lets a negative balance wear.
 *
 * What follows a release is the half that is easy to leave out: the app has not
 * turned anything on. The reminder says so, and that is all it says — what is
 * configured on the device is the device's business, not a second record this
 * app keeps beside it (D41).
 */

/** The amounts an adult releases without thinking about it. */
const HOUR_CHOICES: readonly Choice[] = [0.5, 1, 1.5, 2, 3, 4].map((hours) => ({
  value: hours,
  label: formatHours(hours),
}));

const DEFAULT_HOURS = "1";

export function ReleaseForm({ kids }: { kids: Kid[] }) {
  const [userId, setUserId] = useState(kids[0]?.id ?? 0);
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [destination, setDestination] = useState("");

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

      <Button disabled={busy || typed === null} onClick={release} type="button">
        Liberar
      </Button>
    </div>
  );
}
