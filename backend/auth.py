"""JWT 工具 + 密碼雜湊（passlib bcrypt + python-jose HS256）"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

_SECRET = os.environ.get('JWT_SECRET', '')
if not _SECRET:
    _SECRET = secrets.token_hex(32)
    print('[Auth] 警告：JWT_SECRET 未設定，使用臨時隨機金鑰（重啟後所有 token 失效）')

_ALGO = 'HS256'
_DAYS = 30


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=_DAYS)
    return jwt.encode({'sub': user_id, 'exp': exp}, _SECRET, algorithm=_ALGO)


def decode_token(token: str) -> str:
    """回傳 user_id（UUID 字串），token 無效或過期則拋出 ValueError。"""
    try:
        payload = jwt.decode(token, _SECRET, algorithms=[_ALGO])
        sub = payload.get('sub')
        if not sub:
            raise ValueError('invalid token payload')
        return sub
    except JWTError as e:
        raise ValueError(str(e)) from e
