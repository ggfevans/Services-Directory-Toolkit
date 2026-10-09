// Packages src/ into build/<package name>-<version>.zip for the Chrome Web Store.
import { createWriteStream, mkdirSync, readFileSync, rmSync } from "node:fs";
import { ZipArchive } from "archiver";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8"));

if (pkg.version !== manifest.version) {
  console.error(`Version mismatch: package.json is ${pkg.version}, src/manifest.json is ${manifest.version}`);
  process.exit(1);
}

mkdirSync("build", { recursive: true });
const outFile = `build/${pkg.name}-${pkg.version}.zip`;
const output = createWriteStream(outFile);
const archive = new ZipArchive({ zlib: { level: 9 } });

const fail = (err) => {
  console.error(`Build failed: ${err.message}`);
  output.destroy();
  rmSync(outFile, { force: true });
  process.exit(1);
};

output.on("close", () => console.log(`Wrote ${outFile} (${archive.pointer()} bytes)`));
// archiver reports skipped files (e.g. ENOENT) as warnings; treat them as failures so the zip is never incomplete.
archive.on("warning", fail);
archive.on("error", fail);

archive.pipe(output);
archive.glob("**", { cwd: "src", ignore: ["**/.DS_Store"] });
archive.finalize();
