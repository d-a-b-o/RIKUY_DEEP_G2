import type * as TensorFlow from "@tensorflow/tfjs-core";
import type { registerOp } from "@tensorflow/tfjs-converter";

export const GRAPH_COMPATIBILITY = "unfused-conv2d-nhwc-v1";

/** Match the approved notebook: WASM cannot fuse BiasAdd with shape [1,1,1,C]. */
export function registerGraphCompatibility(
  tf: typeof TensorFlow,
  converter: { registerOp: typeof registerOp },
) {
  converter.registerOp("_FusedConv2D", (node) => tf.tidy(() => {
    const attrs = node.attrs;
    const format = String(attrs.data_format ?? "NHWC").toUpperCase();
    const padding = String(attrs.padding ?? "VALID").toLowerCase();
    const strides = (attrs.strides ?? [1, 1, 1, 1]) as number[];
    const dilations = (attrs.dilations ?? [1, 1, 1, 1]) as number[];
    if (
      format !== "NHWC" || (padding !== "same" && padding !== "valid") ||
      ![strides, dilations].every((values) => Array.isArray(values) &&
        values.length === 4 && values.every((v) => Number.isInteger(v) && v > 0) &&
        values[0] === 1 && values[3] === 1) ||
      node.inputs[0]?.rank !== 4 || node.inputs[1]?.rank !== 4
    ) throw new Error("Configuración _FusedConv2D no compatible con NHWC.");

    let value: TensorFlow.Tensor = tf.conv2d(
      node.inputs[0] as TensorFlow.Tensor4D,
      node.inputs[1] as TensorFlow.Tensor4D,
      [strides[1], strides[2]], padding, "NHWC", [dilations[1], dilations[2]],
    );
    let argument = 2;
    const operations = attrs.fused_ops ?? [];
    if (!Array.isArray(operations) || !operations.every((op) => typeof op === "string")) {
      throw new Error("Lista de operaciones fusionadas inválida.");
    }
    const nextInput = () => {
      const tensor = node.inputs[argument++];
      if (!tensor) throw new Error("Argumentos incompletos en _FusedConv2D.");
      return tensor;
    };
    for (const operation of operations as string[]) {
      switch (operation.toLowerCase()) {
        case "biasadd": {
          const bias = nextInput();
          const channels = value.shape[3];
          if (!((bias.rank === 1 && bias.shape[0] === channels) ||
            (bias.rank === 4 && bias.shape.slice(0, 3).every((d) => d === 1) && bias.shape[3] === channels))) {
            throw new Error("BiasAdd requiere [C] o [1,1,1,C].");
          }
          value = tf.add(value, bias);
          break;
        }
        case "add": value = tf.add(value, nextInput()); break;
        case "relu": value = tf.relu(value); break;
        case "relu6": value = tf.clipByValue(value, 0, 6); break;
        case "elu": value = tf.elu(value); break;
        case "leakyrelu": {
          const alpha = attrs.leakyrelu_alpha ?? 0.2;
          if (typeof alpha !== "number" || !Number.isFinite(alpha)) throw new Error("Alpha inválido.");
          value = tf.leakyRelu(value, alpha);
          break;
        }
        case "prelu": value = tf.prelu(value, nextInput()); break;
        default: throw new Error(`Operación fusionada no soportada: ${operation}`);
      }
    }
    if (argument !== node.inputs.length || (attrs.num_args != null && argument - 2 !== attrs.num_args)) {
      throw new Error("Argumentos adicionales o incompletos en _FusedConv2D.");
    }
    return value;
  }));
}
