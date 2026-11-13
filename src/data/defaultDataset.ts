import raw from "../../materials/借款人意外伤害保险_融合语义树.json?raw";
import contract from "../../materials/中国人民财产保险股份有限公司借款人意外伤害保险条款.md?raw";
import { examples } from "../cases/examples";
import { attachContract } from "./contractSource";
import { importDataset } from "./importDataset";
import manifest from "./generated/manifest.json";
const graphFilename = "借款人意外伤害保险_融合语义树.json";
export const defaultContract = {
  filename: "中国人民财产保险股份有限公司借款人意外伤害保险条款.md",
  text: contract,
  sha256: manifest.contract_sha256,
};

export const defaultDataset = {
  ...attachContract(
    importDataset(raw, graphFilename, "borrower-2022"),
    defaultContract,
    manifest.graph_sha256,
  ),
  examples,
  builtin: true,
};
