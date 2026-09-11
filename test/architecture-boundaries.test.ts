import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
function imports(file) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const result = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    )
      result.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(source) === "require")
    ) {
      assert.ok(
        node.arguments.length && ts.isStringLiteral(node.arguments[0]),
        "受保护层禁止动态拼接导入路径",
      );
      result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory()
      ? files(file)
      : file.endsWith(".ts")
        ? [file]
        : [];
  });
}
test("domain imports only domain modules and explicit non-I/O builtins", () => {
  const domain = path.join(sourceRoot, "domain") + path.sep;
  for (const file of files(domain))
    for (const specifier of imports(file)) {
      if (specifier === "node:crypto") continue;
      assert.ok(
        specifier.startsWith(".") &&
          path.resolve(path.dirname(file), specifier).startsWith(domain),
        `${path.basename(file)} violates domain boundary: ${specifier}`,
      );
    }
});
test("browser adapters cannot import application, runtime or CLI entrypoints", () => {
  for (const file of files(path.join(sourceRoot, "adapters/browser")))
    for (const specifier of imports(file)) {
      if (!specifier.startsWith(".")) continue;
      const target = path.resolve(path.dirname(file), specifier);
      for (const forbidden of ["application", "runtime", "../scripts"])
        assert.ok(
          !target.startsWith(path.resolve(sourceRoot, forbidden) + path.sep),
          `${path.basename(file)} violates browser boundary: ${specifier}`,
        );
    }
});
