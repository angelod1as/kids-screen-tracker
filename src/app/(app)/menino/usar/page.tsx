import { requireSession } from "../../../../auth/guard";
import { saoPauloDay } from "../../../../engine/calculate";
import { formatDay } from "../../../../ui/dates";
import { formatHours } from "../../../../ui/hours";
import { Panel } from "../../../../ui/panel";
import {
  BALANCE_CLASS,
  BALANCE_FACE_CLASS,
  balanceToneClass,
} from "../../../../ui/style";
import { fetchBalanceAction } from "../../../actions/balance";
import { SpendRequestForm } from "./spend-request-form";

/**
 * D58: the boy asks to spend his own time. The action's `requireAccess` refuses
 * the brother's id, not this page. The balance is shown but never a gate: the
 * request may exceed it (D58), and the adult decides.
 */
export default async function KidUsePage() {
  const session = await requireSession();
  const balance = await fetchBalanceAction(session.userId);
  const today = saoPauloDay(new Date());

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <Panel note={formatDay(today)} title="Seu saldo" top>
        <p
          className={`${balanceToneClass(balance)} ${BALANCE_CLASS} ${BALANCE_FACE_CLASS}`}
        >
          {formatHours(balance)}
        </p>
      </Panel>

      <Panel title="Pedir pra usar">
        <SpendRequestForm userId={session.userId} />
      </Panel>
    </div>
  );
}
