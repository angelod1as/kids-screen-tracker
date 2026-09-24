"use client";

import { useActionState, useState } from "react";

import { Button } from "../../ui/button";
import { Field } from "../../ui/field";
import { BORDER_CLASS } from "../../ui/style";
import { EMPTY_LOGIN_STATE } from "../actions/login-state";
import { loginAction } from "../actions/session";

/**
 * The login form (#12). Username, password, one button.
 *
 * A client component only for `useActionState`, which is what gives the
 * `pending` flag below. It imports the action and the two presentational
 * primitives and nothing else — in particular nothing that reads `ENV`, which
 * in a `"use client"` file builds cleanly and then kills the server process on
 * the first request.
 *
 * The pending state is a word and a disabled button, not a spinner. The design
 * rules allow a spinner "onde há espera real" and this is one, but the wait is
 * a local round trip measured in milliseconds and a spinner that flashes for
 * one frame is decoration wearing a badge. Nothing in this repository animates;
 * `design.test.ts` fails if anything starts to.
 *
 * `autoCapitalize="none"` matters on a phone: an Android keyboard capitalises
 * the first letter of a text field by default, so the boy types "Kid1" into
 * a field whose stored value is "kid1". `normalizeUsername` lowercases as well —
 * both, because either one alone is a login that fails for a reason the person
 * typing cannot see.
 *
 * The username box is controlled and the password box is not, which is the
 * whole point of the pair. React 19 resets an uncontrolled form when the action
 * it submitted finishes, so a wrong password used to clear the username too —
 * measured in a browser: after submitting `kid1` and a wrong password, the
 * field read `""`. The boy retypes his own name to fix a typo in the password.
 * Holding it in state keeps it across the submit without a round trip, and
 * without the username ever travelling back inside `LoginState`, which is
 * serialised into the page. The password is left uncontrolled precisely so that
 * the reset still clears it.
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    loginAction,
    EMPTY_LOGIN_STATE,
  );
  const [username, setUsername] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field
        autoCapitalize="none"
        autoComplete="username"
        autoCorrect="off"
        id="username"
        label="Usuário"
        name="username"
        onChange={(event) => setUsername(event.target.value)}
        required
        spellCheck={false}
        type="text"
        value={username}
      />

      <Field
        autoComplete="current-password"
        id="password"
        label="Senha"
        name="password"
        required
        type="password"
      />

      {state.error === null ? null : (
        <p
          className={`${BORDER_CLASS} bg-white p-3 text-base font-bold text-black`}
          role="alert"
        >
          {state.error}
        </p>
      )}

      <Button disabled={pending} type="submit">
        {pending ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
