import { stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline";

import { MAX_PASSWORD_LENGTH } from "../src/auth/credentials";
import { hashPassword } from "../src/auth/password-hash";

/**
 * Prints the `users.password_hash` for a password read from stdin (D45). Opens
 * no database: the owner runs the SQL by hand. Typed input is not echoed.
 */

async function readHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stderr, terminal: true });
  // Readline clears the line before every redraw, so redraw the prompt and
  // keep the typed characters off the terminal.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (
    s,
  ) => {
    if (s.startsWith(prompt)) stderr.write(prompt);
  };
  const answer = await new Promise<string>((resolve) =>
    rl.question(prompt, resolve),
  );
  rl.close();
  stderr.write("\n");

  return answer;
}

async function readPiped(): Promise<string> {
  let data = "";
  for await (const chunk of stdin) {
    data += chunk;
  }

  return data.replace(/\r?\n$/, "");
}

async function main(): Promise<number> {
  let password: string;
  if (stdin.isTTY) {
    password = await readHidden("Senha: ");
    if ((await readHidden("De novo: ")) !== password) {
      stderr.write("As duas senhas não conferem.\n");
      return 1;
    }
  } else {
    password = await readPiped();
  }

  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    stderr.write(
      `A senha precisa ter de 1 a ${MAX_PASSWORD_LENGTH} caracteres.\n`,
    );
    return 1;
  }

  stdout.write(`${await hashPassword(password)}\n`);
  return 0;
}

main().then((code) => {
  process.exitCode = code;
});
