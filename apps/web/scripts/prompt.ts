/**
 * Preguntas por consola para los scripts de cuentas (HU23, HU29). Lee todas las
 * líneas de stdin de antemano cuando no es una terminal (por ejemplo, en pruebas)
 * y oculta lo escrito en las preguntas marcadas como secretas.
 */
import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline";

export function createPrompter() {
  const rl: Interface & { _writeToOutput?: (text: string) => void } = createInterface({
    input: stdin,
    output: stdout,
    terminal: stdin.isTTY,
  });
  const queued: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let muted = false;
  const write = rl._writeToOutput?.bind(rl);
  rl._writeToOutput = (text: string) => {
    if (!muted || text.includes("\n")) write?.(muted ? "\n" : text);
  };
  rl.on("line", (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else queued.push(line);
  });

  function ask(question: string, hidden = false): Promise<string> {
    stdout.write(question);
    muted = hidden && Boolean(stdin.isTTY);
    return new Promise((resolve) => {
      const take = (line: string) => {
        muted = false;
        if (hidden && !stdin.isTTY) stdout.write("\n");
        // La contraseña se guarda tal cual: el login no recorta espacios.
        resolve(hidden ? line : line.trim());
      };
      const ready = queued.shift();
      if (ready !== undefined) take(ready);
      else waiting.push(take);
    });
  }
  return { ask, close: () => rl.close() };
}
