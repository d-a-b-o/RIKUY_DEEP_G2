/** Bundle the production loader: no copied prediction or preprocessing code. */
const path = require("node:path");
const { createRequire } = require("node:module");
const web = path.resolve(process.argv[2]);
const fromWeb = createRequire(path.join(web, "package.json"));
const result = fromWeb("esbuild").buildSync({
  stdin: {
    resolveDir: web,
    contents: `
      import * as tf from '@tensorflow/tfjs-core';
      import '@tensorflow/tfjs-backend-webgl';
      import {loadInspectionModel} from './src/lib/model/loader';
      import {drawModelInput} from './src/lib/model/preprocess';
      import {GRAPH_COMPATIBILITY} from './src/lib/model/graph-compatibility';
      let model;
      export async function open(url, backend) {
        if (backend === 'wasm') tf.env().set('WEBGL_VERSION', 0);
        model = await loadInspectionModel(url);
        if (model.info.backend !== backend) throw Error('Backend inesperado: ' + model.info.backend);
        return {...model.info, tfjsVersion: tf.version_core, compatibility: GRAPH_COMPATIBILITY};
      }
      export async function predict(url) {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas');
        drawModelInput(image, canvas, model.info.input);
        const result = await model.predict(canvas);
        return {...result, tensors: model.tensorCount()};
      }
      export function dispose() {model.dispose(); return tf.memory().numTensors;}
    `,
  },
  bundle: true,
  format: "iife",
  globalName: "PT1Browser",
  platform: "browser",
  write: false,
});
process.stdout.write(result.outputFiles[0].text);
