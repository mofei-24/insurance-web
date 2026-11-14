# 保险条款问答数据

包含 35 份正式保险条款和 849 条记录，使用 text-embedding-v4、1024 维 float32、L2 归一化向量。

records.jsonl 的第 i 行与 vectors.npy 的第 i 个向量对应，按 chunk_id 升序排列。manifest.json 包含文件摘要、大小及数据计数。

安装 requirements-data.txt 中的依赖后，可以运行 python tools/verify_data.py 校验数据。需要 Milvus 时可使用 tools/build_milvus.py 从本数据重新建立数据库。

此发布副本仅提供正式条款，产品需求资料及数据库快照已排除。来源与权利说明见 NOTICE.md。
