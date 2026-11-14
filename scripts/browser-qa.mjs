import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { preview } from "vite";
// Reuse the bundled browser driver and the already installed Edge. Never download browsers.
const driver = process.env.PLAYWRIGHT_MODULE;
const browser = process.env.INSURANCE_BROWSER;
if (!driver || !browser || !existsSync(driver) || !existsSync(browser))
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
  mkdtempSync(path.join(temp, "browser-qa-")),
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
async function clickGraphTool(name) {
  await page.locator(".graph-tools > summary").click();
  await page.getByRole("button", { name, exact: true }).click();
}
async function chooseCaseCard(title) {
  const card = page.locator(".case-item").filter({ hasText: title });
  const group = card.locator("..");
  if (!(await group.evaluate((element) => element.open)))
    await group.locator(":scope > summary").click();
  await card.click();
}
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
  const stageSelector = page.getByRole("combobox", { name: "选择阶段详情" });
  const stageOptions = () =>
    stageSelector
      .locator("option[value]:not([value=''])")
      .evaluateAll((options) =>
        options.map((option) => [option.value, option.textContent]),
      );
  const overviewSnapshot = async () => {
    await page.locator(".flow-card.stage").first().waitFor();
    return {
      stages: await stageOptions(),
      cards: await page
        .locator(".flow-card.stage .node-main")
        .allTextContents()
        .then((cards) => cards.map((card) => card.replace("当前节点", ""))),
      edges: await page
        .locator(".react-flow__edge")
        .evaluateAll((edges) =>
          edges.map((edge) => [edge.dataset.id, edge.textContent]),
        ),
    };
  };
  const defaultOverview = await overviewSnapshot();
  const stageIds = defaultOverview.stages.map(([id]) => id);
  checks.push("1366×768 首屏责任总览四阶段可见");
  assert.equal(await page.locator(".detail-panel").isVisible(), false);
  assert.equal(
    await page.getByText("让每一步判断，都有据可循。", { exact: true }).count(),
    0,
  );
  assert.equal((await page.locator(".topbar").boundingBox()).height, 64);
  assert.ok((await measureCanvas("1366默认首页")).height_ratio >= 0.75);
  assert.equal(await page.locator(".graph-legend").count(), 0);
  assert.equal(await page.locator(".react-flow__minimap").count(), 0);
  await clickGraphTool("定位缩略图");
  await clickGraphTool("图例说明");
  await page.locator(".graph-tools > summary").click();
  await page.locator(".layout-settings > summary").click();
  await page.getByRole("button", { name: "三栏布局", exact: true }).click();
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
        h.height === 50 &&
        parseFloat(h.font) >= 16,
    ),
  );
  checks.push("64px顶栏、50px等高栏头、辅助图例默认收纳及显式三栏布局");
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
  await clickGraphTool("放大画布");
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
  await clickGraphTool("退出放大");
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".sidebar").isVisible(), true);
  assert.equal(await page.locator(".detail-panel").isVisible(), true);
  assertSameView(originalView, await readView());
  await page.getByRole("button", { name: "收起检索栏", exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".sidebar").isVisible(), false);
  assertSameView(originalView, await readView());
  await page.getByRole("button", { name: "展开左侧栏", exact: true }).click();
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
  await page
    .locator(".detail-disclosure")
    .filter({ hasText: "计算来源与核实状态" })
    .locator(":scope > summary")
    .click();
  await page.getByRole("button", { name: "在图中查看", exact: true }).click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator(".flow-card.dependency").count(), 3);
  checks.push("节点搜索定位与D04一跳依赖");

  await clickGraphTool("查看计算来源");
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
  const firstCanvas = await page.locator(".graph-shell").boundingBox();
  const firstCards = await page.locator(".flow-card").evaluateAll((cards) =>
    cards.map((card) => {
      const { left, right, top, bottom } = card.getBoundingClientRect();
      return { left, right, top, bottom };
    }),
  );
  assert.ok(
    firstCards.every(
      ({ left, right, top, bottom }) =>
        left >= firstCanvas.x &&
        right <= firstCanvas.x + firstCanvas.width &&
        top >= firstCanvas.y &&
        bottom <= firstCanvas.y + firstCanvas.height,
    ),
    "首次进入完整图时，所有默认可见节点均在画布内",
  );
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
  await clickGraphTool("本节点出口");
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
  await panCanvas(0, canvas.y + canvas.height - 72 - (d04InView.y - 105));
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
  await clickGraphTool("本节点出口");
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
  await page.locator(".react-flow__controls-zoomin").click();
  await page.waitForTimeout(300);
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
  for (const stage of stageIds) {
    await page
      .getByRole("combobox", { name: "选择阶段详情" })
      .selectOption(stage);
    await page.waitForTimeout(450);
    await inspectDiagram(`${stage}子树文字无重叠、节点内容无裁切`);
    if (stage === "responsibility:RESP_DISABILITY") {
      const entry = await page
        .locator('.react-flow__node[data-id="A01"]')
        .boundingBox();
      assert.ok(entry.width > 220, "子树首次进入以可读比例展示入口");
    }
    if (stage === "responsibility:RESP_DISABILITY")
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
  await chooseCaseCard("已付伤残金20万元");
  await page.locator(".result-strip").filter({ hasText: "800,000" }).waitFor();
  assert.equal(
    await page.locator(".trace-panel details").evaluate((el) => el.open),
    false,
  );
  assert.equal(await page.locator(".trace-steps").isVisible(), false);
  await page.locator(".trace-heading summary").click();
  await page
    .locator(".trace-steps button")
    .filter({ hasText: "意外身故保险金" })
    .click();
  assert.equal(
    await page.locator(".trace-panel details").evaluate((el) => el.open),
    false,
  );
  assert.match(
    await page.locator(".current-step-label").innerText(),
    /意外身故保险金/,
  );
  checks.push("执行轨迹默认收纳，选择步骤后自动关闭并更新当前步骤");
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
  assert.equal(await page.locator(".calculation-lines").isVisible(), false);
  await page
    .locator(".detail-disclosure")
    .filter({ hasText: "本步计算明细" })
    .locator(":scope > summary")
    .click();
  assert.match(await page.locator(".calculation-lines").innerText(), /800000/);
  assert.doesNotMatch(
    (await page.locator(".trace-steps").textContent()) ?? "",
    /\b(?:ordinary|declared)\s*·/,
  );
  checks.push("历史20万元扣减与逐步计算明细");
  assert.equal(
    await page
      .locator('.react-flow__node[data-id="D04"] .calculation-tag')
      .innerText(),
    "金额计算",
  );
  const stablePositions = await mainNodePositions(),
    stableView = await readView();
  await clickGraphTool("查看计算来源");
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
    "rgb(36, 76, 59)",
  );
  assert.equal(
    await page
      .locator('.react-flow__edge[data-id="D02::true::D04"] .case-highlight')
      .count(),
    1,
  );
  assert.equal(
    await page
      .locator('.react-flow__node[data-id="D04"] .flow-card')
      .evaluate((e) => getComputedStyle(e).borderTopColor),
    "rgb(48, 51, 45)",
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
  checks.push("案例路径有淡黄底划线，金额节点保留账单粗边，未走分支淡化");

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

  await page.locator(".result-menu > summary").click();
  await page.getByRole("button", { name: "对比案例", exact: true }).click();
  await page.getByRole("combobox", { name: "选择对照案例" }).selectOption("A");
  assert.match(await page.locator(".comparison-body").innerText(), /金额改变/);
  await page.getByRole("button", { name: "关闭对照" }).click();
  checks.push("路径相同但金额不同的两例对照");
  await chooseCaseCard("账本完整性未知");
  assert.match(await page.locator(".result-strip").innerText(), /需补充资料/);
  assert.match(await page.locator(".result-strip").innerText(), /待核定/);
  await page.locator(".trace-heading summary").click();
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
  await clickGraphTool("本节点出口");
  assert.match(
    await exitList.locator("button.hit").innerText(),
    /需补材料.*本例命中/s,
  );
  await clickGraphTool("本节点出口");
  await chosenStop.click();
  assert.equal(
    await page.locator(".node-title code").innerText(),
    "OUT_AMOUNT_PENDING",
  );
  checks.push("账本未知时金额待核并保留责任");
  await chooseCaseCard("跳伞运动免责");
  await page.locator(".trace-heading summary").click();
  await page
    .locator(".trace-steps button")
    .filter({ hasText: "核查16项免责" })
    .click();
  const exclusionHit = page.locator(
    '.react-flow__node[data-id="X01"] .stop-list button.hit',
  );
  await exclusionHit.waitFor();
  assert.equal(await exclusionHit.count(), 1);
  assert.equal(await exclusionHit.innerText(), "存在适用免责");
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
  await chooseCaseCard("宣告死亡 · 未生还");
  const steps = (await page.locator(".trace-steps").textContent()) ?? "";
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
  await page.locator(".topbar-actions .utility-menu > summary").click();
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
  for (const id of stageIds) {
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
  await page
    .locator(
      '.react-flow__node[data-id="responsibility:RESP_DEATH"] .node-main',
    )
    .click();
  await page.locator('.react-flow__node[data-id="D04"] .node-main').waitFor();
  await page.getByRole("button", { name: "适应视图", exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.react-flow__node[data-id="D04"] .node-main').click();
  assert.equal(await page.locator(".node-title code").innerText(), "D04");
  assert.ok(await page.locator(".node-title").isVisible());
  checks.push("390px窄屏切换、总览自适应与页面无横向溢出");
  await page.setViewportSize({ width: 1366, height: 768 });
  const treeSelector = page.getByRole("combobox", { name: "切换语义树" });
  const importInput = page.locator('.topbar input[type="file"]');
  const browseOriginal = page.getByRole("button", {
    name: "阅读条款全文",
    exact: true,
  });
  const closeOriginal = page.getByRole("button", {
    name: "关闭原文",
    exact: true,
  });
  const sourceDialog = page.getByRole("dialog", { name: "保险条款原文" });
  const materials = path.join(root, "materials");
  const borrowerImports = [];
  for (const [index, filename] of [
    "借款人意外伤害保险_语义树.json",
    "借款人意外伤害保险_融合语义树.json",
  ].entries()) {
    await importInput.setInputFiles(path.join(materials, filename));
    await treeSelector
      .locator("option")
      .nth(index + 1)
      .waitFor({ state: "attached" });
    assert.match(await treeSelector.inputValue(), /^local-/);
    borrowerImports.push(await treeSelector.inputValue());
    assert.deepEqual(await overviewSnapshot(), defaultOverview);
    assert.equal(
      await page.getByRole("region", { name: "待关联条款原文" }).count(),
      0,
    );
    await browseOriginal.click();
    assert.match(await sourceDialog.innerText(), /51 处已核验来源/);
    await closeOriginal.click();
    await stageSelector.selectOption("responsibility:RESP_DEATH");
    await page.locator('.react-flow__node[data-id="REFUND_CALC"]').waitFor();
    await page
      .getByRole("button", { name: "节点索引 53", exact: true })
      .click();
    await page.getByRole("textbox", { name: "搜索条款或节点" }).fill("X01");
    await page.locator(".node-index").filter({ hasText: "X01" }).click();
    assert.match(
      await page.locator(".detail-scroll").innerText(),
      /引用规则.*17/s,
    );
    assert.equal(await page.locator(".detail-scroll .exclusion").count(), 17);
    await page.getByRole("textbox", { name: "搜索条款或节点" }).fill("D04");
    await page.locator(".node-index").filter({ hasText: "D04" }).click();
    assert.match(
      await page.locator(".calculation-intro").innerText(),
      /取较小值.*已付伤残金/s,
    );
  }
  checks.push(
    "两版借款人 JSON 自动匹配原文，并与内置树共享阶段、总览、返还路径、计算和规则详情",
  );

  const customQuote = "第二棵树的专属条款正文。";
  const customMarkdown = Buffer.from(
    "前言也应进入目录。\r\n\r\n# 合同总则\r\n\r\n## 特别约定\r\n\r\n" +
      customQuote +
      "\r\n",
  );
  const expectedHash = createHash("sha256")
    .update(customMarkdown)
    .digest("hex");
  const importedSource = {
    id: "ALT_SOURCE",
    article: "6.1",
    heading_path: ["6.1"],
    locator: {
      line_start: 7,
      line_end: 7,
      quote: customQuote,
    },
  };
  const importedGraph = {
    schema_version: graph.schema_version,
    title: "自定义语义树",
    document: { source_file: "custom.md" },
    provenance: {
      business_source: { file: "custom.md", sha256: expectedHash },
    },
    entry_id: "ALT_ENTRY",
    nodes: [
      {
        id: "ALT_ENTRY",
        kind: "entry",
        label: "自定义入口",
        next: "ALT_DECISION",
        source_refs: [],
      },
      {
        id: "ALT_DECISION",
        kind: "decision",
        label: "自定义判断",
        condition: { literal: true },
        routes: { true: "ALT_PASS", false: "ALT_FAIL" },
        source_refs: ["ALT_SOURCE"],
      },
      {
        id: "ALT_PASS",
        kind: "outcome",
        label: "自定义结果",
        code: "LOCAL_PASS",
        source_refs: ["ALT_SOURCE"],
      },
      {
        id: "ALT_FAIL",
        kind: "outcome",
        label: "不满足条件",
        code: "LOCAL_FAIL",
        source_refs: ["ALT_SOURCE"],
      },
    ],
    sources: [importedSource],
    responsibilities: [
      {
        id: "ALT_RESP",
        name: "自定义责任",
        entry_node: "ALT_DECISION",
        node_ids: ["ALT_DECISION"],
        source_refs: ["ALT_SOURCE"],
      },
    ],
    facts: [],
    rules: [],
    shared_rules: [],
    amount_rules: [],
    responsibility_relations: [],
    unresolved: [],
  };
  const importFile = (name, value) =>
    importInput.setInputFiles({
      name,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value)),
    });
  const importMarkdown = (name, buffer) =>
    page.locator('input[aria-label="条款原文文件"]').setInputFiles({
      name,
      mimeType: "text/markdown",
      buffer,
    });
  const pending = page.getByRole("region", { name: "待关联条款原文" });
  await importFile("custom.json", importedGraph);
  await pending.waitFor();
  assert.match(await pending.innerText(), /custom\.md/);
  const previousTree = await treeSelector.inputValue();
  await importMarkdown("custom.md", Buffer.from("不同版本"));
  await page.getByRole("alert").filter({ hasText: "原文版本不一致" }).waitFor();
  assert.equal(await treeSelector.inputValue(), previousTree);
  await importMarkdown("renamed.md", customMarkdown);
  const altNode = page.locator(
    '.react-flow__node[data-id="ALT_DECISION"] .node-main',
  );
  await page
    .locator('.react-flow__node[data-id="responsibility:ALT_RESP"] .node-main')
    .waitFor();
  const customTree = await treeSelector.inputValue();
  assert.notEqual(customTree, previousTree);
  assert.ok(
    await page
      .getByRole("button", { name: "验证案例", exact: true })
      .isDisabled(),
  );
  assert.equal(
    await page.locator('.react-flow__node[data-id="D04"]').count(),
    0,
  );
  assert.match(
    await page.getByRole("combobox", { name: "选择阶段详情" }).innerText(),
    /自定义责任/,
  );
  assert.match(
    await page.getByRole("tree").innerText(),
    /前言也应进入目录|合同总则/,
  );
  await page.getByRole("button", { name: "责任总览", exact: true }).click();
  await page
    .locator('.react-flow__node[data-id="responsibility:ALT_RESP"] .node-main')
    .click();
  await altNode.click();
  await page.locator(".evidence-preview .source-card").click();
  assert.match(await sourceDialog.innerText(), /renamed\.md/);
  assert.match(
    await sourceDialog.locator('[data-line="7"].highlight').innerText(),
    new RegExp(customQuote),
  );
  await sourceDialog.getByRole("button", { name: /ALT_DECISION/ }).click();
  await sourceDialog.waitFor({ state: "hidden" });
  await importFile("invalid.json", {
    ...importedGraph,
    entry_id: "MISSING_ENTRY",
  });
  await page.locator(".dataset-error").waitFor();
  assert.match(await page.locator(".dataset-error").innerText(), /入口不存在/);
  assert.equal(await treeSelector.inputValue(), customTree);
  await importFile("bad-location.json", {
    ...importedGraph,
    sources: [
      {
        ...importedSource,
        locator: { ...importedSource.locator, line_start: 5, line_end: 5 },
      },
    ],
  });
  await page.getByRole("alert").filter({ hasText: "原文定位失配" }).waitFor();
  assert.equal(await treeSelector.inputValue(), customTree);
  await page.getByRole("button", { name: "取消导入", exact: true }).click();
  await page.reload();
  for (const id of borrowerImports) {
    await treeSelector.selectOption(id);
    assert.deepEqual(await overviewSnapshot(), defaultOverview);
  }
  await treeSelector.selectOption(customTree);
  await browseOriginal.click();
  assert.match(await sourceDialog.innerText(), /renamed\.md/);
  await closeOriginal.click();
  const restoredCount = await treeSelector.locator("option").count();
  await importFile("another.json", { ...importedGraph, title: "另一棵语义树" });
  await treeSelector
    .locator("option")
    .nth(restoredCount)
    .waitFor({ state: "attached" });
  assert.equal(
    await page.getByRole("alert").count(),
    0,
    await page.getByRole("alert").allTextContents(),
  );
  assert.equal(await pending.count(), 0, await pending.allTextContents());
  // 选择框只显示条款原文 MD 名称，不拼语义树标题、版本号或内置/导入状态
  assert.doesNotMatch(await treeSelector.innerText(), /另一棵语义树/);
  assert.doesNotMatch(
    await treeSelector.innerText(),
    /insurance_semantic_graph|fusion-1\.0|内置|已导入|导入 1\.0/,
    "条款选择框不应包含语义树版本与导入状态",
  );
  assert.match(await treeSelector.innerText(), /renamed/);
  assert.notEqual(await treeSelector.inputValue(), customTree);
  await browseOriginal.click();
  assert.match(await sourceDialog.innerText(), new RegExp(customQuote));
  await closeOriginal.click();
  await importFile("without-hash.json", {
    ...importedGraph,
    provenance: undefined,
  });
  await pending.waitFor();
  await importMarkdown("renamed.md", customMarkdown);
  await treeSelector
    .locator("option")
    .nth(restoredCount + 1)
    .waitFor({ state: "attached" });
  await page.locator(".topbar-actions .utility-menu > summary").click();
  await page.getByRole("button", { name: "数据与验证", exact: true }).click();
  await page.getByText(/来源版本未由哈希确认/).waitFor();
  await page.getByRole("button", { name: "关闭报告", exact: true }).click();
  await treeSelector.selectOption("borrower-2022");
  await page.getByRole("button", { name: "验证案例", exact: true }).click();
  assert.match(await page.locator(".result-strip").innerText(), /普通意外身故/);
  assert.equal(
    await page.locator('.react-flow__node[data-id="ALT_DECISION"]').count(),
    0,
  );
  checks.push(
    "手选改名 MD、版本与定位拦截、目录和双向定位、责任总览、刷新恢复及复用原文",
  );
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
