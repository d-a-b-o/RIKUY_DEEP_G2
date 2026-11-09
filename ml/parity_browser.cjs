/** Build a test harness from the actual web sources, without copying their algorithms. */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const web = path.resolve(process.argv[2]);
const fromWeb = createRequire(path.join(web, "package.json"));
const ts = fromWeb("typescript");
const preprocessing = fs.readFileSync(path.join(web, "src/lib/model/preprocess.ts"), "utf8");
const loader = fs.readFileSync(path.join(web, "src/lib/model/loader.ts"), "utf8");
const tree = ts.createSourceFile("loader.ts", loader, ts.ScriptTarget.Latest, true);
let body;

function visit(node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(tree) === "predict") {
    function findTidy(child) {
      if (ts.isCallExpression(child) && child.expression.getText(tree) === "tf.tidy") {
        const callback = child.arguments[0];
        if (ts.isArrowFunction(callback) && ts.isBlock(callback.body)) body = callback.body;
      }
      ts.forEachChild(child, findTidy);
    }
    findTidy(node);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
if (!body) throw new Error("No se encontró el preprocesamiento de predict; revisar el harness.");
const statements = [...body.statements];
const prediction = statements.pop();
let expression = ts.isReturnStatement(prediction) ? prediction.expression : undefined;
while (expression && (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression))) {
  expression = expression.expression;
}
if (expression?.getText(tree) !== "model.predict(batch)") {
  throw new Error("El flujo de predict cambió; no se puede extraer su entrada de forma segura.");
}
const printer = ts.createPrinter();
const normalize = statements.map((s) => printer.printNode(ts.EmitHint.Unspecified, s, tree)).join("\n");
const moduleSource = ts.transpileModule(preprocessing, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;

process.stdout.write(JSON.stringify({
  source: `${moduleSource}\n globalThis.pt1Draw = drawModelInput;
globalThis.pt1Tensor = (canvas, input) => {
  const active = { input };
  return tf.tidy(() => { ${normalize}\n return batch; });
};`,
  core: fromWeb.resolve("@tensorflow/tfjs-core/dist/tf-core.min.js"),
  backend: fromWeb.resolve("@tensorflow/tfjs-backend-cpu/dist/tf-backend-cpu.min.js"),
  tfjs_version: fromWeb("@tensorflow/tfjs-core/package.json").version,
}));
