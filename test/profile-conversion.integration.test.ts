import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { importProfile } from "../src/config/profile-import.ts";

// Optional real converter integration; unit tests cover missing tools and failures.
test(
  "real PDF and DOCX files import through local converters",
  { skip: process.env.RUN_PROFILE_CONVERTERS !== "1" },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "profile-conversion-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const md = path.join(root, "resume.md"),
      docx = path.join(root, "resume.docx"),
      pdf = path.join(root, "resume.pdf");
    const content = "Backend engineer with Go and AI project experience.";
    fs.writeFileSync(md, content);
    // Supports isolated distro package extraction without installing host packages.
    const dataArgs = process.env.PROFILE_PANDOC_DATA_DIR
      ? ["--data-dir", process.env.PROFILE_PANDOC_DATA_DIR]
      : [];
    const conversion = spawnSync(
      "pandoc",
      [...dataArgs, md, "--to=docx", "--output", docx],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(conversion.status, 0, conversion.stderr);
    assert.match(importProfile(docx), /Backend engineer/);
    const stream = `BT /F1 12 Tf 20 100 Td (${content}) Tj ET`;
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ];
    let document = "%PDF-1.4\n";
    const offsets = [0];
    for (const [i, value] of objects.entries()) {
      offsets.push(Buffer.byteLength(document));
      document += `${i + 1} 0 obj\n${value}\nendobj\n`;
    }
    const xref = Buffer.byteLength(document);
    document +=
      `xref\n0 6\n0000000000 65535 f \n` +
      offsets
        .slice(1)
        .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
        .join("");
    document += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    fs.writeFileSync(pdf, document);
    assert.match(importProfile(pdf), /Backend engineer/);
  },
);
