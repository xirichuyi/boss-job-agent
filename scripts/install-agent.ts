import { installAction } from "../src/installation/flow.ts";
import { setupForm } from "../src/config/setup-form.ts";

const [action, ...args] = process.argv.slice(2);
const help =
  "npm run install:agent -- 操作 --workspace 工作区 [选项]\n操作：init/status/continue/desktop/browser-start/access/configure/profile/initialize/login/model-check/browser-check/attachments/attachment/accept/activate/services/start/pause/resume\nconfigure --answers 文件 [--confirm]；profile --file 文件或 --paste [--confirm]；access --ssh 用户@主机\n真实调用需 --confirm-model-call；真实发送需 --confirm-real-sends。";
try {
  if (!action || action === "--help") console.log(help);
  else {
    const options: Record<string, any> = {};
    const flags = [
      "confirm",
      "paste",
      "confirm-model-call",
      "confirm-real-sends",
    ];
    const values = ["workspace", "answers", "file", "name", "ssh"];
    for (let i = 0; i < args.length; i++) {
      const key = args[i].replace(/^--/, "");
      if (!args[i].startsWith("--") || key in options) throw Error(help);
      if (flags.includes(key)) options[key] = true;
      else if (
        values.includes(key) &&
        args[i + 1] &&
        !args[i + 1].startsWith("--")
      )
        options[key] = args[++i];
      else throw Error(help);
    }
    if (!options.workspace) throw Error(help);
    if (action === "configure" && !options.answers && !options.confirm)
      options.answersObject = await setupForm();
    if (options.paste) {
      if (options.file) throw Error("粘贴和文件导入只能选一个");
      if (process.stdin.isTTY)
        console.error("粘贴本人简历正文，以 Ctrl-D 结束；不会发送给模型。");
      let text = "";
      process.stdin.setEncoding("utf8");
      for await (const chunk of process.stdin) {
        text += chunk;
        if (text.length > 200000) throw Error("正文过长");
      }
      options.text = text;
    }
    console.log(
      JSON.stringify(
        await installAction(action, options.workspace, options),
        null,
        2,
      ),
    );
  }
} catch (error) {
  console.error("安装进度已保留：" + error.message);
  process.exitCode = 1;
}
