import type { ContractFile } from "./contractSource";

export interface StoredDataset {
  id: string;
  filename: string;
  text: string;
  graphHash: string;
  contractHash: string;
  contractFilename: string;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("insurance-semantic-workbench", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("contracts", { keyPath: "sha256" });
      request.result.createObjectStore("datasets", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readDatasets() {
  const db = await openDatabase();
  try {
    return await new Promise<{
      datasets: StoredDataset[];
      contracts: ContractFile[];
    }>((resolve, reject) => {
      const transaction = db.transaction(["datasets", "contracts"], "readonly");
      const datasets = transaction.objectStore("datasets").getAll();
      const contracts = transaction.objectStore("contracts").getAll();
      transaction.oncomplete = () =>
        resolve({
          datasets: datasets.result,
          contracts: contracts.result,
        });
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function saveDataset(
  dataset: StoredDataset,
  contract: ContractFile,
) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        ["datasets", "contracts"],
        "readwrite",
      );
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.objectStore("contracts").put(contract);
      transaction.objectStore("datasets").put(dataset);
    });
  } finally {
    db.close();
  }
}
