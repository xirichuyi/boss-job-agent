import { ROOT } from "../src/project-root.ts";
import { flushTelegram } from "../src/adapters/telegram/transport.ts";
console.log(JSON.stringify(await flushTelegram(ROOT)));
