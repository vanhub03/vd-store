# VD Store Partner API v1

Base URL: `https://api.vanhdao.io.vn/partner/v1`

Partner API chỉ được gọi từ backend của website cộng tác viên. Không đặt API key trong HTML, JavaScript phía trình duyệt, ứng dụng mobile hoặc repository công khai.

## Xác thực và môi trường

Gửi key trong header:

```http
Authorization: Bearer vd_test_...
```

- `vd_test_...`: sandbox, không trừ ví, không tiêu kho hoặc voucher.
- `vd_live_...`: giao dịch thật và trừ ví CTV.
- Key có thể bị giới hạn bởi các scope `catalog:read`, `balance:read`, `orders:read`, `orders:write`.

## Tạo đơn

Mỗi request `POST /orders` bắt buộc có `Idempotency-Key` duy nhất. Giữ cùng key và cùng payload khi retry do timeout; không tái sử dụng key cho giao dịch khác.

```bash
curl https://api.vanhdao.io.vn/partner/v1/orders \
  -H "Authorization: Bearer vd_test_REPLACE_ME" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: shop-order-2026-0001" \
  -d '{
    "externalOrderId": "shop-order-2026-0001",
    "items": [
      { "productId": "PRODUCT_ID", "quantity": 1 }
    ]
  }'
```

Node.js:

```js
const response = await fetch("https://api.vanhdao.io.vn/partner/v1/orders", {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.VD_STORE_API_KEY}`,
    "content-type": "application/json",
    "idempotency-key": localOrder.id,
  },
  body: JSON.stringify({
    externalOrderId: localOrder.id,
    items: [{ productId: localOrder.productId, quantity: 1 }],
  }),
});
const result = await response.json();
if (!response.ok) throw new Error(`${result.code}: ${result.detail}`);
```

PHP:

```php
$curl = curl_init('https://api.vanhdao.io.vn/partner/v1/orders');
curl_setopt_array($curl, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Authorization: Bearer ' . getenv('VD_STORE_API_KEY'),
    'Content-Type: application/json',
    'Idempotency-Key: ' . $localOrderId,
  ],
  CURLOPT_POSTFIELDS => json_encode([
    'externalOrderId' => $localOrderId,
    'items' => [['productId' => $productId, 'quantity' => 1]],
  ]),
]);
$result = json_decode(curl_exec($curl), true);
```

## Trạng thái

- `FULFILLED`: tất cả item đã có nội dung giao.
- `PENDING_FULFILLMENT`: toàn bộ item đang chờ admin giao.
- `PARTIALLY_FULFILLED`: giỏ có item đã giao và item còn chờ hoặc bị hủy.
- `PARTIALLY_CANCELLED`, `CANCELLED`: một phần hoặc toàn bộ đơn đã hủy; `refundedAmount` cho biết số tiền đã hoàn.

Luôn lưu `id` của PartnerOrder. Có thể phục hồi trạng thái bằng `GET /orders/:id` ngay cả khi webhook bị chậm.

## Xác minh webhook

Header `VD-Signature` có dạng `t=unix_timestamp,v1=hex_hmac`. Chữ ký là HMAC-SHA256 của chuỗi `timestamp.raw_request_body`. Kiểm tra timestamp trong cửa sổ 5 phút và lưu `VD-Event-Id` để bỏ qua event trùng.

```js
import crypto from "node:crypto";

function verifyWebhook(rawBody, signatureHeader, secret) {
  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => part.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");
  const actual = Buffer.from(parts.v1, "hex");
  const wanted = Buffer.from(expected, "hex");
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}
```

Webhook có thể được gửi lại và không bảo đảm thứ tự tuyệt đối. Trả `2xx` nhanh sau khi xác minh/lưu event, rồi xử lý nghiệp vụ bằng queue của website CTV.

OpenAPI tương tác: `https://api.vanhdao.io.vn/partner/docs`
OpenAPI JSON: `https://api.vanhdao.io.vn/partner/openapi.json`
