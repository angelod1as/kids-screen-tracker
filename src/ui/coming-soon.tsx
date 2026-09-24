import { BORDER_CLASS } from "./style";

/**
 * A screen that exists so the menu of #14 has somewhere to point, and says
 * plainly which phase fills it in.
 *
 * The alternative was a menu whose items 404. A boy tapping "Cronômetro" and
 * getting a Next.js error page learns that the app is broken; this way he
 * learns that it is not finished, which is true.
 */
export function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className={`${BORDER_CLASS} bg-white p-4 text-lg text-black`}>
        {note}
      </p>
    </section>
  );
}
