# 数据格式与向量契约

## 文件和行映射

`data/records.jsonl` 为 UTF-8 JSONL，每行一条记录，不设空行。记录按 `chunk_id` 升序排列。

`data/vectors.npy` 是形状 `(854, 1024)` 的二维 NumPy 数组。`records.jsonl` 第1行对应 `vectors[0]`，第n行对应 `vectors[n-1]`。不要分别排序或过滤这两个文件。

`data/documents.json` 按文档列出来源、向量数、父块数和资料类型。`data/manifest.json` 记录文件大小及SHA256、模型、维度、排序方式和数量。

## 标量字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `chunk_id` | string | 向量记录唯一ID，保留原父块/子块编号 |
| `text` | string | 与该向量对应的精确输入文本，保留原有产品锚点与正文 |
| `title` | string | 整理主题标签，不能作为原文条款标题的替代 |
| `product_id` | string | 来源文档ID，与`metadata.doc_id`相同 |
| `source_file` | string | 原始来源文件名，不包含本机绝对路径 |
| `embedding_model` | string | 固定为`text-embedding-v4` |
| `metadata` | object | 来源、父块上下文、资料边界、模型及质量信息 |

Milvus中还保存`vector`字段，类型为1024维`FLOAT_VECTOR`。在JSONL中该字段由NPY文件的对应行提供，避免重复存储浮点文本。

## 重要元数据

| 字段 | 说明 |
|---|---|
| `doc_id` | 来源文档身份 |
| `document_type` | `policy_terms`为正式条款；`product_requirements`为产品需求 |
| `parent_chunk_id` | 父块ID。同一父块可能对应多个向量子块 |
| `sub_index`、`sub_count` | 子块在父块中的顺序与数量 |
| `parent_context` | 现有库提供的父块上下文；是否完整见`context_status` |
| `context_status` | `verified_original_parent`为已恢复原父块（301条）；`body_only_original_parent_unavailable`为基于可用正文还原（553条） |
| `context_note` | 父块内容范围和缺失依赖说明 |
| `dependency_embedded` | 依赖内容是否进入实际向量输入；以每条记录原值为准 |
| `source_pages` | 按各来源页码规则归一后的物理页 |
| `source_page_basis`、`page_basis` | 原PDF或DOC转换PDF等页码依据，不能当印刷页码使用 |
| `source_sha256` | 上游原始来源文件哈希；可核对状态见`source_hash_status` |
| `embedding_text_sha256` | 精确`text`的UTF-8字节SHA256 |
| `parent_context_sha256` | 当前提供的父上下文SHA256 |
| `upstream_parent_sha256` | 上游父块身份哈希，不应与重建父正文哈希混为一谈 |
| `vector_sha256` | 对应向量转为小端float32后，其1024个数值字节的SHA256 |
| `embedding_info`、`artifact_provenance` | 原模型声明和导出文件行映射溯源 |
| 各类`*_note`、`quality_*`、`data_quality_flag` | 原资料边界或质量标记，消费时应保留含义 |

## 数值与语义空间

模型为`text-embedding-v4`，维度1024，float32，已做L2归一化。预建Milvus集合使用`FLAT`索引和`COSINE`度量。

将本数据接入其他系统时，应保持文本、向量及行映射一起迁移。同为1024维的其他Embedding模型不能直接混入此集合。消费方如自行生成检索向量，应使用同模型、同维度，问题侧使用`text_type=query`；现有库不会代为调用模型。

语料的模型身份来自已有Embedding清单声明，已核对文件、文本、行映射和归一化；本次整理没有重新调用Embedding服务。

## 预建集合

集合名：`insurance_vectors`。主键为`chunk_id`，不自动生成ID，关闭动态字段。

VARCHAR上限以UTF-8字节计：`chunk_id` 512、`text` 65535、`title` 2048、`product_id` 512、`source_file` 2048、`embedding_model` 256；`metadata`为JSON。具体字段由`tools/build_milvus.py`创建。

预建库仅有当前V4主集合，没有旧版Qwen Flash集合，也没有应用层提交清单、用户问题或问答历史。父块正文和相关编号保留现有状态，本次整理不自动补写缺失的原始依赖。
