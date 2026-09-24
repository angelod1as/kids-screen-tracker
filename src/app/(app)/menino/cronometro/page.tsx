import { requireSession } from "../../../../auth/guard";
import { fetchTimerScreenAction } from "../../../actions/timer";
import { TimerScreen } from "./timer-screen";

/**
 * The action's `requireAccess`, not this page, refuses the brother's id. The
 * fetch is where D16's reconciliation happens. No heading: the panel band names
 * what the screen is doing (#74).
 */
export default async function KidTimerPage() {
  const session = await requireSession();
  const data = await fetchTimerScreenAction(session.userId);

  return <TimerScreen initial={data} />;
}
