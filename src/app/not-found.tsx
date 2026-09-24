import { BORDER_CLASS, SHELL_CLASS } from "../ui/style";

/**
 * What a wrong address shows (#14: "toda a interface em pt-BR").
 *
 * Without this file Next serves its own page, and its own page says "This page
 * could not be found." in English — which the review round found by asking for
 * `/naoexiste`. `design.test.ts` never noticed because it reads `lang` out of
 * the root layout, and the root layout is not what renders that screen.
 *
 * There is no link back on purpose: `design.test.ts` refuses a raw `<a>` or
 * `<Link>` outside `src/ui/`, and a navigation primitive invented for this one
 * screen is a primitive with one caller. A boy who lands here is one tap from
 * where he was, because the bar at the bottom is still on the screen he came
 * from.
 */
export default function NotFound() {
  return (
    <div
      className={`${SHELL_CLASS} ${BORDER_CLASS} flex min-h-dvh flex-col justify-center gap-6 border-b-0 border-t-0 bg-white p-6 text-black`}
    >
      <h1 className="text-3xl font-bold">Página não encontrada</h1>
      <p className={`${BORDER_CLASS} bg-white p-4 text-lg`}>
        Esse endereço não existe no app. Volte pelo botão do navegador ou pelo
        menu no rodapé da tela anterior.
      </p>
    </div>
  );
}
