import { saoPauloDay } from "../../../../engine/calculate";
import { HEADING_CLASS } from "../../../../ui/style";
import { listKidsAction } from "../../../actions/people";
import { RefundForm } from "./refund-form";

/** `today` is São Paulo's, decided on the server (D13), never the device's time zone. */
export default async function AdminRefundPage() {
  const kids = await listKidsAction();

  return (
    <section className="flex flex-col gap-4">
      <h1 className={HEADING_CLASS}>Estornar horas</h1>

      <RefundForm kids={kids} today={saoPauloDay(new Date())} />
    </section>
  );
}
