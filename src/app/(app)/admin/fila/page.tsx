import { fetchQueueAction } from "../../../actions/queue";
import { QueueList } from "./queue-list";

/**
 * The approval queue (#20).
 *
 * The page fetches and the list draws; both halves go through the same
 * admin-only endpoints, so a kid who types the URL is bounced by
 * `admin/layout.tsx` and a kid who sends the POST by hand is refused by
 * `requireAdmin` (`queue.test.ts` sends it).
 *
 * The title lives on the list and not here (#74): the count of what is waiting
 * changes as the adult decides, and in this design the title band is where a
 * panel carries its count. A heading here and a count there would be the same
 * fact written twice, half a screen apart.
 */
export default async function AdminQueuePage() {
  const data = await fetchQueueAction();

  return <QueueList initial={data} />;
}
