"""只读校验项目内的文本、向量和文档清单，不连接数据库或模型接口。"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re

import numpy as np

MODEL = 'text-embedding-v4'
DIMENSION = 1024
SCALAR_FIELDS = ('chunk_id', 'text', 'title', 'product_id', 'source_file',
                 'embedding_model', 'metadata')
STRING_LIMITS = {'chunk_id': 512, 'text': 65535, 'title': 2048,
                 'product_id': 512, 'source_file': 2048, 'embedding_model': 256}
DATA_FILES = ('records.jsonl', 'vectors.npy', 'documents.json')
HEX = re.compile(r'[a-f0-9]{64}')


class DataValidationError(ValueError):
    """文件未通过约定的数据校验。"""


def _digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def _unique_object(pairs):
    value = {}
    for key, child in pairs:
        if key in value:
            raise DataValidationError('JSON 对象包含重复字段。')
        value[key] = child
    return value


def _json(text):
    def reject_constant(_):
        raise DataValidationError('JSON 中出现非有限数值。')
    try:
        return json.loads(text, object_pairs_hook=_unique_object,
                          parse_constant=reject_constant)
    except (json.JSONDecodeError, UnicodeError) as exc:
        raise DataValidationError('文件不是有效 UTF-8 JSON。') from exc


def _read_json(path):
    try:
        return _json(Path(path).read_text(encoding='utf-8-sig'))
    except OSError as exc:
        raise DataValidationError(f'无法读取 {Path(path).name}。') from exc


def _integer(value, label, *, positive=False):
    if type(value) is not int or value < (1 if positive else 0):
        raise DataValidationError(label + ' 必须是有效整数。')
    return value


@dataclass
class Dataset:
    directory: Path
    manifest: dict
    records: list[dict]
    vectors: np.ndarray
    documents: list[dict]

    def report(self):
        kinds = Counter(r['metadata']['document_type'] for r in self.records)
        parents = {(r['product_id'], r['metadata']['parent_chunk_id'])
                   for r in self.records}
        return {'status': 'verified', 'records': len(self.records),
                'documents': len(self.documents), 'parents': len(parents),
                'dimension': DIMENSION, 'model': MODEL, 'dtype': 'float32',
                'normalization': 'l2', 'metric_type': 'COSINE',
                'record_order': 'chunk_id_ascending',
                'policy_terms_records': kinds['policy_terms'],
                'product_requirements_records': kinds['product_requirements']}


def load_dataset(directory):
    """返回按 chunk_id 排序、与 NPY 每一行严格对应的已校验数据。"""
    directory = Path(directory).resolve()
    manifest = _read_json(directory / 'manifest.json')
    if not isinstance(manifest, dict) or manifest.get('schema_version') != 1:
        raise DataValidationError('不支持的 manifest schema_version。')
    expected_embedding = {'model': MODEL, 'dimension': DIMENSION, 'dtype': 'float32',
                          'normalization': 'l2', 'metric_type': 'COSINE'}
    embedding = manifest.get('embedding')
    if not isinstance(embedding, dict) or any(embedding.get(k) != v for k, v in expected_embedding.items()):
        raise DataValidationError('模型、维度、数值格式、归一化或距离度量不符合此数据集约定。')
    if manifest.get('record_order') != 'chunk_id_ascending':
        raise DataValidationError('manifest 必须明确 record_order=chunk_id_ascending。')
    counts, files = manifest.get('counts'), manifest.get('files')
    if not isinstance(counts, dict) or not isinstance(files, dict):
        raise DataValidationError('manifest 缺少 counts 或 files。')
    for key in ('records', 'documents', 'policy_terms_records', 'product_requirements_records'):
        _integer(counts.get(key), 'counts.' + key)
    for name in DATA_FILES:
        info = files.get(name)
        if not isinstance(info, dict) or not HEX.fullmatch(info.get('sha256', '')):
            raise DataValidationError(name + ' 缺少有效 SHA256。')
        _integer(info.get('bytes'), name + '.bytes')
        path = directory / name
        if not path.is_file() or path.stat().st_size != info['bytes'] or _digest(path) != info['sha256']:
            raise DataValidationError(name + ' 的文件大小或 SHA256 不匹配。')

    try:
        lines = (directory / 'records.jsonl').read_text(encoding='utf-8-sig').splitlines()
    except (OSError, UnicodeError) as exc:
        raise DataValidationError('无法读取 records.jsonl。') from exc
    records = []
    for line_no, line in enumerate(lines, 1):
        if not line.strip():
            raise DataValidationError(f'records.jsonl 第 {line_no} 行为空，不能保持行号与向量映射。')
        row = _json(line)
        if not isinstance(row, dict) or set(row) != set(SCALAR_FIELDS):
            raise DataValidationError(f'records.jsonl 第 {line_no} 行字段不符合 schema。')
        for key, maximum in STRING_LIMITS.items():
            value = row[key]
            if not isinstance(value, str) or len(value.encode('utf-8')) > maximum:
                raise DataValidationError(f'第 {line_no} 行的 {key} 类型或 UTF-8 字节数不符合 schema。')
        if not row['chunk_id'] or not row['product_id'] or not row['text'].strip() or row['embedding_model'] != MODEL:
            raise DataValidationError(f'第 {line_no} 行缺少身份、正文或使用了不同的 Embedding 模型。')
        meta = row['metadata']
        if not isinstance(meta, dict) or meta.get('doc_id') != row['product_id']:
            raise DataValidationError(f'第 {line_no} 行 metadata.doc_id 与 product_id 不一致。')
        if not isinstance(meta.get('parent_chunk_id'), str) or not meta['parent_chunk_id']:
            raise DataValidationError(f'第 {line_no} 行缺少父块编号。')
        if not HEX.fullmatch(meta.get('source_sha256', '')):
            raise DataValidationError(f'第 {line_no} 行缺少源文件 SHA256。')
        if meta.get('embedding_text_sha256') != hashlib.sha256(row['text'].encode('utf-8')).hexdigest():
            raise DataValidationError(f'第 {line_no} 行正文 SHA256 不匹配。')
        if meta.get('document_type') not in ('policy_terms', 'product_requirements'):
            raise DataValidationError(f'第 {line_no} 行 document_type 不符合数据分类约定。')
        pages = meta.get('source_pages')
        if not isinstance(pages, list) or any(type(p) is not int or p < 1 for p in pages):
            raise DataValidationError(f'第 {line_no} 行页码无效。')
        try:
            serialized = json.dumps(meta, ensure_ascii=False, allow_nan=False)
        except (ValueError, TypeError) as exc:
            raise DataValidationError(f'第 {line_no} 行 metadata 不是有限 JSON。') from exc
        if len(serialized.encode('utf-8')) > 65536:
            raise DataValidationError(f'第 {line_no} 行 metadata 超过 Milvus JSON 字节限制。')
        records.append(row)
    ids = [r['chunk_id'] for r in records]
    if len(set(ids)) != len(ids) or ids != sorted(ids):
        raise DataValidationError('chunk_id 重复或没有按升序排列。')
    if len(records) != counts['records']:
        raise DataValidationError('正文行数与 manifest 不一致。')
    try:
        vectors = np.load(directory / 'vectors.npy', mmap_mode='r', allow_pickle=False)
    except (ValueError, OSError) as exc:
        raise DataValidationError('无法安全读取 vectors.npy。') from exc
    if vectors.dtype.kind != 'f' or vectors.dtype.itemsize != 4 or vectors.shape != (len(records), DIMENSION):
        raise DataValidationError('向量必须是与正文行数一致的二维 float32、1024 维矩阵。')
    if not np.isfinite(vectors).all():
        raise DataValidationError('向量含 NaN 或无穷大。')
    norms = np.linalg.norm(np.asarray(vectors, dtype=np.float64), axis=1)
    if not np.allclose(norms, 1.0, rtol=1e-5, atol=1e-5):
        raise DataValidationError('向量不是 L2 归一化的非零向量。')
    for index, row in enumerate(records):
        expected = row['metadata'].get('vector_sha256')
        if expected is not None:
            actual = hashlib.sha256(np.asarray(vectors[index], dtype='<f4').tobytes()).hexdigest()
            if not isinstance(expected, str) or not HEX.fullmatch(expected) or actual != expected:
                raise DataValidationError(f'第 {index + 1} 行向量 SHA256 不匹配，NPY 与 JSONL 行映射可能已被改变。')

    documents = _read_json(directory / 'documents.json')
    if not isinstance(documents, list) or len(documents) != counts['documents']:
        raise DataValidationError('documents.json 文档数不匹配。')
    rows_by_doc = defaultdict(list)
    for row in records:
        rows_by_doc[row['product_id']].append(row)
    doc_ids = []
    for doc in documents:
        if not isinstance(doc, dict) or not isinstance(doc.get('doc_id'), str) or not doc['doc_id']:
            raise DataValidationError('文档清单缺少有效 doc_id。')
        doc_id = doc['doc_id']; doc_ids.append(doc_id)
        rows = rows_by_doc.get(doc_id, [])
        count = doc.get('record_count', doc.get('chunk_count'))
        _integer(count, 'documents.record_count', positive=True)
        if len(rows) != count:
            raise DataValidationError('文档 ' + doc_id + ' 的记录数不匹配。')
        if not HEX.fullmatch(doc.get('source_sha256', '')) or any(r['metadata']['source_sha256'] != doc['source_sha256'] for r in rows):
            raise DataValidationError('文档 ' + doc_id + ' 的源文件 SHA256 不一致。')
        if doc.get('document_type') not in ('policy_terms', 'product_requirements') or any(r['metadata']['document_type'] != doc['document_type'] for r in rows):
            raise DataValidationError('文档 ' + doc_id + ' 的类型不一致。')
        if 'parent_count' in doc:
            if doc['parent_count'] != len({r['metadata']['parent_chunk_id'] for r in rows}):
                raise DataValidationError('文档 ' + doc_id + ' 的父块数不一致。')
    if len(set(doc_ids)) != len(doc_ids) or set(doc_ids) != set(rows_by_doc):
        raise DataValidationError('文档清单重复、缺少或多出文档。')
    kinds = Counter(r['metadata']['document_type'] for r in records)
    if any(kinds[k] != counts[k + '_records'] for k in ('policy_terms', 'product_requirements')):
        raise DataValidationError('文档类型的向量数量与 manifest 不一致。')
    dataset = Dataset(directory, manifest, records, vectors, documents)
    if 'parents' in counts and dataset.report()['parents'] != counts['parents']:
        raise DataValidationError('父块总数与 manifest 不一致。')
    return dataset


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'data',
                        help='项目数据目录；默认使用项目自带 data。')
    args = parser.parse_args()
    try:
        print(json.dumps(load_dataset(args.data_dir).report(), ensure_ascii=False, indent=2))
    except (DataValidationError, OSError) as exc:
        parser.exit(1, '校验失败：' + str(exc) + '\n')


if __name__ == '__main__':
    main()
