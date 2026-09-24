import { requireSession } from "../../../../auth/guard";
import { fetchHowItWorksAction } from "../../../actions/how-it-works";
import { AdultGuide } from "./adult-guide";
import { KidGuide } from "./kid-guide";

/** "Como funciona" (#107), reached from the account page, one version per role. */
export default async function HowItWorksPage() {
  const session = await requireSession();
  const data = await fetchHowItWorksAction();

  return session.role === "admin" ? (
    <AdultGuide data={data} />
  ) : (
    <KidGuide data={data} />
  );
}
