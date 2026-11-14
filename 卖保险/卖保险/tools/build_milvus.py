"""把已校验的离线向量导入新的 Milvus 集合；不生成向量、不提供检索接口。"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

import numpy as np

from verify_data import DIMENSION, MODEL, SCALAR_FIELDS, STRING_LIMITS, load_dataset


class ImportValidationError(ValueError):
    pass


def validate_uri(uri):
    if not isinstance(uri, str) or not uri.strip() or uri != uri.strip():
        raise ImportValidationError('请提供有效数据库路径或 URI。')
    if '://' in uri:
        parsed = urlsplit(uri)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ImportValidationError('远程 URI 必须为不含凭据的 http/https 地址；认证只使用 MILVUS_TOKEN 环境变量。')
    elif Path(uri).suffix != '.db':
        raise ImportValidationError('本机 Milvus Lite 路径必须以 .db 结尾。')
    return uri


def _verify_schema(client, name, DataType):
    info = client.describe_collection(collection_name=name)
    fields = {f['name']: f for f in info['fields']}
    if set(fields) != set(SCALAR_FIELDS) | {'vector'} or info.get('auto_id') or info.get('enable_dynamic_field'):
        raise ImportValidationError('现有集合 schema 与项目不一致；没有覆盖或删除数据。')
    for field, length in STRING_LIMITS.items():
        definition = fields[field]
        if (int(definition['type']) != int(DataType.VARCHAR)
                or int(definition.get('params', {}).get('max_length', 0)) != length
                or bool(definition.get('is_primary')) != (field == 'chunk_id')):
            raise ImportValidationError('现有集合字段不兼容：' + field)
    if int(fields['metadata']['type']) != int(DataType.JSON):
        raise ImportValidationError('metadata 不是 JSON 类型。')
    vector = fields['vector']
    if int(vector['type']) != int(DataType.FLOAT_VECTOR) or int(vector.get('params', {}).get('dim', 0)) != DIMENSION:
        raise ImportValidationError('现有集合向量类型或维度不一致。')
    required_properties = {'insurance.model': MODEL, 'insurance.dimension': str(DIMENSION),
                           'insurance.schema_version': '1'}
    properties = info.get('properties', {})
    if any(str(properties.get(k)) != v for k, v in required_properties.items()):
        raise ImportValidationError('现有集合缺少本数据集的模型契约，或已绑定其他模型。')
    indexes = [client.describe_index(collection_name=name, index_name=index)
               for index in client.list_indexes(collection_name=name)]
    match = next((i for i in indexes if i.get('field_name') == 'vector'), None)
    if not match or match.get('index_type') != 'FLAT' or match.get('metric_type') != 'COSINE':
        raise ImportValidationError('现有集合必须使用 FLAT/COSINE 向量索引。')


def _ids(client, name):
    result = []
    iterator = client.query_iterator(collection_name=name, filter='',
                                     output_fields=['chunk_id'], batch_size=512)
    try:
        while True:
            rows = iterator.next()
            if not rows:
                break
            result.extend(r['chunk_id'] for r in rows)
    finally:
        iterator.close()
    if len(result) != len(set(result)):
        raise ImportValidationError('数据库返回了重复主键。')
    return set(result)


def _verify_rows(client, name, dataset):
    expected_ids = {r['chunk_id'] for r in dataset.records}
    if _ids(client, name) != expected_ids:
        raise ImportValidationError('现有集合不是完整的同一份数据。请使用新的空集合名；本工具不会删除、覆盖或补写已有非空集合。')
    for start in range(0, len(dataset.records), 128):
        expected = dataset.records[start:start + 128]
        actual = client.get(collection_name=name, ids=[r['chunk_id'] for r in expected],
                            output_fields=list(SCALAR_FIELDS) + ['vector'])
        by_id = {r['chunk_id']: r for r in actual}
        if len(by_id) != len(expected):
            raise ImportValidationError('导入后逐条读回数量不匹配。')
        for offset, row in enumerate(expected):
            value = by_id.get(row['chunk_id'])
            if value is None or any(value.get(k) != row[k] for k in SCALAR_FIELDS):
                raise ImportValidationError('数据库正文或元数据与项目不一致。')
            vector = np.asarray(value.get('vector', []))
            if vector.shape != (DIMENSION,) or not np.allclose(vector, dataset.vectors[start + offset], rtol=0, atol=1e-7):
                raise ImportValidationError('数据库向量与项目不一致。')


def import_dataset(dataset, uri, collection='insurance_vectors', *, client_factory=None, data_type=None):
    uri = validate_uri(uri)
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,254}', collection):
        raise ImportValidationError('集合名只允许英文字母、数字和下划线，且不能以数字开头。')
    if client_factory is None or data_type is None:
        # 离线校验不需要 pymilvus；仅导入数据库时才加载它。
        from pymilvus import DataType, MilvusClient
        client_factory = client_factory or MilvusClient
        data_type = data_type or DataType
    connection = {'uri': uri}
    token = os.environ.get('MILVUS_TOKEN')
    if token and '://' in uri:
        connection['token'] = token
    client = client_factory(**connection)
    created = False
    try:
        if not client.has_collection(collection_name=collection):
            schema = client.create_schema(auto_id=False, enable_dynamic_field=False)
            for field, length in STRING_LIMITS.items():
                schema.add_field(field, data_type.VARCHAR, max_length=length,
                                 is_primary=(field == 'chunk_id'))
            schema.add_field('metadata', data_type.JSON)
            schema.add_field('vector', data_type.FLOAT_VECTOR, dim=DIMENSION)
            indexes = client.prepare_index_params()
            indexes.add_index(field_name='vector', index_type='FLAT', metric_type='COSINE')
            client.create_collection(collection_name=collection, schema=schema,
                                     index_params=indexes, consistency_level='Strong',
                                     properties={'insurance.model': MODEL,
                                                 'insurance.dimension': str(DIMENSION),
                                                 'insurance.schema_version': '1'})
            created = True
        _verify_schema(client, collection, data_type)
        client.load_collection(collection_name=collection)
        current_ids = _ids(client, collection)
        if current_ids:
            _verify_rows(client, collection, dataset)
            return {'status': 'already_verified', 'collection': collection,
                    'records': len(dataset.records), 'model': MODEL, 'dimension': DIMENSION}
        for start in range(0, len(dataset.records), 128):
            rows = [dict(row, vector=dataset.vectors[start + i].tolist())
                    for i, row in enumerate(dataset.records[start:start + 128])]
            client.insert(collection_name=collection, data=rows)
        client.flush(collection_name=collection)
        _verify_rows(client, collection, dataset)
        return {'status': 'created_and_verified' if created else 'imported_and_verified',
                'collection': collection, 'records': len(dataset.records),
                'model': MODEL, 'dimension': DIMENSION}
    finally:
        client.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'data',
                        help='默认使用项目自带 data。')
    parser.add_argument('--uri', default=str(Path(__file__).resolve().parents[1] / 'runtime' / 'insurance.db'),
                        help='本机 .db 路径或远程 http/https Milvus URI。')
    parser.add_argument('--collection', default='insurance_vectors', help='目标集合名。')
    args = parser.parse_args()
    try:
        uri = validate_uri(args.uri)
        if '://' not in uri:
            Path(uri).resolve().parent.mkdir(parents=True, exist_ok=True)
        report = import_dataset(load_dataset(args.data_dir), uri, args.collection)
        print(json.dumps(report, ensure_ascii=False, indent=2))
    except Exception as exc:
        message = str(exc)
        token = os.environ.get('MILVUS_TOKEN')
        if token:
            message = message.replace(token, '【认证已隐藏】')
        parser.exit(1, '导入未完成：' + message[:1000] + '\n')


if __name__ == '__main__':
    main()
