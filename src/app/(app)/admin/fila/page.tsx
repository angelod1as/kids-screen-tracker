import { fetchQueueAction } from "../../../actions/queue";
import { fetchSpendRequestsAction } from "../../../actions/spend-requests";
import { QueueList } from "./queue-list";
import { SpendRequestList } from "./spend-request-list";

/** No title here: each list's band carries its title and count (#74). */
export default async function AdminQueuePage() {
  const [data, spendRequests] = await Promise.all([
    fetchQueueAction(),
    fetchSpendRequestsAction(),
  ]);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <QueueList initial={data} />
      <SpendRequestList initial={spendRequests} />
    </div>
  );
}
