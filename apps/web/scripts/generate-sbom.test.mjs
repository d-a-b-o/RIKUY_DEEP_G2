import { describe, expect, it } from "vitest";
import { assertCoverage, reviewDependencyProblems } from "./generate-sbom.mjs";

const path = "node_modules/eslint-config-next/node_modules/eslint-plugin-import";
const range = "^2 || ^3 || ^4 || ^5 || ^6 || ^7.2.0 || ^8 || ^9";
function reviewedFixture() {
  const problem = "invalid: eslint@10.14.0 /project/node_modules/eslint";
  return {
    lock: { packages: { "": {}, "node_modules/eslint": { version: "10.14.0" },
      [path]: { version: "2.32.0", peerDependencies: { eslint: range } } } },
    tree: { problems: [problem], error: { code: "ELSPROBLEMS" }, dependencies: {
      eslint: { version: "10.14.0", invalid: `"${range}" from ${path}`, problems: [problem] },
    } },
  };
}

describe("SBOM dependency error policy", () => {
  it("accepts a clean tree without enabling error tolerance", () => {
    expect(reviewDependencyProblems({ dependencies: {} }, { packages: {} }, 0)).toEqual([]);
  });
  it("records the reviewed upstream declaration without changing resolved versions", () => {
    const { tree, lock } = reviewedFixture();
    expect(reviewDependencyProblems(tree, lock, 1)).toEqual([
      `${path}@2.32.0: eslint ${range}; resolved 10.14.0`,
    ]);
  });
  it("rejects missing packages even alongside a reviewed peer mismatch", () => {
    const { tree, lock } = reviewedFixture();
    tree.dependencies.missing = { missing: true };
    expect(() => reviewDependencyProblems(tree, lock, 1)).toThrow("Missing/extraneous");
  });
  it("rejects other invalid packages and unrecognized command failures", () => {
    const { tree, lock } = reviewedFixture();
    tree.problems.push("invalid: next@0.0.0 /project/node_modules/next");
    expect(() => reviewDependencyProblems(tree, lock, 1)).toThrow("next@0.0.0");
    expect(() => reviewDependencyProblems({}, { packages: {} }, null)).toThrow();
  });
  it("requires review when upstream package version, range, or ESLint major changes", () => {
    for (const change of ["version", "range", "eslint"]) {
      const { tree, lock } = reviewedFixture();
      if (change === "version") lock.packages[path].version = "2.33.0";
      if (change === "range") lock.packages[path].peerDependencies.eslint = "^8";
      if (change === "eslint") lock.packages["node_modules/eslint"].version = "11.0.0";
      expect(() => reviewDependencyProblems(tree, lock, 1)).toThrow();
    }
  });
});

describe("SBOM completeness", () => {
  const lock = { packages: { "": {}, "node_modules/vite": { version: "8.3.6", peer: true },
    "node_modules/optional": { version: "1.0.0", optional: true },
    "node_modules/alias": { name: "actual", version: "2.0.0", dev: true } } };
  const components = [{ name: "vite", version: "8.3.6" }, { name: "optional", version: "1.0.0" },
    { name: "actual", version: "2.0.0" }];
  it("requires peers, optional packages and development aliases from the lockfile", () => {
    expect(assertCoverage({ bomFormat: "CycloneDX", components }, lock)).toBe(3);
    for (let missing = 0; missing < components.length; missing++) {
      expect(() => assertCoverage({ bomFormat: "CycloneDX", components: components.filter((_, i) => i !== missing) }, lock)).toThrow("omitted locked package");
    }
  });
  it("rejects empty or malformed inventories", () => {
    expect(() => assertCoverage({ bomFormat: "CycloneDX", components: [] }, lock)).toThrow();
    expect(() => assertCoverage({ bomFormat: "other", components }, lock)).toThrow();
  });
});
