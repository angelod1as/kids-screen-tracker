import { requireSession } from "../../../../auth/guard";
import { fetchTimerScreenAction } from "../../../actions/timer";
import { TimerScreen } from "./timer-screen";

/**
 * The timer (#18, #19).
 *
 * The id handed to the action is `session.userId` and it is the only id this
 * page has — but that is the weaker half of the access rule. The half that
 * holds is inside the action: a request carrying the brother's id is refused by
 * `requireAccess` before anything is read or written, and `timer.test.ts` sends
 * exactly that request.
 *
 * The fetch is also where D16's reconciliation happens: opening this screen is
 * what settles a session that ran past its limit an hour ago, or one that was
 * left paused overnight. Nothing runs in the background, and nothing has to.
 *
 * There is no heading here (#74). What the screen is called depends on what it
 * is doing — the name of the activity while one is running, "Confirme o que
 * você fez" while he is sending it — and that name belongs in the band of the
 * panel it titles. A fixed "Cronômetro" above it would be a second heading
 * saying less than the first.
 */
export default async function KidTimerPage() {
  const session = await requireSession();
  const data = await fetchTimerScreenAction(session.userId);

  return <TimerScreen initial={data} />;
}
