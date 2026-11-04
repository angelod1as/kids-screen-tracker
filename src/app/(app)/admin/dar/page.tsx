import { saoPauloDay } from "../../../../engine/calculate";
import { HEADING_CLASS } from "../../../../ui/style";
import { listKidsAction } from "../../../actions/people";
import { RefundForm } from "./refund-form";

/** `today` is São Paulo's, decided on the server (D13), never the device's time zone. */
export default async function AdminRefundPage({
  searchParams,
}: {
  searchParams: Promise<{ menino?: string | string[] }>;
}) {
  const [kids, { menino }] = await Promise.all([
    listKidsAction(),
    searchParams,
  ]);
  // The history shortcut names the boy; an unknown id falls back to the first.
  const initialUserId = kids.find((kid) => String(kid.id) === menino)?.id;

  return (
    <section className="flex flex-col gap-4 lg:max-w-2xl">
      <h1 className={HEADING_CLASS}>Dar horas</h1>

      <RefundForm
        initialUserId={initialUserId}
        kids={kids}
        today={saoPauloDay(new Date())}
      />
    </section>
  );
}
