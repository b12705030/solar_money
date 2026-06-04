"""
將 vendors 表中以 base64 data URL 儲存的 logo 遷移至 Cloudflare R2。
執行方式：python -m backend.migrate_logos
"""
from __future__ import annotations

import asyncio
import base64
import os
import uuid

import boto3
from botocore.config import Config
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / '.env')

import asyncpg


def _r2_client():
    return boto3.client(
        's3',
        endpoint_url=f'https://{os.environ["R2_ACCOUNT_ID"]}.r2.cloudflarestorage.com',
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        config=Config(signature_version='s3v4'),
        region_name='auto',
    )


def upload_base64_to_r2(data_url: str, bucket: str, public_url: str) -> str:
    # data:image/png;base64,iVBORw...
    header, b64data = data_url.split(',', 1)
    mime = header.split(';')[0].split(':')[1]  # e.g. image/png
    ext = mime.split('/')[1]                    # e.g. png
    key = f'logos/{uuid.uuid4().hex}.{ext}'
    data = base64.b64decode(b64data)
    _r2_client().put_object(
        Bucket=bucket, Key=key, Body=data, ContentType=mime,
    )
    return f'{public_url.rstrip("/")}/{key}'


async def migrate():
    url = os.environ.get('DATABASE_URL', '')
    if not url:
        raise RuntimeError('DATABASE_URL 未設定')

    bucket     = os.environ['R2_BUCKET_NAME']
    public_url = os.environ['R2_PUBLIC_URL']

    conn = await asyncpg.connect(url)
    try:
        # 遷移廠商 logo
        rows = await conn.fetch(
            "SELECT id, logo_url FROM vendors WHERE logo_url LIKE 'data:%'"
        )
        print(f'[logo] 找到 {len(rows)} 筆需要遷移')
        for row in rows:
            try:
                new_url = upload_base64_to_r2(row['logo_url'], bucket, public_url)
                await conn.execute('UPDATE vendors SET logo_url = $1 WHERE id = $2', new_url, row['id'])
                print(f'  ✓ vendor {row["id"]}')
            except Exception as e:
                print(f'  ✗ vendor {row["id"]}：{e}')

        # 遷移作品集照片
        rows = await conn.fetch(
            "SELECT id, photo_url FROM vendor_portfolios WHERE photo_url LIKE 'data:%'"
        )
        print(f'[portfolio] 找到 {len(rows)} 筆需要遷移')
        for row in rows:
            try:
                new_url = upload_base64_to_r2(row['photo_url'], bucket, public_url)
                await conn.execute('UPDATE vendor_portfolios SET photo_url = $1 WHERE id = $2', new_url, row['id'])
                print(f'  ✓ portfolio {row["id"]}')
            except Exception as e:
                print(f'  ✗ portfolio {row["id"]}：{e}')

        print('遷移完成')
    finally:
        await conn.close()


if __name__ == '__main__':
    asyncio.run(migrate())
