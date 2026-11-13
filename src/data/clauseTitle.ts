import type { Dataset } from "./graph";

// 这些名字只表示「某份原文」，不含可识别的条款名称，不能拿来当条款标题。
const genericFile = /^(原始条款|条款原文|原文|contract|source)(\.md|\.markdown|\.txt)?$/i;

function identifiableFile(name?: string) {
  const value = name?.trim();
  return value && !genericFile.test(value) ? value : undefined;
}

/**
 * 可用于命名的条款原文 MD 文件名。优先取工作台已关联并校验过的原文，
 * 其次取 JSON `provenance` / `document` 中声明的来源文件。
 */
export function clauseFileOf(dataset: Dataset): string | undefined {
  return (
    identifiableFile(dataset.contractSource?.filename) ??
    identifiableFile(dataset.graph.provenance?.business_source?.file) ??
    identifiableFile(dataset.graph.document?.source_file)
  );
}

/**
 * 左上角条款选择框显示的名称，与条款原文 MD 文件对应：
 * 有可识别的文件名时，去掉扩展名和「7. 」这类编号前缀；
 * 否则退回 JSON 中的保险公司 + 产品 + 版本，最后才用语义树标题。
 */
export function clauseTitleOf(dataset: Dataset): string {
  const file = clauseFileOf(dataset);
  if (file) {
    return file
      .replace(/\.(md|markdown|txt)$/i, "")
      .replace(/^\d+\s*[.、_-]\s*/, "")
      .trim();
  }
  const doc = dataset.graph.document;
  if (doc?.product) {
    const name = `${doc.insurer ?? ""}${doc.product}`;
    return doc.edition ? `${name}（${doc.edition}）` : name;
  }
  return dataset.label;
}

/** 展开选择框时展示的完整条款信息。 */
export function clauseDetailOf(dataset: Dataset) {
  return {
    name: clauseTitleOf(dataset),
    file: dataset.contractSource?.filename?.trim() || clauseFileOf(dataset),
    tree: dataset.filename?.trim() ?? "",
    linked: !!dataset.contract,
  };
}
