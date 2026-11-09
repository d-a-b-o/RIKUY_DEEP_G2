// RIKDP-154: motores reales, tensores idénticos, sin preprocesamiento canvas.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const fromWeb = createRequire(path.resolve(process.argv[2], 'package.json'));
const tf = fromWeb('@tensorflow/tfjs-core');
fromWeb('@tensorflow/tfjs-backend-cpu');
const converter = fromWeb('@tensorflow/tfjs-converter');

async function main() {
  await tf.setBackend('cpu');
  await tf.ready();
  const model = await converter.loadGraphModel(process.argv[3]);
  const work = process.argv[4];
  const samples = JSON.parse(fs.readFileSync(path.join(work, 'samples.json'), 'utf8'));
  const predictions = [];
  try {
    for (const sample of samples) {
      const bytes = fs.readFileSync(path.join(work, sample.tensor_file));
      const values = new Float32Array(bytes.length / 4);
      for (let i = 0; i < values.length; i++) values[i] = bytes.readFloatLE(i * 4);
      const input = tf.tensor(values, [1, 400, 400, 3], 'float32');
      let output;
      try {
        output = await model.executeAsync(input);
        if (Array.isArray(output) || output.size !== 1) throw new Error('Salida sigmoid inválida');
        const probability = (await output.data())[0];
        if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Probabilidad inválida');
        predictions.push({id: sample.id, tfjs: probability});
      } finally {
        input.dispose();
        if (output) tf.dispose(output);
      }
      if (predictions.length % 10 === 0) console.log(`TF.js CPU ${predictions.length}/${samples.length}`);
    }
  } finally { model.dispose(); }
  fs.writeFileSync(path.join(work, 'predictions.json'), JSON.stringify({
    predictions, tfjs_version: tf.version_core, backend: tf.getBackend(), node: process.version
  }));
}
main().catch(error => { console.error(error); process.exitCode = 2; });
