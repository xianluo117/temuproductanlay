from __future__ import annotations

import base64
import io
import json
import os
import re
import sys
import time
from collections import Counter
from dataclasses import dataclass
from typing import Any

import cv2
import ddddocr
import numpy as np
import pytesseract
import requests
from PIL import Image

CAPTCHA_URL = "https://api-cn.zhfulfill.com/erp/dealer/passport/captcha"
LOGIN_URL = "https://api-cn.zhfulfill.com/erp/dealer/passport/loginHasCaptcha"
SESSION_URL = "https://api-cn.zhfulfill.com/erp/dealer/passport/access/token"
ORDER_PAGE_URL = "https://api-cn.zhfulfill.com/erp/dealer/order/page"


class WorkerError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Credentials:
    account: str
    password: str


def api_json(response: requests.Response, operation: str) -> dict[str, Any]:
    try:
        response.raise_for_status()
    except requests.HTTPError as error:
        raise WorkerError("HTTP_ERROR", f"{operation} HTTP 错误: {response.status_code}") from error
    try:
        payload = response.json()
    except ValueError as error:
        raise WorkerError("INVALID_RESPONSE", f"{operation} 返回了无效 JSON") from error
    if not isinstance(payload, dict) or payload.get("code") != 200:
        message = payload.get("message") if isinstance(payload, dict) else None
        raise WorkerError("BUSINESS_ERROR", str(message or f"{operation}业务状态异常"))
    return payload


def normalize_expression(value: str) -> str | None:
    normalized = (
        value.replace("×", "*")
        .replace("x", "*")
        .replace("X", "*")
        .replace("÷", "/")
        .replace("—", "-")
        .replace("_", "-")
    )
    normalized = re.sub(r"[=?\s]", "", normalized)
    match = re.fullmatch(r"(-?\d+)([+\-*/])(-?\d+)", normalized)
    return match.group(0) if match else None


def calculate_expression(expression: str) -> str:
    match = re.fullmatch(r"(-?\d+)([+\-*/])(-?\d+)", expression)
    if not match:
        raise WorkerError("CAPTCHA_UNRELIABLE", "验证码算式格式无效")
    left, operator, right = int(match.group(1)), match.group(2), int(match.group(3))
    if operator == "+":
        return str(left + right)
    if operator == "-":
        return str(left - right)
    if operator == "*":
        return str(left * right)
    if right == 0 or left % right != 0:
        raise WorkerError("CAPTCHA_UNRELIABLE", "验证码除法结果不可靠")
    return str(left // right)


def image_versions(image_bytes: bytes) -> list[np.ndarray[Any, Any]]:
    source = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if source is None:
        raise WorkerError("CAPTCHA_INVALID", "验证码图片无法解码")
    enlarged = cv2.resize(source, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    _, otsu = cv2.threshold(enlarged, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    inverted = cv2.bitwise_not(otsu)
    adaptive = cv2.adaptiveThreshold(
        enlarged,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        7,
    )
    kernel = np.ones((2, 2), np.uint8)
    opened = cv2.morphologyEx(otsu, cv2.MORPH_OPEN, kernel)
    return [enlarged, otsu, inverted, adaptive, opened]


def recognize_expression(image_bytes: bytes) -> str:
    tesseract_cmd = os.getenv("TESSERACT_CMD", "").strip()
    if not tesseract_cmd and os.name == "nt":
        default_tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        if os.path.isfile(default_tesseract_cmd):
            tesseract_cmd = default_tesseract_cmd
    if tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
    candidates: Counter[str] = Counter()
    for image in image_versions(image_bytes):
        for psm in (6, 7, 8, 10, 11, 13):
            text = pytesseract.image_to_string(
                image,
                config=f"--psm {psm} -c tessedit_char_whitelist=0123456789+-xX*/=?",
            )
            expression = normalize_expression(text)
            if expression:
                candidates[expression] += 1
    digit_hint = re.sub(r"\D", "", ddddocr.DdddOcr(show_ad=False).classification(image_bytes))
    ranked = sorted(
        candidates.items(),
        key=lambda item: (digit_hint == re.sub(r"\D", "", item[0]), item[1]),
        reverse=True,
    )
    if not ranked or ranked[0][1] < 2:
        raise WorkerError("CAPTCHA_UNRELIABLE", "验证码 OCR 未形成可靠结果")
    return ranked[0][0]


def decode_captcha_image(value: Any) -> bytes:
    if not isinstance(value, str) or not value:
        raise WorkerError("CAPTCHA_INVALID", "验证码响应缺少图片")
    encoded = value.split(",", 1)[-1]
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
        Image.open(io.BytesIO(image_bytes)).verify()
        return image_bytes
    except Exception as error:
        raise WorkerError("CAPTCHA_INVALID", "验证码图片格式无效") from error


def login(session: requests.Session, credentials: Credentials, timeout: float, max_attempts: int) -> str:
    last_error: WorkerError | None = None
    for attempt in range(max_attempts):
        try:
            captcha = api_json(session.get(CAPTCHA_URL, timeout=timeout), "获取验证码")
            data = captcha.get("data")
            if not isinstance(data, dict) or not isinstance(data.get("key"), str):
                raise WorkerError("CAPTCHA_INVALID", "验证码响应缺少验证码键")
            expression = recognize_expression(decode_captcha_image(data.get("image")))
            answer = calculate_expression(expression)
            payload = api_json(
                session.post(
                    LOGIN_URL,
                    headers={"Content-Type": "application/json;charset=UTF-8"},
                    json={
                        "account": credentials.account,
                        "password": credentials.password,
                        "captchaParam": {
                            "captchaKey": data["key"],
                            "captchaCode": answer,
                        },
                    },
                    timeout=timeout,
                ),
                "智猴登录",
            )
            token = payload.get("data")
            if not isinstance(token, str) or not token:
                raise WorkerError("LOGIN_FAILED", "登录响应缺少访问令牌")
            verify = api_json(
                session.post(
                    SESSION_URL,
                    headers={
                        "Accept": "application/json, text/plain, */*",
                        "Content-Type": "application/json;charset=UTF-8",
                        "x-access-token": token,
                    },
                    json={},
                    timeout=timeout,
                ),
                "验证登录会话",
            )
            returned_account = find_account(verify.get("data"))
            if returned_account and returned_account.casefold() != credentials.account.casefold():
                raise WorkerError("ACCOUNT_MISMATCH", "会话账户与配置账户不一致")
            return token
        except WorkerError as error:
            last_error = error
            if error.code in {"ACCOUNT_MISMATCH", "LOGIN_FAILED"}:
                break
            if attempt + 1 < max_attempts:
                time.sleep(min(0.4 * (attempt + 1), 2.0))
    raise last_error or WorkerError("LOGIN_FAILED", "智猴登录失败")


def find_account(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    for key in ("account", "username", "userName", "loginAccount"):
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate:
            return candidate
    for nested in value.values():
        candidate = find_account(nested)
        if candidate:
            return candidate
    return None


def text_value(source: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = source.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def int_value(source: dict[str, Any], *keys: str) -> int:
    for key in keys:
        value = source.get(key)
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            continue
    return 0


def attribute_value(item: dict[str, Any], names: tuple[str, ...]) -> str | None:
    direct = text_value(item, *names)
    if direct:
        return direct
    for key in ("attributes", "specifications", "skuProperties", "propertyList", "saleAttributes"):
        attributes = item.get(key)
        if isinstance(attributes, str):
            try:
                attributes = json.loads(attributes)
            except ValueError:
                continue
        if not isinstance(attributes, list):
            continue
        for attribute in attributes:
            if not isinstance(attribute, dict):
                continue
            name = text_value(attribute, "name", "key", "propertyName", "attributeName")
            value = text_value(attribute, "value", "propertyValue", "attributeValue", "valueName")
            if name and value and any(candidate.casefold() in name.casefold() for candidate in names):
                return value
    return None


def item_lists(order: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for key in ("orderItems", "items", "orderItemList", "products", "productList", "details"):
        value = order.get(key)
        if isinstance(value, list):
            candidates.extend(item for item in value if isinstance(item, dict))
    parcels = order.get("parcels")
    if isinstance(parcels, list):
        for parcel in parcels:
            if not isinstance(parcel, dict):
                continue
            for key in ("parcelItems", "items"):
                value = parcel.get(key)
                if isinstance(value, list):
                    candidates.extend(item for item in value if isinstance(item, dict))
    unique: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(candidates):
        item_key = text_value(item, "id", "orderItemId", "detailId", "skuId") or f"index:{index}"
        unique[item_key] = item
    return list(unique.values())


def parse_order(order: dict[str, Any]) -> dict[str, Any] | None:
    order_no = text_value(order, "orderNo", "orderNumber", "platformOrderNo")
    if not order_no:
        return None
    items: list[dict[str, Any]] = []
    for index, item in enumerate(item_lists(order)):
        # 智猴字段名 spu 实际承载 SKU。
        sku = text_value(item, "spu", "sku", "skuCode", "sellerSku")
        if not sku:
            continue
        quantity = int_value(item, "quantity", "productQuantity", "skuQuantity", "count", "num")
        external_id = text_value(item, "id", "orderItemId", "detailId") or str(index)
        items.append(
            {
                "externalItemKey": f"{order_no}:{external_id}:{sku}",
                "zhihouSku": sku,
                "productName": text_value(item, "name", "productName", "title", "goodsName"),
                "color": attribute_value(item, ("color", "colour", "颜色")),
                "size": attribute_value(item, ("size", "尺码", "尺寸")),
                "quantity": quantity,
                "specificationImageUrl": text_value(
                    item, "imageUri", "imageUrl", "skuImage", "specificationImageUrl"
                ),
                "mainImageUrl": text_value(item, "mainImageUri", "mainImageUrl", "productImage"),
            }
        )
    return {
        "erpOrderId": text_value(order, "id", "orderId"),
        "orderNo": order_no,
        "storeName": text_value(order, "storeName"),
        "countryCode": text_value(order, "countryCode"),
        "submittedAt": text_value(order, "submitTime", "submittedAt", "createTime"),
        "items": items,
    }


def query_pending_orders(session: requests.Session, token: str, timeout: float) -> dict[str, Any]:
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=UTF-8",
        "x-access-token": token,
    }
    page_no = 1
    page_size = 50
    parsed_orders: dict[str, dict[str, Any]] = {}
    while page_no <= 1000:
        payload = api_json(
            session.post(
                ORDER_PAGE_URL,
                headers=headers,
                json={
                    "trackingStatus": "ALL",
                    "timeField": "CREATE_TIME",
                    "customCarrierIds": [],
                    "packageStatus": [],
                    "otherLogisticsIds": [],
                    "orderDataType": "",
                    "logisticsChannelIds": [],
                    "storeIds": [],
                    "virtualShipment": "",
                    "isBind": "",
                    "isY2": "",
                    "countryCodes": [],
                    "orderStatus": "PENDING",
                    "pageNo": page_no,
                    "pageSize": page_size,
                },
                timeout=timeout,
            ),
            f"查询新订单第 {page_no} 页",
        )
        data = payload.get("data")
        if not isinstance(data, dict):
            raise WorkerError("INVALID_RESPONSE", "订单分页响应缺少 data")
        records = data.get("data")
        if not isinstance(records, list):
            raise WorkerError("INVALID_RESPONSE", "订单分页响应缺少订单数组")
        for record in records:
            if isinstance(record, dict):
                parsed = parse_order(record)
                if parsed:
                    parsed_orders[parsed["orderNo"]] = parsed
        total_count = int(data.get("totalCount") or 0)
        has_next = data.get("hasNext")
        if has_next is False or len(records) < page_size or page_no * page_size >= total_count:
            break
        page_no += 1
        time.sleep(0.15)
    return {"pageCount": page_no, "orders": list(parsed_orders.values())}


def run(input_data: dict[str, Any]) -> dict[str, Any]:
    action = input_data.get("action")
    account = str(input_data.get("account") or "").strip()
    password = str(input_data.get("password") or "")
    if not account or not password:
        raise WorkerError("CONFIGURATION_ERROR", "智猴账号或密码未配置")
    timeout = max(1.0, float(input_data.get("timeoutMs") or 30000) / 1000)
    max_attempts = max(1, min(20, int(input_data.get("maxAttempts") or 8)))
    session = requests.Session()
    token = login(session, Credentials(account, password), timeout, max_attempts)
    if action == "test_login":
        return {"success": True, "account": account, "message": "智猴 ERP 登录验证成功"}
    if action == "sync_pending_orders":
        return query_pending_orders(session, token, timeout)
    raise WorkerError("INVALID_ACTION", "不支持的智猴工作器操作")


def main() -> None:
    try:
        raw = sys.stdin.read()
        input_data = json.loads(raw)
        if not isinstance(input_data, dict):
            raise WorkerError("INVALID_INPUT", "工作器输入必须是 JSON 对象")
        print(json.dumps({"ok": True, "data": run(input_data)}, ensure_ascii=False))
    except WorkerError as error:
        print(json.dumps({"ok": False, "error": {"code": error.code, "message": str(error)}}, ensure_ascii=False))
        raise SystemExit(1)
    except Exception as error:
        message = str(error).strip() or type(error).__name__
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": {
                        "code": "WORKER_ERROR",
                        "message": f"智猴协议工作器执行失败: {message}",
                    },
                },
                ensure_ascii=False,
            )
        )
        raise SystemExit(1)


if __name__ == "__main__":
    main()
