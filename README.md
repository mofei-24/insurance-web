# 保险条款语义工作台

基于 React、TypeScript、Vite 和 React Flow 的保险条款浏览与案例验证项目。

## 功能

- 条款目录、节点检索、语义流程图与原文依据联动。
- 完整语义树、责任总览、阶段详情与计算依赖查看。
- 合成案例验证、可收纳执行轨迹、事实试算与结果对比。
- 可调整、可收起的侧栏与窄屏布局。
- 浅绿色和黑金主题切换。
- 可拖动、隐藏和恢复的条款问答机器人。
- 基于正式保险条款及离线向量的问答检索。

## 启动

安装 Node.js 22.12+，在项目根目录运行。

```sh
npm ci
npm run dev
```

浏览器访问 http://127.0.0.1:5177/ 。Windows 也可以双击 `start.cmd`，或执行 `.\start.ps1`。

## 条款问答配置

复制 `.env.example` 为 `.env.local`，填写自己的 `DASHSCOPE_API_KEY` 后重启服务。回答模型默认使用 `qwen-plus`，可通过 `RAG_CHAT_MODEL` 修改。

问题和匹配的条款证据会发送到配置的模型服务。请在问答中避免提交个人信息。

## 检查与构建

```sh
npm test
npm run build
npm run preview
```

`dist` 为静态页面构建结果。条款问答需要通过项目的 Vite 开发或预览服务提供 `/api/rag/chat` 接口。

可通过 `npm run report` 重新生成合成案例回归报告。浏览器检查脚本需要使用者设置 `PLAYWRIGHT_MODULE` 和 `INSURANCE_BROWSER`，分别指向自己的 Playwright 模块和浏览器可执行文件。

## 数据与目录

- `src/` 存放前端、语义图和合成案例求值逻辑。
- `server/rag.ts` 提供问答服务与向量检索。
- `materials/` 存放保险条款与语义树源材料。
- `卖保险/卖保险/data/` 包含 35 份正式条款、849 条文本与对应向量。
- `tests/` 和 `scripts/` 提供校验与回归检查。

该发布副本排除了产品需求资料、本机环境配置、个人路径、运行记录和数据库快照。案例使用合成数据，预期结果待业务审核。第三方资料的权利说明见 `卖保险/卖保险/NOTICE.md`。
