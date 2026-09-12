import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function validateProfile(text: string): string {
  const value = text.replace(/\r\n/g, "\n").trim();
  if (
    !value ||
    value.includes("\0") ||
    /请替换|填写自己的姓名|禁止把示例当真实经历|\/绝对路径\/|\/path\/to\/|你的姓名/.test(
      value,
    )
  )
    throw Error("需要本人真实简历正文，不能使用示例、占位路径或空文档");
  if (value.length > 200000) throw Error("简历正文过长，请精简后导入");
  return value + "\n";
}

export function importProfile(file: string, run = spawnSync): string {
  const input = path.resolve(file);
  if (
    !fs.statSync(input).isFile() ||
    fs.statSync(input).size > 20 * 1024 * 1024
  )
    throw Error("简历必须是20MB以内的文件");
  if (/[\\/]examples[\\/]candidate-profile\.md$/.test(input))
    throw Error("请先填写自己的简历，不可直接导入示例");
  const ext = path.extname(input).toLowerCase();
  if ([".md", ".txt", ".markdown"].includes(ext))
    return validateProfile(fs.readFileSync(input, "utf8"));
  const converters = {
    ".pdf": ["pdftotext", ["-enc", "UTF-8", input, "-"]],
    ".docx": ["pandoc", ["--from=docx", "--to=plain", input]],
    ".doc": ["antiword", [input]],
  };
  const converter = converters[ext];
  if (!converter) throw Error("支持粘贴正文、MD/TXT、PDF、DOCX、DOC");
  const [binary, args] = converter;
  const result = run(binary, args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: "C.UTF-8" },
  });
  if (result.status !== 0)
    throw Error(
      `简历转换失败：检查 ${binary} 是否安装，或改用粘贴正文；不输出原文件内容`,
    );
  if (!result.stdout.trim())
    throw Error("未提取到文字：扫描PDF请先OCR或粘贴正文");
  return validateProfile(result.stdout);
}
