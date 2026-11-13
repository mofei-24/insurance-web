import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { validateGraph } from "../src/data/validate";
import type { Graph } from "../src/data/types";
const graphFile = readFileSync(
  new URL("../materials/借款人意外伤害保险_融合语义树.json", import.meta.url),
);
const textFile = readFileSync(
  new URL(
    "../materials/中国人民财产保险股份有限公司借款人意外伤害保险条款.md",
    import.meta.url,
  ),
);
const result = validateGraph(
  JSON.parse(graphFile.toString("utf8").replace(/^\uFEFF/, "")) as Graph,
  textFile.toString("utf8"),
);
const manifest = {
  ...result,
  schema_version: "insurance_semantic_graph/fusion-1.0",
  graph_sha256: createHash("sha256").update(graphFile).digest("hex"),
  contract_sha256: createHash("sha256").update(textFile).digest("hex"),
};
mkdirSync(new URL("../src/data/generated/", import.meta.url), {
  recursive: true,
});
writeFileSync(
  new URL("../src/data/generated/manifest.json", import.meta.url),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest, null, 2));
if (!result.valid) process.exitCode = 1;
