import { requireSession } from "../../../../auth/guard";
import { fetchTimerScreenAction } from "../../../actions/timer";
import { TimerScreen } from "./timer-screen";

/**
 * The action's `requireAccess`, not this page, refuses the brother's id. The
 * fetch is where D16's reconciliation happens. No heading: the panel band names
 * what the screen is doing (#74).
 */
export default async function KidTimerPage({
  searchParams,
}: {
  searchParams: Promise<{ atividade?: string | string[] }>;
}) {
  const session = await requireSession();
  const [data, { atividade }] = await Promise.all([
    fetchTimerScreenAction(session.userId),
    searchParams,
  ]);

  return (
    <TimerScreen
      initial={data}
      initialActivityId={
        atividade === undefined ? undefined : Number(atividade)
      }
    />
  );
}
