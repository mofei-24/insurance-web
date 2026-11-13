import type { Dataset } from "./graph";
import type { Graph } from "./types";
import { validateGraph } from "./validate";
import { axaExamplesForGraph } from "../cases/axaExamples";

export interface ContractFile {
  filename: string;
  text: string;
  sha256: string;
}

export function declaredContract(graph: Graph) {
  const source = graph.provenance?.business_source;
  const filename = [source?.file, graph.document?.source_file]
    .find((value) => typeof value === "string" && value.trim())
    ?.trim();
  const hash = source?.sha256;
  if (
    hash !== undefined &&
    (typeof hash !== "string" || !/^[a-f0-9]{64}$/i.test(hash))
  ) {
    throw new Error("JSON 声明的条款 SHA-256 格式有误。");
  }
  return { filename, sha256: hash?.toLowerCase() };
}

export async function sha256(bytes: BufferSource) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("请通过本机地址或 HTTPS 打开工作台，以校验原文文件。");
  }
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function readContract(file: File): Promise<ContractFile> {
  const bytes = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error("无法读取条款原文，请选择 UTF-8 编码的 Markdown 文件。");
  }
  if (!text.trim()) throw new Error("条款原文为空。");
  return { filename: file.name, text, sha256: await sha256(bytes) };
}

export function attachContract(
  dataset: Dataset,
  original: ContractFile,
  graphHash: string,
): Dataset {
  const expected = declaredContract(dataset.graph);
  if (expected.sha256 && expected.sha256 !== original.sha256) {
    throw new Error(
      `「${original.filename}」与 JSON 声明的原文版本不一致，请选择对应的 MD。`,
    );
  }
  const contract = original.text.replace(/^\uFEFF/, "");
  const validation = validateGraph(dataset.graph, contract);
  if (!validation.valid) {
    throw new Error(
      `无法关联「${original.filename}」。${validation.errors[0]}，请核对原文或 JSON 中的行号与摘录。`,
    );
  }
  return {
    ...dataset,
    examples: dataset.examples.length
      ? dataset.examples
      : axaExamplesForGraph(graphHash),
    contract,
    contractSource: {
      filename: original.filename,
      sha256: original.sha256,
      matchedByHash: !!expected.sha256,
    },
    hashes: { graph_sha256: graphHash, contract_sha256: original.sha256 },
    validation,
  };
}
