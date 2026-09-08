import { ROOT } from '../src/project-root.js';
import { flushTelegram } from '../src/telegram.js';
console.log(JSON.stringify(await flushTelegram(ROOT)));
