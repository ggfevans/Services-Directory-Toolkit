// Packages the extension into build/<package name>-<version>.zip for the Chrome Web Store.
// Only files the extension references are zipped (see scripts/lib/extension-files.js), plus the
// repository LICENSE, which the MIT licence requires to ship with copies of the code.
import { createWriteStream, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";
import { referencedFiles } from "./lib/extension-files.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));

if (pkg.version !== manifest.version) {
  console.error(`Version mismatch: package.json is ${pkg.version}, src/manifest.json is ${manifest.version}`);
  process.exit(1);
}

const { files, problems } = referencedFiles(SRC);
if (problems.length) {
  console.error(`Build failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

mkdirSync(join(ROOT, "build"), { recursive: true });
const outFile = join(ROOT, "build", `${pkg.name}-${pkg.version}.zip`);
const output = createWriteStream(outFile);
const archive = new ZipArchive({ zlib: { level: 9 } });

const fail = (err) => {
  console.error(`Build failed: ${err.message}`);
  output.destroy();
  rmSync(outFile, { force: true });
  process.exit(1);
};

output.on("close", () => console.log(`Wrote ${relative(ROOT, outFile)} (${archive.pointer()} bytes)`));
// archiver reports skipped files (e.g. ENOENT) as warnings; treat them as failures so the zip is never incomplete.
archive.on("warning", fail);
archive.on("error", fail);

archive.pipe(output);
for (const file of files) {
  archive.file(join(SRC, file), { name: file });
}
archive.file(join(ROOT, "LICENSE"), { name: "LICENSE" });
archive.finalize();
