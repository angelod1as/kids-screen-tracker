"use client";

import { useActionState, useState } from "react";

import { Button } from "../../ui/button";
import { Field } from "../../ui/field";
import { BORDER_CLASS } from "../../ui/style";
import { EMPTY_LOGIN_STATE } from "../actions/login-state";
import { loginAction } from "../actions/session";

/**
 * Import nothing that reads `ENV`: in a client file it builds, then kills the
 * server on the first request. The username is controlled because React 19
 * resets an uncontrolled form after the action; the password stays uncontrolled
 * so the reset clears it.
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
