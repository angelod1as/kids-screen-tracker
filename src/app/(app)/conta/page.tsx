import { requireSession } from "../../../auth/guard";
import { Button } from "../../../ui/button";
import { LinkButton } from "../../../ui/link-button";
import { Panel } from "../../../ui/panel";
import { logoutAction } from "../../actions/session";

/**
 * The account page (#70): who you are, and the things that are not part of an
 * ordinary day.
 *
 * It is what the identity cell on the left of the bottom bar opens, and it
 * exists because that cell used to be a top bar on every screen with a large
 * "Sair" next to a name nobody needed to be told.
 *
 * **Per role.** Both get "Como funciona" (#107) and the way out. An admin gets
 * Configuração as well: it left the bottom bar with this issue, and this is
 * where it belongs — changing what an activity is worth is not a Tuesday, and
 * the bar is for Tuesdays. From any screen it is two taps, which is the ceiling
 * CLAUDE.md sets for a common operation.
 *
 * The panel band carries the name and the role (#74), which is the one thing
 * the removed top bar was doing that was worth keeping — two adults and two
 * boys share four phones, and "ADULTO / Admin1" answers a question "Admin1"
 * leaves open. It costs a band on one screen instead of a strip on every one.
 *
 * `requireSession` is the navigation half of the rule. The half that holds is
 * on the other side of each link: `/admin/*` refuses a kid in its layout, every
 * action behind Configuração refuses him again (D33), and `logoutAction` needs
 * no guard at all — it reads nothing and writes nothing but the caller's own
 * cookie, so the worst a forged call can do is log its own sender out. That is
 * one of the two documented exceptions in `guarded.test.ts`.
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
