import { LinkButton } from "../ui/link-button";
import { BORDER_CLASS, SHELL_CLASS } from "../ui/style";

/**
 * Without it Next answers in English (#14). The installed app has no browser
 * back button (D46), so the way out is on the page.
 */
export default function NotFound() {
  return (
    <div
      className={`${SHELL_CLASS} ${BORDER_CLASS} flex min-h-dvh flex-col justify-center gap-6 border-b-0 border-t-0 bg-white p-6 text-black`}
    >
      <h1 className="text-3xl font-bold">Página não encontrada</h1>
      <p className={`${BORDER_CLASS} bg-white p-4 text-lg`}>
        Esse endereço não existe no app.
      </p>
      <LinkButton href="/">Ir para a tela inicial</LinkButton>
    </div>
  );
}
