import "@tensorflow/tfjs-backend-cpu";
import * as tf from "@tensorflow/tfjs-core";
import type { GraphNode, OpExecutor } from "@tensorflow/tfjs-converter";
import { beforeAll, describe, expect, it } from "vitest";
import { registerGraphCompatibility } from "./graph-compatibility";

let execute: OpExecutor;
beforeAll(async () => {
  await tf.setBackend("cpu");
  await tf.ready();
  registerGraphCompatibility(tf, { registerOp: (_name, op) => { execute = op; } });
});

function fixture(shape: number[]) {
  return {
    inputs: [tf.tensor4d([-2, -1, 1, 2], [1, 2, 2, 1]),
      tf.tensor4d([1, 2], [1, 1, 1, 2]), tf.tensor([0.25, 0.5], shape)],
    attrs: { fused_ops: ["BiasAdd", "Relu"], num_args: 1, data_format: "NHWC",
      padding: "VALID", strides: [1, 1, 1, 1], dilations: [1, 1, 1, 1] },
  } satisfies GraphNode;
}

describe("compatibilidad ResNet50V2", () => {
  it.each([[2], [1, 1, 1, 2]])("conserva BiasAdd y ReLU con forma %j", (...shape) => {
    const count = tf.memory().numTensors;
    const node = fixture(shape);
    const output = execute(node) as tf.Tensor;
    expect(output.shape).toEqual([1, 2, 2, 2]);
    expect(Array.from(output.dataSync())).toEqual([0, 0, 0, 0, 1.25, 2.5, 2.25, 4.5]);
    tf.dispose([output, ...node.inputs]);
    expect(tf.memory().numTensors).toBe(count);
  });
  it("rechaza un sesgo que no representa un desplazamiento por canal", () => {
    const count = tf.memory().numTensors;
    const node = fixture([1, 2]);
    expect(() => execute(node)).toThrow("BiasAdd requiere");
    tf.dispose(node.inputs);
    expect(tf.memory().numTensors).toBe(count);
  });
  it("rechaza operaciones desconocidas y libera intermedios al fallar", () => {
    const count = tf.memory().numTensors;
    const node = fixture([2]);
    node.attrs.fused_ops = ["BiasAdd", "Unknown"];
    expect(() => execute(node)).toThrow("Operación fusionada no soportada");
    tf.dispose(node.inputs);
    expect(tf.memory().numTensors).toBe(count);
  });
});
