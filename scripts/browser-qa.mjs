import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { preview } from "vite";
// Reuse the bundled browser driver and the already installed Edge. Never download browsers.
const driver =
  process.env.PLAYWRIGHT_MODULE ??
  "C:/Users/asus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const browser =
  process.env.INSURANCE_BROWSER ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
if (!existsSync(driver) || !existsSync(browser))
  throw new Error(
    "缺少既有浏览器或测试驱动；请设置 PLAYWRIGHT_MODULE 与 INSURANCE_BROWSER，脚本不会下载安装。",
  );
const { chromium } = await import(pathToFileURL(driver).href);
const root = process.cwd();
const temp = path.join(root, ".cache", "tmp");
mkdirSync(temp, { recursive: true });
mkdirSync(path.join(root, "test-results"), { recursive: true });
const server = process.env.INSURANCE_URL
  ? null
  : await preview({
      preview: { host: "127.0.0.1", port: 4173, strictPort: true },
    });
const context = await chromium.launchPersistentContext(
  path.join(root, ".cache", "browser-profile"),
  {
    executablePath: browser,
    headless: true,
    viewport: { width: 1366, height: 768 },
    env: { ...process.env, TEMP: temp, TMP: temp },
    args: [
      "--disable-background-networking",
      "--no-first-run",
      "--disable-default-apps",
    ],
  },
);
const page = await context.newPage();
const errors = [];
const checks = [];
const layoutMetrics = [];
async function measureCanvas(label) {
  const bounds = await page.locator(".graph-shell").boundingBox();
  const viewport = page.viewportSize();
  const measurement = {
    label,
    viewport,
    canvas: bounds,
    height_ratio: bounds.height / viewport.height,
    area_ratio:
      (bounds.width * bounds.height) / (viewport.width * viewport.height),
  };
  layoutMetrics.push(measurement);
  return measurement;
}
async function readView() {
  return page.locator(".graph-shell").evaluate((element) => {
    const transform = new DOMMatrixReadOnly(
      getComputedStyle(element.querySelector(".react-flow__viewport"))
        .transform,
    );
    return {
      centerX: (element.clientWidth / 2 - transform.e) / transform.a,
      centerY: (element.clientHeight / 2 - transform.f) / transform.a,
      zoom: transform.a,
    };
  });
}
function assertSameView(expected, actual) {
  assert.ok(
    Math.abs(expected.centerX - actual.centerX) < 0.75,
    `画布中心X变化 ${JSON.stringify({ expected, actual })}`,
  );
  assert.ok(
    Math.abs(expected.centerY - actual.centerY) < 0.75,
    `画布中心Y变化 ${JSON.stringify({ expected, actual })}`,
  );
  assert.ok(Math.abs(expected.zoom - actual.zoom) < 0.005, "画布缩放应保留");
}
async function panCanvas(dx, dy) {
  const bounds = await page.locator(".graph-shell").boundingBox();
  await page.mouse.move(bounds.x + 25, bounds.y + 25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 25 + dx, bounds.y + 25 + dy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}
async function inspectDiagram(label) {
  await page.locator(".layout-status").waitFor({ state: "hidden" });
  const issues = await page.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const hit = (a, b) =>
      a.x + 0.25 < b.x + b.width &&
      a.x + a.width - 0.25 > b.x &&
      a.y + 0.25 < b.y + b.height &&
      a.y + a.height - 0.25 > b.y;
    const cards = [...document.querySelectorAll(".flow-card")];
    const blocks = [...cards, ...document.querySelectorAll(".phase-title")].map(
      (el) => ({ ...rect(el), id: el.closest("[data-id]")?.dataset.id }),
    );
    const labels = [
      ...document.querySelectorAll(".react-flow__edge-textwrapper"),
    ].map((e) => ({ text: e.textContent, rect: rect(e) }));
    const issues = [];
    labels.forEach((l, i) => {
      if (blocks.some((b) => hit(l.rect, b)))
        issues.push(
          `文字覆盖节点/标题：${JSON.stringify({ label: l, blocks: blocks.filter((b) => hit(l.rect, b)) })}`,
        );
      if (labels.slice(0, i).some((b) => hit(l.rect, b.rect)))
        issues.push(`文字互相覆盖：${l.text}`);
    });
    for (const card of cards) {
      const r = rect(card);
      for (const child of card.querySelectorAll(
        "strong,.node-amount,.stop-list button",
      )) {
        const c = rect(child);
        if (
          c.x < r.x - 0.5 ||
          c.y < r.y - 0.5 ||
          c.x + c.width > r.x + r.width + 0.5 ||
          c.y + c.height > r.y + r.height + 0.5
        )
          issues.push(`内容超出卡片：${child.textContent}`);
      }
    }
    return issues;
  });
  assert.deepEqual(issues, [], label);
  checks.push(label);
}
async function mainNodePositions() {
  return page
    .locator(".react-flow__node-card")
    .evaluateAll((nodes) =>
      nodes
        .filter((n) => !n.dataset.id.startsWith("dependency:"))
        .map((n) => [n.dataset.id, n.style.transform]),
    );
}
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(process.env.INSURANCE_URL ?? "http://127.0.0.1:4173/", {
    waitUntil: "networkidle",
  });
  await page.locator(".react-flow__node").first().waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({
    path: path.join(root, "test-results", "desktop-overview.png"),
  });
  assert.equal(await page.locator(".flow-card.stage").count(), 4);
  checks.push("1366×768 首屏责任总览四阶段可见");
  assert.equal(await page.locator(".detail-panel").isVisible(), false);
  assert.equal(
    await page.getByText("让每一步判断，都有据可循。", { exact: true }).count(),
    0,
  );
  assert.equal((await page.locator(".topbar").boundingBox()).height, 52);
  assert.ok((await measureCanvas("1366默认首页")).height_ratio >= 0.75);
  await page.getByRole("button", { name: "展开依据栏", exact: true }).click();
  await page.waitForTimeout(250);
  assert.ok((await measureCanvas("1366双侧栏")).height_ratio >= 0.75);
  const headings = await page
    .locator(".panel-heading")
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.offsetParent !== null)
        .map((element) => ({
          top: element.getBoundingClientRect().top,
          height: element.getBoundingClientRect().height,
          font: getComputedStyle(element.querySelector("h2")).fontSize,
        })),
    );
  assert.equal(headings.length, 3);
  assert.ok(
    headings.every(
      (h) =>
        h.top === headings[0].top &&
        h.height === 48 &&
        parseFloat(h.font) >= 16,
    ),
  );
  checks.push("单行52px顶栏、三分区等高栏头与默认依据栏收起");
  await page.setViewportSize({ width: 1883, height: 915 });
  await page.waitForTimeout(250);
  assert.ok((await measureCanvas("1883双侧栏")).area_ratio >= 0.5);
  await page.screenshot({
    path: path.join(root, "test-results", "wide-workspace.png"),
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(250);
  await page.locator(".react-flow__controls-zoomin").click();
  await page.waitForTimeout(250);
  await panCanvas(40, 25);
  const originalView = await readView();
  const originalWidth = (await page.locator(".graph-shell").boundingBox())
    .width;
  await page.getByRole("button", { name: "放大画布", exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".sidebar").isVisible(), false);
  assert.equal(await page.locator(".detail-panel").isVisible(), false);
  assert.ok(
    (await page.locator(".graph-shell").boundingBox()).width >
      originalWidth + 400,
  );
  assertSameView(originalView, await readView());
  await page.locator(".react-flow__controls-zoomout").click();
  await page.waitForTimeout(250);
  await panCanvas(25, 15);
  await page.screenshot({
    path: path.join(root, "test-results", "expanded-canvas.png"),
  });
  await page.getByRole("button", { name: "退出放大", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".sidebar").isVisible(), true);
  assert.equal(await page.locator(".detail-panel").isVisible(), true);
  assertSameView(originalView, await readView());
  await page.getByRole("button", { name: "收起检索栏", exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".sidebar").isVisible(), false);
  assertSameView(originalView, await readView());
  await page.getByRole("button", { name: "展开检索栏", exact: true }).click();
  await page.waitForTimeout(200);
  assertSameView(originalView, await readView());
  await page.getByRole("button", { name: "收起依据栏", exact: true }).click();
  checks.push("画布高度超过75%、宽屏双侧栏画布面积超过50%");
  checks.push("两侧栏独立收起、放大后恢复分区及原缩放与看图位置");
  assert.equal(await page.locator(".clause-leaf").count(), 0);
  assert.equal(await page.locator(".clause-folder").count(), 9);
  await page.getByRole("button", { name: "2 保障内容", exact: true }).click();
  await page.getByRole("button", { name: "2.1 保险责任", exact: true }).click();
  await page
    .getByRole("button", { name: "2.1.1 意外身故保险责任", exact: true })
    .click();
  await page
    .locator(".clause-leaf .clause-item")
    .filter({ hasText: "身故前" })
    .click();
  await page.locator(".reverse-node").filter({ hasText: "D04" }).click();
  await page.getByRole("textbox", { name: "搜索条款或节点" }).fill("跳伞");
  assert.ok((await page.locator(".clause-leaf").count()) > 0);
  await page.getByRole("textbox", { name: "搜索条款或节点" }).fill("");
  checks.push(
    "条款目录默认九章收起，逐级到段落/免责分项，检索展开祖先并可反查D04",
  );
  await page.getByRole("button", { name: "节点索引 53", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索条款或节点" }).fill("D04");
  await page.locator(".node-index").filter({ hasText: "D04" }).click();
  await page.waitForTimeout(900);
  assert.match(await page.locator(".node-title").innerText(), /D04/);
  await page.getByRole("button", { name: "在图中查看", exact: true }).click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator(".flow-card.dependency").count(), 3);
  checks.push("节点搜索定位与D04一跳依赖");

  await page.getByRole("button", { name: "查看计算来源", exact: true }).click();
  await page
    .getByRole("button", { name: "查看完整语义树", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".flow-card").length === 37,
  );
  await page.locator(".layout-status").waitFor({ state: "hidden" });
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".phase-group").count(), 0);
  assert.equal(await page.locator(".react-flow .phase-entry").count(), 4);
  assert.equal(await page.locator(".react-flow__minimap-node").count(), 37);
  assert.equal(
    await page.locator('.react-flow__node[data-id="OUT_LOCAL_PASS"]').count(),
    1,
  );
  assert.equal(
    await page.locator('.react-flow__node[data-id="OUT_NEEDS_REVIEW"]').count(),
    0,
  );
  await inspectDiagram("横向完整图节点与分支文字无重叠");
  const pos = (id) =>
    page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  const entry = await pos("ENTRY_INSURANCE"),
    selector = await pos("B01"),
    death = await pos("D01"),
    disability = await pos("A01"),
    payment = await pos("BENEFICIARY");
  assert.ok(entry.width > 190, "首次进入完整图以可读比例从左侧开始");
  assert.ok(entry.x < selector.x && selector.x < death.x);
  assert.ok(
    Math.abs(death.x - disability.x) < 0.01 &&
      Math.abs(death.y - disability.y) > 10,
  );
  assert.ok(payment.x > death.x);
  await page.screenshot({
    path: path.join(root, "test-results", "full-tree-entry.png"),
  });
  const basePositions = await mainNodePositions();
  const d04Thumbnail = await page
    .locator(".react-flow__minimap-node")
    .nth(basePositions.findIndex(([id]) => id === "D04"))
    .boundingBox();
  await page.mouse.click(
    d04Thumbnail.x + d04Thumbnail.width / 2,
    d04Thumbnail.y + d04Thumbnail.height / 2,
  );
  await page.waitForTimeout(250);
  const d04InView = await pos("D04"),
    canvas = await page.locator(".graph-shell").boundingBox();
  assert.ok(
    d04InView.x >= canvas.x &&
      d04InView.x + d04InView.width <= canvas.x + canvas.width,
    "缩略图可跳转到远处节点",
  );
  const baseEdgeCount = await page.locator(".react-flow__edge").count();
  const exitToggle = page.getByRole("button", {
    name: "本节点出口",
    exact: true,
  });
  const exitList = page.getByRole("region", { name: "本节点出口列表" });
  await panCanvas(0, -105);
  const beforeOpening = await readView();
  await exitToggle.click();
  assert.equal(await exitToggle.getAttribute("aria-expanded"), "true");
  assert.equal(await exitList.getAttribute("data-placement"), "below");
  assert.equal(await exitList.getByRole("button").count(), 2);
  assert.match(await exitList.innerText(), /需补材料.*金额待核定/s);
  assert.match(await exitList.innerText(), /需复核.*适用口径需核定/s);
  assert.equal(await page.locator(".react-flow__edge").count(), baseEdgeCount);
  assert.deepEqual(await mainNodePositions(), basePositions);
  assertSameView(beforeOpening, await readView());
  await page.screenshot({
    path: path.join(root, "test-results", "full-tree-local-exits.png"),
  });
  await panCanvas(0, 210);
  assert.equal(await exitList.getAttribute("data-placement"), "above");
  await exitList.getByRole("button", { name: /需补材料/ }).click();
  assert.equal(
    await page.locator(".node-title code").innerText(),
    "OUT_AMOUNT_PENDING",
  );
  assert.equal(
    await page
      .locator('.react-flow__node[data-id="D04"] .node-main')
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "条款依据", exact: true }).click();
  assert.ok(await page.locator(".detail-scroll .source-card").count());
  await page.getByRole("button", { name: "返回 D04", exact: true }).click();
  assert.equal(await page.locator(".node-title code").innerText(), "D04");
  assert.equal(await page.locator(".react-flow__edge").count(), baseEdgeCount);
  const beforeClosing = await readView();
  await exitToggle.click();
  assert.equal(await exitList.count(), 0);
  assertSameView(beforeClosing, await readView());
  assert.equal(await page.locator(".flow-card").count(), 37);
  checks.push(
    "D04出口列表随节点上下翻转，展开收起保持画布，点击可查结果和原文",
  );
  await page.getByRole("button", { name: "适应全图", exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".stop-caption").count(), 0);
  assert.ok(await page.locator(".graph-legend .stop-legend").isVisible());
  await page.screenshot({
    path: path.join(root, "test-results", "full-tree-horizontal.png"),
  });
  checks.push(
    "全图以实际连线连续呈现前提、分流、汇合与主要终点，共用结果按需展开",
  );
  assert.equal(
    await page.locator('.react-flow__node[data-id="A05"]').count(),
    1,
  );
  const savedFullView = await readView();
  await page.locator('.react-flow__node[data-id="A01"] .phase-entry').click();
  await page.waitForTimeout(450);
  assert.ok(
    (await page.locator('.react-flow__node[data-id="A01"]').boundingBox())
      .width > 220,
  );
  await page.getByRole("button", { name: "返回完整图", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".flow-card").length === 37,
  );
  await page.waitForTimeout(300);
  assertSameView(savedFullView, await readView());
  checks.push("阶段入口进入可读子树，返回完整图恢复原看图位置与缩放");

  await page.getByRole("button", { name: "责任总览", exact: true }).click();
  await page
    .getByRole("button", { name: "查看完整语义树", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".flow-card").length >= 37,
  );
  await page.getByRole("button", { name: "适应全图", exact: true }).click();
  await page.waitForTimeout(250);
  for (const stage of ["common", "death", "disability", "payment"]) {
    await page
      .getByRole("combobox", { name: "选择阶段详情" })
      .selectOption(stage);
    await page.waitForTimeout(450);
    await inspectDiagram(`${stage}子树文字无重叠、节点内容无裁切`);
    if (stage === "disability") {
      const entry = await page
        .locator('.react-flow__node[data-id="A01"]')
        .boundingBox();
      assert.ok(entry.width > 220, "子树首次进入以可读比例展示入口");
    }
    if (stage === "disability")
      await page.screenshot({
        path: path.join(root, "test-results", "disability-readable.png"),
      });
  }
  await page
    .getByRole("button", { name: "查看完整语义树", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".flow-card").length === 37,
  );
  await page.locator(".layout-status").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "适应全图", exact: true }).click();
  await page.waitForTimeout(300);
  const graph = JSON.parse(
    readFileSync(
      path.join(root, "materials", "借款人意外伤害保险_融合语义树.json"),
      "utf8",
    ).replace(/^\uFEFF/, ""),
  );
  const quotes = new Map(
    graph.sources.map((source) => [source.id, source.locator.quote]),
  );
  const inlineResults = new Set([
    "OUT_LOCAL_PASS",
    "OUT_REFUND",
    "OUT_NO_REFUND",
  ]);
  for (const node of graph.nodes.filter(
    (n) => n.kind !== "outcome" || inlineResults.has(n.id),
  )) {
    await page
      .locator(`.react-flow__node[data-id="${node.id}"] .node-main`)
      .click();
    assert.equal(await page.locator(".node-title code").innerText(), node.id);
    assert.equal(
      await page.locator(".evidence-preview .source-card p").textContent(),
      quotes.get(node.source_refs[0]),
    );
  }
  await page.locator('.react-flow__node[data-id="D04"] .node-main').click();
  checks.push("全图37个默认节点逐一直接点击，详情和条款摘录与原始引用一致");
  await page
    .getByRole("textbox", { name: "搜索条款或节点" })
    .fill("OUT_NEEDS_REVIEW");
  await page
    .locator(".node-index")
    .filter({ hasText: "OUT_NEEDS_REVIEW" })
    .click();
  await page
    .locator('.react-flow__node[data-id="OUT_NEEDS_REVIEW"] .node-main')
    .waitFor();
  assert.equal(
    await page.locator(".node-title code").innerText(),
    "OUT_NEEDS_REVIEW",
  );
  await page.getByRole("textbox", { name: "搜索条款或节点" }).fill("D04");
  await page.locator(".node-index").filter({ hasText: "D04" }).click();
  assert.equal(await page.locator(".node-title code").innerText(), "D04");
  checks.push("折叠的共用结果仍可按节点检索定位并阅读原文");
  await page.getByRole("button", { name: "责任总览", exact: true }).click();
  checks.push("完整图A05汇合节点唯一，适应全图与放大画布分别可用");
  await page
    .locator(".detail-footer")
    .getByRole("button", { name: "查看条款" })
    .click();
  await page.locator(".document-line.highlight").first().waitFor();
  assert.ok((await page.locator(".reverse-node").count()) > 0);
  await page.locator(".reverse-node").filter({ hasText: "D04" }).click();
  assert.match(await page.locator(".node-title").innerText(), /D04/);
  checks.push("节点到原文与原文反查节点");
  await page.getByRole("textbox", { name: "搜索条款或节点" }).fill("");
  await page.getByRole("button", { name: "验证案例", exact: true }).click();
  await page
    .locator(".result-strip")
    .filter({ hasText: "1,000,000" })
    .waitFor();
  await page
    .locator(".case-item")
    .filter({ hasText: "已付伤残金20万元" })
    .click();
  await page.locator(".result-strip").filter({ hasText: "800,000" }).waitFor();
  await page
    .locator(".trace-steps button")
    .filter({ hasText: "意外身故保险金" })
    .click();
  await page.waitForTimeout(900);
  const center = await page.locator(".center-panel").boundingBox();
  const toolbar = await page.locator(".canvas-toolbar").boundingBox();
  const nav = await page.locator(".trace-nav").boundingBox();
  assert.ok(
    toolbar.y >= center.y && nav.y + nav.height <= center.y + center.height,
  );
  assert.ok(
    (await page.locator('.react-flow__node[data-id="D04"]').boundingBox())
      .width >= 200,
  );
  checks.push("案例工具栏与步骤导航完整可见，当前节点放大可读");
  await page.screenshot({
    path: path.join(root, "test-results", "desktop-calculation.png"),
  });
  assert.match(await page.locator(".calculation-lines").innerText(), /800000/);
  checks.push("历史20万元扣减与逐步计算明细");
  assert.equal(
    await page
      .locator('.react-flow__node[data-id="D04"] .calculation-tag')
      .innerText(),
    "金额计算",
  );
  const stablePositions = await mainNodePositions(),
    stableView = await readView();
  await page.getByRole("button", { name: "查看计算来源", exact: true }).click();
  await page.waitForTimeout(200);
  assert.deepEqual(
    await mainNodePositions(),
    stablePositions,
    "计算来源展开不移动主流程",
  );
  assertSameView(stableView, await readView());
  checks.push("计算来源按需展开，主流程节点与看图位置保持稳定");

  await page
    .getByRole("button", { name: "查看完整语义树", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".flow-card").length >= 37,
  );
  const activeCount = await page.locator(".flow-card.visited").count();
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".react-flow__edge.case-path").length === count,
    activeCount - 1,
  );
  assert.equal(activeCount, await page.locator(".trace-steps button").count());
  assert.equal(
    await page.locator(".react-flow__edge.case-path").count(),
    activeCount - 1,
  );
  const chosenEdge = page.locator(
    '.react-flow__edge[data-id="D02::true::D04"] .react-flow__edge-path',
  );
  assert.equal(
    await chosenEdge.evaluate((e) => getComputedStyle(e).stroke),
    "rgb(37, 99, 235)",
  );
  assert.equal(
    await page
      .locator('.react-flow__node[data-id="D04"] .flow-card')
      .evaluate((e) => getComputedStyle(e).borderTopColor),
    "rgb(195, 105, 19)",
  );
  assert.ok(
    await page
      .locator('.react-flow__node[data-id="A01"] .case-unvisited')
      .count(),
  );
  await page.getByRole("button", { name: "适应全图", exact: true }).click();
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(root, "test-results", "full-tree-case-path.png"),
  });
  checks.push(
    "案例路径边/箭头及节点外圈使用蓝色，金额计算橙色标签保留，未走分支淡化",
  );

  const calculationNode = page.locator(
    '.react-flow__node[data-id="D04"] .node-main',
  );
  assert.equal(await calculationNode.getAttribute("aria-pressed"), "true");
  await calculationNode.click();
  assert.equal(await calculationNode.getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator(".flow-card.selected").count(), 0);
  assert.equal(await page.locator(".detail-panel").isVisible(), false);
  assert.equal(
    await page.locator(".react-flow__edge.case-path").count(),
    activeCount - 1,
  );
  await calculationNode.click();
  assert.equal(await calculationNode.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(".node-title code").innerText(), "D04");
  checks.push("再次点击取消选中并收起详情，案例路径保留，第三次点击可重新选中");

  await page.getByRole("button", { name: "对比案例", exact: true }).click();
  await page.getByRole("combobox", { name: "选择对照案例" }).selectOption("A");
  assert.match(await page.locator(".comparison-body").innerText(), /金额改变/);
  await page.getByRole("button", { name: "关闭对照" }).click();
  checks.push("路径相同但金额不同的两例对照");
  await page
    .locator(".case-item")
    .filter({ hasText: "账本完整性未知" })
    .click();
  assert.match(await page.locator(".result-strip").innerText(), /需补充资料/);
  assert.match(await page.locator(".result-strip").innerText(), /待核定/);
  await page
    .locator(".trace-steps button")
    .filter({ hasText: "意外身故保险金" })
    .click();
  assert.match(
    await page.locator(".detail-scroll").innerText(),
    /局部责任条件通过/,
  );
  const chosenStop = page.locator(
    '.react-flow__node[data-id="D04"] .stop-list button.hit',
  );
  assert.equal(await chosenStop.innerText(), "需补材料");
  assert.match(await chosenStop.getAttribute("aria-label"), /本例命中/);
  assert.match(
    await page
      .locator('.react-flow__node[data-id="D04"] .node-amount')
      .innerText(),
    /金额待核定/,
  );
  assert.equal(
    await page
      .locator('.react-flow__node[data-id="D04"] .calculation-tag')
      .innerText(),
    "金额计算",
  );
  await exitToggle.click();
  assert.match(
    await exitList.locator("button.hit").innerText(),
    /需补材料.*本例命中/s,
  );
  await exitToggle.click();
  await chosenStop.click();
  assert.equal(
    await page.locator(".node-title code").innerText(),
    "OUT_AMOUNT_PENDING",
  );
  checks.push("账本未知时金额待核并保留责任");
  await page.locator(".case-item").filter({ hasText: "跳伞运动免责" }).click();
  await page
    .locator(".trace-steps button")
    .filter({ hasText: "核查16项免责" })
    .click();
  const exclusionHit = page.locator(
    '.react-flow__node[data-id="X01"] .stop-list button.hit',
  );
  await exclusionHit.waitFor();
  assert.equal(await exclusionHit.count(), 1);
  assert.equal(await exclusionHit.innerText(), "命中免责");
  const contrast = await exclusionHit.evaluate((button) => {
    const style = getComputedStyle(button);
    const luminance = (rgb) => {
      const [red, green, blue] = rgb
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map((channel) => {
          const value = Number(channel) / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const colors = [luminance(style.color), luminance(style.backgroundColor)];
    return (Math.max(...colors) + 0.05) / (Math.min(...colors) + 0.05);
  });
  assert.ok(contrast >= 4.5, `命中出口文字对比度不足：${contrast}`);
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(root, "test-results", "case-exclusion-hit.png"),
  });
  checks.push("跳伞案例只突出命中免责出口，关键词保持清晰对比度");
  await page
    .locator(".case-item")
    .filter({ hasText: "宣告死亡 · 未生还" })
    .click();
  const steps = await page.locator(".trace-steps").innerText();
  assert.ok(!steps.includes("普通身故与180日条件"));
  assert.match(steps, /宣告死亡保险金/);
  checks.push("宣告死亡跳过D02");
  await page.keyboard.press("ArrowRight");
  assert.match(await page.locator(".node-title").innerText(), /IDENTITY/);
  checks.push("键盘前后步骤导航");
  await page.getByRole("button", { name: "案例事实", exact: true }).click();
  await page
    .getByRole("combobox", { name: "给付账本完整性" })
    .selectOption("null");
  await page.getByRole("button", { name: "查看试算结果" }).click();
  assert.match(await page.locator(".result-strip").innerText(), /自定义试算/);
  checks.push("修改事实后重新求值并标记自定义");
  await page.getByRole("button", { name: /数据与验证/ }).click();
  assert.match(
    await page.locator(".report-body").innerText(),
    /待业务审核：16/,
  );
  await page.getByRole("button", { name: "关闭报告" }).click();
  checks.push("报告区分开发回归与业务审核");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "流程与步骤", exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  const mobileCanvas = await page.locator(".graph-shell").boundingBox();
  for (const id of ["common", "death", "disability", "payment"]) {
    const card = await page
      .locator(`.react-flow__node[data-id="${id}"]`)
      .boundingBox();
    assert.ok(
      card.x >= mobileCanvas.x - 1 &&
        card.x + card.width <= mobileCanvas.x + mobileCanvas.width + 1,
      "窄屏总览节点应自动适应画布",
    );
  }
  await page.screenshot({
    path: path.join(root, "test-results", "mobile-cases.png"),
  });
  await page.locator('.react-flow__node[data-id="death"] .node-main').click();
  await page.locator('.react-flow__node[data-id="D04"] .node-main').waitFor();
  await page.getByRole("button", { name: "适应视图", exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.react-flow__node[data-id="D04"] .node-main').click();
  assert.equal(await page.locator(".node-title code").innerText(), "D04");
  assert.ok(await page.locator(".node-title").isVisible());
  checks.push("390px窄屏切换、总览自适应与页面无横向溢出");
  assert.deepEqual(errors, []);
  writeFileSync(
    path.join(root, "test-results", "browser-qa.json"),
    JSON.stringify(
      { passed: checks.length, checks, layoutMetrics, errors },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { passed: checks.length, checks, layoutMetrics, errors },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({
    path: path.join(root, "test-results", "browser-failure.png"),
  });
  throw error;
} finally {
  await context.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
