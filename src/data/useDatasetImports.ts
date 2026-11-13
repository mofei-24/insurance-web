import { useEffect, useState } from "react";
import { defaultContract, defaultDataset } from "./defaultDataset";
import { importDataset } from "./importDataset";
import {
  attachContract,
  declaredContract,
  readContract,
  sha256,
  type ContractFile,
} from "./contractSource";
import { readDatasets, saveDataset } from "./datasetStorage";
import type { Dataset } from "./graph";

interface PendingImport {
  dataset: Dataset;
  filename: string;
  text: string;
  graphHash: string;
  expectedFilename?: string;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "读取文件失败。";

export function useDatasetImports() {
  const [datasets, setDatasets] = useState<Dataset[]>([defaultDataset]);
  const [datasetId, setDatasetId] = useState(defaultDataset.id);
  const [contracts, setContracts] = useState<ContractFile[]>([]);
  const [pending, setPending] = useState<PendingImport>();
  const [restoring, setRestoring] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [storageNotice, setStorageNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const saved = await readDatasets();
        if (cancelled) return;
        const originals = new Map(
          saved.contracts.map((item) => [item.sha256, item]),
        );
        const restored: Dataset[] = [];
        for (const record of saved.datasets) {
          const original = originals.get(record.contractHash);
          if (!original) continue;
          try {
            restored.push(
              attachContract(
                importDataset(record.text, record.filename, record.id),
                { ...original, filename: record.contractFilename },
                record.graphHash,
              ),
            );
          } catch {
            // An invalid record must not prevent opening the other datasets.
          }
        }
        setContracts(saved.contracts);
        setDatasets([defaultDataset, ...restored]);
        if (restored.length !== saved.datasets.length) {
          setStorageNotice("部分本地语义树无法恢复，请重新导入相关文件。");
        }
      } catch {
        if (!cancelled) setStorageNotice("无法读取浏览器中的本地导入记录。");
      } finally {
        if (!cancelled) setRestoring(false);
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  async function finishImport(draft: PendingImport, original: ContractFile) {
    const { dataset, filename, text, graphHash } = draft;
    const imported = attachContract(dataset, original, graphHash);
    try {
      await saveDataset(
        {
          id: imported.id,
          filename,
          text,
          graphHash,
          contractHash: original.sha256,
          contractFilename: original.filename,
        },
        original,
      );
    } catch {
      setStorageNotice("本次关联仅在当前页面保留，浏览器未能保存文件。");
    }
    setContracts((previous) => [
      ...previous.filter((item) => item.sha256 !== original.sha256),
      original,
    ]);
    setDatasets((previous) => [...previous, imported]);
    setDatasetId(imported.id);
    setPending(undefined);
  }

  async function loadFile(file: File) {
    setImporting(true);
    setPending(undefined);
    setError("");
    try {
      const bytes = await file.arrayBuffer();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const graphHash = await sha256(bytes);
      const dataset = importDataset(
        text,
        file.name,
        `local-${crypto.randomUUID()}`,
      );
      const expected = declaredContract(dataset.graph);
      const draft = {
        dataset,
        filename: file.name,
        text,
        graphHash,
        expectedFilename: expected.filename,
      };
      setPending(draft);
      if (expected.sha256) {
        const bundled = {
          ...defaultContract,
          sha256: await sha256(new TextEncoder().encode(defaultContract.text)),
        };
        const candidates = [bundled, ...contracts];
        const original = candidates.find(
          (item) => item.sha256 === expected.sha256,
        );
        if (original) await finishImport(draft, original);
        else if (
          candidates.some((item) => item.filename === expected.filename)
        ) {
          setError(
            "本地同名文件与 JSON 声明的原文版本不一致，请选择对应的 MD。",
          );
        }
      }
    } catch (error) {
      setError(`无法导入「${file.name}」。${errorMessage(error)}`);
    } finally {
      setImporting(false);
    }
  }

  async function loadOriginal(file: File) {
    if (!pending) return;
    setImporting(true);
    setError("");
    try {
      await finishImport(pending, await readContract(file));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setImporting(false);
    }
  }

  return {
    datasets,
    dataset: datasets.find((item) => item.id === datasetId) ?? defaultDataset,
    selectDataset: (id: string) => {
      setDatasetId(id);
      if (!pending && !importing) setError("");
    },
    loadFile,
    loadOriginal,
    cancelImport: () => {
      setPending(undefined);
      setError("");
    },
    pending,
    importing,
    restoring,
    error,
    storageNotice,
  };
}
