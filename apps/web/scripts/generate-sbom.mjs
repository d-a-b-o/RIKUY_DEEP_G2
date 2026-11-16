import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Reviewed upstream peer declarations, not replacement versions or inventory data.
const approvedPeers = new Map([
  ["node_modules/eslint-config-next/node_modules/eslint-plugin-import", ["2.32.0", "^2 || ^3 || ^4 || ^5 || ^6 || ^7.2.0 || ^8 || ^9"]],
  ["node_modules/eslint-config-next/node_modules/eslint-plugin-jsx-a11y", ["6.10.2", "^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9"]],
  ["node_modules/eslint-config-next/node_modules/eslint-plugin-react", ["7.37.5", "^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7"]],
]);

/** Fail closed on missing packages and any unreviewed npm dependency problem. */
export function reviewDependencyProblems(tree, lock, status) {
  const eslint = lock.packages["node_modules/eslint"]?.version;
  const notes = new Set();
  const errors = [];
  function walk(node, name = "") {
    if (node.missing || node.extraneous) errors.push(`Missing/extraneous dependency: ${name}`);
    for (const problem of node.problems ?? []) {
      if (!eslint?.startsWith("10.") || !problem.startsWith(`invalid: eslint@${eslint} `)) errors.push(problem);
    }
    if (node.invalid) {
      const invalid = String(node.invalid).replaceAll("\\", "/");
      const clauses = [...invalid.matchAll(/"([^"]+)" from ([^,]+)/g)];
      if (name !== "eslint" || node.version !== eslint || !eslint?.startsWith("10.") ||
          !clauses.length || clauses.map((m) => m[0]).join(", ") !== invalid) errors.push(`Unreviewed invalid dependency: ${name}`);
      for (const [, range, path] of clauses) {
        const approved = approvedPeers.get(path);
        const declared = lock.packages[path];
        if (!approved || declared?.version !== approved[0] || range !== approved[1] || declared?.peerDependencies?.eslint !== range) {
          errors.push(`Unreviewed peer declaration: ${path}`);
        } else notes.add(`${path}@${declared.version}: eslint ${range}; resolved ${eslint}`);
      }
    }
    for (const [childName, child] of Object.entries(node.dependencies ?? {})) walk(child, childName);
  }
  walk(tree);
  if (tree.error && tree.error.code !== "ELSPROBLEMS") errors.push(tree.error.code);
  if (status !== 0 && !(status === 1 && tree.error?.code === "ELSPROBLEMS" && notes.size)) errors.push(`npm ls exited ${status}`);
  if (errors.length) throw new Error([...new Set(errors)].join("\n"));
  return [...notes].sort();
}

/** Every locked package identity must be represented, including dev/peer/optional deps. */
export function assertCoverage(bom, lock) {
  if (bom.bomFormat !== "CycloneDX" || !bom.components?.length) throw new Error("Invalid or empty CycloneDX inventory");
  const identities = new Set();
  function walk(items) {
    for (const item of items) {
      identities.add(`${item.group ? item.group + "/" : ""}${item.name}@${item.version}`);
      walk(item.components ?? []);
    }
  }
  walk(bom.components);
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    const name = path.split("node_modules/").at(-1);
    if (!identities.has(`${entry.name ?? name}@${entry.version}`) && !identities.has(`${name}@${entry.version}`)) {
      throw new Error(`SBOM omitted locked package: ${path}@${entry.version}`);
    }
  }
  return identities.size;
}

function main() {
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const lockText = readFileSync(resolve(cwd, "package-lock.json"), "utf8");
  const lock = JSON.parse(lockText);
  if (!process.env.npm_execpath) throw new Error("Run through npm run sbom");
  // Override inherited legacy-peer-deps/omit settings: inventory the entire lockfile.
  const env = { ...process.env, NODE_ENV: "development", npm_config_legacy_peer_deps: "false",
    npm_config_omit: "", npm_config_include: "dev" };
  const listing = spawnSync(process.execPath, [process.env.npm_execpath, "ls", "--all", "--long", "--json",
    "--package-lock-only", "--legacy-peer-deps=false", "--include=dev", "--include=optional", "--include=peer"],
  { cwd, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (listing.error) throw listing.error;
  const notes = reviewDependencyProblems(JSON.parse(listing.stdout), lock, listing.status);
  const output = resolve(cwd, process.argv[2] ?? "sbom-web.cdx.json");
  mkdirSync(dirname(output), { recursive: true });
  const temporary = resolve(dirname(output), `.sbom-${randomUUID()}.json`);
  try {
    const generator = fileURLToPath(new URL("../node_modules/@cyclonedx/cyclonedx-npm/bin/cyclonedx-npm-cli.js", import.meta.url));
    const args = [generator, "--package-lock-only", "--flatten-components", "--spec-version", "1.6",
      "--output-format", "JSON", "--validate", "--output-file", temporary];
    // Only reached after checking every reported npm error against the narrow policy above.
    if (notes.length) args.push("--ignore-npm-errors");
    const generated = spawnSync(process.execPath, args, { cwd, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    if (generated.error) throw generated.error;
    if (generated.status !== 0) throw new Error(`CycloneDX generator exited ${generated.status}: ${generated.stderr}`);
    const bom = JSON.parse(readFileSync(temporary, "utf8"));
    const components = assertCoverage(bom, lock);
    writeFileSync(output + ".compatibility.json", JSON.stringify({
      scope: "Full lockfile: production, development, peer and optional dependencies",
      generatorDiagnostics: generated.stderr.trim(),
      lockfileSha256: createHash("sha256").update(lockText).digest("hex"), reviewedPeerDeclarations: notes, coveredPackageIdentities: components,
      lockedPackageLocations: Object.keys(lock.packages).length - 1,
      notice: "Inventory does not certify peer compatibility. Lint, tests and security audits remain mandatory.",
    }, null, 2) + "\n");
    renameSync(temporary, output);
    for (const note of notes) console.warn(`SBOM reviewed peer declaration: ${note}`);
    console.log(`CycloneDX validated: ${components} package identities; ${notes.length} reviewed peer declarations.`);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
