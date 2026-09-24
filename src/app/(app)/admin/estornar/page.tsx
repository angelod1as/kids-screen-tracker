import { saoPauloDay } from "../../../../engine/calculate";
import { HEADING_CLASS } from "../../../../ui/style";
import { listKidsAction } from "../../../actions/people";
import { RefundForm } from "./refund-form";

/**
 * Giving hours back (#24).
 *
 * `today` is decided here, on the server, in São Paulo (D13): it is the default
 * of the date field and the ceiling on it. A browser's own idea of today is the
 * device's time zone, which is the bug D13 exists to keep out of a calendar
 * date — and the endpoint refuses a future day whatever the field allows.
 */
export default async function AdminRefundPage() {
  const kids = await listKidsAction();

  return (
    <section className="flex flex-col gap-4">
      <h1 className={HEADING_CLASS}>Estornar horas</h1>

      <RefundForm kids={kids} today={saoPauloDay(new Date())} />
    </section>
  );
}
