import { VisibleTools } from "../src/adapters/browser/visible.ts";
const b = new VisibleTools();
try {
  await b.connectView("jobs");
  await b.guard();
  const ready = await b.evaluate(
    `!!document.querySelector('.cur-city-label') && !!document.querySelector('.job-card-wrap')`,
  );
  if (!ready) throw new Error("岗位页未就绪");
  console.log("ready");
} catch (error) {
  console.error(
    "浏览器检查失败：" +
      error.message +
      "；运行 npm run doctor 查看依赖和标签页诊断。",
  );
  process.exitCode = 1;
} finally {
  b.disconnect();
}
