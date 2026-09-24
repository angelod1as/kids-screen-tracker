import { fetchQueueAction } from "../../../actions/queue";
import { QueueList } from "./queue-list";

/** No title here: the list's band carries the title and the count (#74). */
export default async function AdminQueuePage() {
  const data = await fetchQueueAction();

  return <QueueList initial={data} />;
}
