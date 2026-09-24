import { requireSession } from "../../../auth/guard";
import { Button } from "../../../ui/button";
import { LinkButton } from "../../../ui/link-button";
import { Panel } from "../../../ui/panel";
import { logoutAction } from "../../actions/session";

/**
 * Configuração lives here, not in the bar: not a daily operation, and still two
 * taps away. The band names the person and role, since four people share four
 * phones. `requireSession` is navigation; the guards are behind each link.
 */
export default async function AccountPage() {
  const session = await requireSession();

  return (
    <div className="flex flex-col gap-4 lg:max-w-md lg:gap-6">
      <Panel
        note={session.role === "admin" ? "adulto" : "menino"}
        title={session.displayName}
        top
      >
        <div className="flex flex-col gap-3 p-3">
          <LinkButton href="/conta/como-funciona" variant="secondary">
            Como funciona
          </LinkButton>

          {session.role === "admin" ? (
            <LinkButton href="/admin/configuracao" variant="secondary">
              Configuração
            </LinkButton>
          ) : null}

          <form action={logoutAction}>
            <Button type="submit">Sair</Button>
          </form>
        </div>
      </Panel>
    </div>
  );
}
