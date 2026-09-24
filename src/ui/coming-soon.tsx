import { BORDER_CLASS } from "./style";

/** So a menu item never 404s: an unfinished screen should say so, not look broken. */
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
