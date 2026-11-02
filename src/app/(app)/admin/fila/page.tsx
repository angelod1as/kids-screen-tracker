import { fetchQueueAction } from "../../../actions/queue";
import { fetchSpendRequestsAction } from "../../../actions/spend-requests";
import { QueueList } from "./queue-list";
import { SpendRequestList } from "./spend-request-list";

/**
 * Each list's band carries its title and count (#74), so the `h1` is only for
 * screen readers: either list may empty on the client. Spend first: that boy is
 * waiting now, while an earn entry can wait for the evening.
 */
export default async function AdminQueuePage() {
  const [data, spendRequests] = await Promise.all([
    fetchQueueAction(),
    fetchSpendRequestsAction(),
  ]);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <h1 className="sr-only">Fila</h1>
      <SpendRequestList initial={spendRequests} />
      <QueueList initial={data} />
    </div>
  );
}
