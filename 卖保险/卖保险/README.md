# 卖保险

保险资料向量数据集，提供可直接打开的 Milvus Lite 数据库，以及通用的 NumPy＋JSONL 导出。使用方可以自行决定用途和上层系统。

## 数据概况

| 项目 | 内容 |
|---|---|
| 数据版本 | `2026.10.28` |
| 来源文档 | 36 份，包含主险及附加险 |
| 向量记录 | 854 条，对应 569 个父块 |
| 正式条款 | 35 份文档、849 条向量，`document_type="policy_terms"` |
| 产品需求 | 1 份文档、5 条向量，`document_type="product_requirements"` |
| Embedding 模型 | `text-embedding-v4` |
| 向量格式 | 1024 维、`float32`、L2 归一化 |
| 距离度量 | `COSINE` |
| Milvus 集合名 | `insurance_vectors` |

## 目录

```text
卖保险/
├── README.md
├── NOTICE.md
├── requirements.txt
├── requirements-data.txt
├── data/
│   ├── manifest.json
│   ├── documents.json
│   ├── records.jsonl
│   └── vectors.npy
├── database/
│   └── insurance_vectors.db/   # Milvus Lite 3.2.2 数据目录，整体保留
├── docs/
│   ├── DATA_CATALOG.md
│   └── SCHEMA.md
└── tools/
    ├── verify_data.py
    └── build_milvus.py
```

`data/` 是可移植的数据导出；`database/` 是用这些数据建立的数据库快照。

## 安装与校验

要求 **Python 3.11 或更新版本**。以下命令均在项目根目录执行，建议使用独立 Python 环境。

```bash
python -m pip install -r requirements.txt
python tools/verify_data.py
```

依赖固定为 `numpy==2.3.5`、`pymilvus==3.0.2`、`milvus-lite==3.2.2`

只使用 NumPy＋JSONL 时，只需安装 NumPy：

```bash
python -m pip install numpy==2.3.5
python tools/verify_data.py
```

## 方式一：直接读取通用数据

`records.jsonl` 每行是一条记录，不含向量数组。`records[i]` 对应 `vectors[i]`，`i` 从 0 开始，即 JSONL 物理第 `i+1` 行。两者按 `chunk_id` 升序排列，必须一起保留；不要只调整其中一个文件的顺序。

```python
import json
from pathlib import Path

import numpy as np

data_dir = Path("data")
with (data_dir / "records.jsonl").open(encoding="utf-8") as file:
    records = [json.loads(line) for line in file]

vectors = np.load(data_dir / "vectors.npy", mmap_mode="r", allow_pickle=False)
assert len(records) == vectors.shape[0]

record = records[0]
vector = vectors[0]
print(record["chunk_id"])
print(record["text"][:200])
print(vector.shape)  # (1024,)
```

此方式不依赖 Milvus。使用方可将文本、元数据和向量导入其他存储系统。

### 记录字段

| 字段 | 含义 |
|---|---|
| `chunk_id` | 当前向量化片段的唯一编号，Milvus 主键 |
| `text` | 与向量对应的原始嵌入文本 |
| `title` | 片段主题标签 |
| `product_id` | 来源文档编号，与 `metadata.doc_id` 相同 |
| `source_file` | 来源文件名 |
| `embedding_model` | `text-embedding-v4` |
| `metadata` | 来源、页码、父块、资料边界、质量及向量溯源信息 |

完整字段定义与 Milvus schema 见 [SCHEMA.md](docs/SCHEMA.md)。

常用元数据包括：

- `document_type`：正式条款或产品需求。
- `company`、`product_name`：原资料中的保险公司与产品名称。
- `source_sha256`、`source_pages`、`page_basis` / `source_page_basis`：来源哈希及页码依据。
- `parent_chunk_id`、`parent_context`：所属父块编号及当前可提供的父上下文。
- `context_status`、`context_note`：父上下文的完整性状态和说明。
- `embedding_text_sha256`：嵌入文本哈希。
- `vector_sha256`：对应向量的小端 `float32` 字节哈希。

## 方式二：打开预建 Milvus Lite 数据库

数据库采用 **Milvus Lite 3.2.2 的目录存储格式**。`insurance_vectors.db` 是整个目录，不能只复制其中某个文件，也不是 SQLite 单文件。

下面先复制快照到 `runtime/`，再使用标准 PyMilvus SDK 读取集合统计和一条已知编号的记录：

```python
import json
import shutil
from pathlib import Path

from pymilvus import MilvusClient

source = Path("database/insurance_vectors.db")
target = Path("runtime/insurance.db")
if not source.is_dir():
    raise FileNotFoundError("请确认已完整下载 database/insurance_vectors.db 目录")

target.parent.mkdir(parents=True, exist_ok=True)
if not target.exists():
    shutil.copytree(source, target)

with Path("data/records.jsonl").open(encoding="utf-8") as file:
    chunk_id = json.loads(next(file))["chunk_id"]

client = MilvusClient(uri=str(target))
try:
    name = "insurance_vectors"
    if not client.has_collection(collection_name=name):
        raise RuntimeError("数据库中没有 insurance_vectors 集合")
    client.load_collection(collection_name=name)
    print(client.get_collection_stats(collection_name=name))
    rows = client.get(
        collection_name=name,
        ids=[chunk_id],
        output_fields=["chunk_id", "text", "metadata", "vector"],
    )
    print(rows[0]["chunk_id"])
finally:
    client.close()
```

同一份本地数据库目录应由一个进程打开。需要多个进程或多台机器访问时，使用下面的导入方式接入自己的 Milvus 服务。

## 从通用数据重建或迁移

不使用预建快照时，可以从 `data/` 建立新的本地数据库：

```bash
python tools/build_milvus.py --uri runtime/insurance.db --collection insurance_vectors
```

导入到已有的远端 Milvus 服务时，将地址替换为使用方自己的服务地址：

```bash
python tools/build_milvus.py --uri "https://your-milvus-endpoint" --collection insurance_vectors
```

远端需要认证时，在本机环境变量中配置 `MILVUS_TOKEN`。工具只从环境变量读取认证信息，不从项目文件读取，也不接收包含用户名、密码或令牌的 URI。远端服务端和 PyMilvus SDK 应使用兼容版本；本项目的实际验证环境是本地 Milvus Lite。

导入工具会先校验通用数据，新建 `FLAT/COSINE` 集合，导入后逐条比对文本、元数据和向量。目标集合已有相同完整数据时只核验；已有部分数据或不同数据时停止，不执行删除、覆盖或追加。此时应由使用方选择新的空集合名。

Milvus Lite 3.2.2 使用新的存储引擎，旧版 Lite 的数据库文件不能直接当作此目录使用。跨存储版本时，应使用 `data/` 重新导入。版本与平台说明参见 [Milvus Lite 3.2.2](https://pypi.org/project/milvus-lite/3.2.2/) 和 [官方项目文档](https://github.com/milvus-io/milvus-lite/blob/main/README.md)。

## 数据使用约定

- **保留模型空间一致性。** 消费方若自行生成需要与这些文档比较的向量，应使用相同的 `text-embedding-v4`、1024 维和 L2 归一化约定；问题文本使用该模型的查询类型 `text_type="query"`。仅维度相同不能证明来自同一向量空间。本项目不生成这些新向量。
- **区分正文与父上下文。** `text` 是嵌入对应的文本；`parent_context` 可能更长，不能把它当成实际嵌入输入。`dependency_embedded` 等原标记已保留。
- **按完整性状态解释父块。** 301 条记录标为 `verified_original_parent`；553 条标为 `body_only_original_parent_unavailable`，其上下文由现有子块正文重建，原始额外依赖未提供，不能视为完整原父条款。
- **保留来源和资料边界。** `source_sha256` 部分经过本机源文件核对，部分来自上游导出声明；模型身份来自原 Embedding 清单。本项目校验文件、文本、向量及映射一致性，不声明任何下游任务的准确率。

发布保留了原始嵌入文本、向量和资料边界，去除了内部批次目录标记 `source_group`、`source_bundle`。项目不附带原始 PDF/DOC、评测题、API 密钥或旧模型测试集合。数据来源与权利说明见 [NOTICE.md](NOTICE.md)。

## 检索评测记录

2026 年 10 月 28 日，使用原系统的检索链路真实运行了 50 道测试题。下表保留**按原标注片段编号统计**的结果：45 道有条款证据的题参与计分，5 道库内无答案题排除出召回指标分母。统计单位为父上下文展开后的必要证据组，对每道计分题计算指标后取宏平均。

| 指标 | 实测结果 |
|---|---:|
| Recall@20 | 85.56% |
| Recall@3 | 81.11% |
| Hit@3 | 84.44% |
| 完整证据命中率 | 77.78% |

初召回范围为全部 35 份正式条款、849 条向量，没有按正确文档 `doc_id` 预先过滤。参数为初召回 20 条、千问 `qwen3.7-text-rerank` 重排、重排相关度阈值 `0.5`、父块去重后最终最多保留 3 条。实际调用了 50 次问题 Embedding、50 次重排接口，回答生成调用为 0 次。

Recall 衡量必要证据组的覆盖比例；Hit@3 衡量最终结果是否至少命中一组正确证据；完整证据命中率要求该题所需证据全部找到。预标注仍待人工确认，原编号名单遗漏的等价父块会使该口径低估原文证据覆盖。

这些数值是原系统包含重排与阈值过滤的历史链路测量，不是 Milvus 引擎的内置分数，也不代表回答正确率。纯数据项目不附带该评测程序、50 题文件或原系统的检索与问答功能。
