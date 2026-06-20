# Hướng dẫn tích hợp VD Store Partner API cho CTV

Tài liệu này dành cho cộng tác viên muốn đấu nối website riêng với VD Store để tự động lấy catalog, kiểm tra số dư ví và tạo đơn hàng server-to-server.

## 1. Mô hình hoạt động

Khách cuối thanh toán cho website của CTV. Sau khi website CTV xác nhận đã thu tiền, backend của CTV gọi VD Store Partner API để tạo đơn. VD Store trừ ví CTV theo giá CTV/giá sỉ, xử lý tồn kho và trả nội dung giao hàng.

Không gọi Partner API trực tiếp từ trình duyệt, HTML, JavaScript frontend, app mobile hoặc repository public. API key chỉ được lưu ở backend/server của CTV.

Base URL:

```text
https://api.vanhdao.io.vn/partner/v1
```

Tài liệu kỹ thuật tự động:

- OpenAPI UI: https://api.vanhdao.io.vn/partner/docs
- OpenAPI JSON: https://api.vanhdao.io.vn/partner/openapi.json

## 2. API key và môi trường

VD Store sẽ cấp cho CTV một hoặc nhiều API key.

```http
Authorization: Bearer vd_test_xxx
Authorization: Bearer vd_live_xxx
```

Ý nghĩa:

- `vd_test_...`: sandbox/test, không trừ ví thật, không tiêu kho, không tiêu lượt voucher.
- `vd_live_...`: giao dịch thật, trừ ví CTV và xử lý tồn kho thật.

Mỗi key có thể được giới hạn scope:

| Scope | Dùng cho |
|---|---|
| `catalog:read` | Xem catalog và giá CTV |
| `balance:read` | Xem số dư ví |
| `orders:read` | Xem danh sách/chi tiết đơn API |
| `orders:write` | Tạo đơn API |

Header khuyến nghị cho mọi request:

```http
Authorization: Bearer VD_STORE_API_KEY
Accept: application/json
Content-Type: application/json
```

Riêng `POST /orders` bắt buộc thêm:

```http
Idempotency-Key: <mã duy nhất cho mỗi lần tạo đơn>
```

## 2.1. Sandbox/test có ảnh hưởng ví, kho hoặc hàng thật không?

Không. Nếu CTV dùng key `vd_test_...`, VD Store chỉ tạo đơn sandbox trong hệ thống Partner API để test luồng tích hợp.

Key test:

- Không tạo đơn bán hàng live trong bảng đơn hàng thật của website.
- Không tạo payment thật.
- Không ghi ledger trừ/cộng ví thật.
- Không trừ `manualStock`.
- Không bán hoặc khóa inventory `STOCK_ITEM`.
- Không tiêu lượt voucher.
- Không ảnh hưởng báo cáo doanh thu live.

Tuy nhiên, đơn sandbox vẫn có thể xuất hiện trong màn admin VD Store ở khu vực “Đơn hàng đối tác” với môi trường `TEST / Sandbox` để admin và CTV kiểm thử webhook. Khi admin bấm hoàn tất item thủ công trong sandbox, hệ thống chỉ gửi nội dung mô phỏng dạng:

```text
TEST_MANUAL_DELIVERY_...
```

Nội dung hàng thật sẽ không được gửi cho đơn sandbox.

CTV bắt buộc kiểm tra trường `livemode` trong mọi response/webhook:

```js
if (process.env.NODE_ENV === "production" && order.livemode !== true) {
  throw new Error("Không giao hàng thật từ đơn sandbox/test.");
}
```

Nếu website production của CTV lỡ cấu hình key test, đơn sẽ có `livemode: false`; website CTV phải coi đây là lỗi cấu hình và không giao hàng thật cho khách cuối.

## 3. Quy trình tích hợp khuyến nghị

1. CTV gọi `GET /catalog` định kỳ để đồng bộ sản phẩm, giá CTV, loại giao hàng và tồn kho.
2. Khách đặt hàng và thanh toán trên website của CTV.
3. Backend CTV xác nhận tiền đã nhận.
4. Backend CTV gọi `POST /orders` sang VD Store.
5. Backend CTV kiểm `livemode`. Môi trường production chỉ được chấp nhận `livemode: true`.
6. Nếu đơn trả về `FULFILLED`, website CTV giao nội dung cho khách ngay.
7. Nếu đơn trả về `PENDING_FULFILLMENT` hoặc `PARTIALLY_FULFILLED`, website CTV hiển thị trạng thái chờ admin VD Store xử lý phần thủ công.
8. CTV nhận webhook `order.updated` hoặc chủ động gọi `GET /orders/:id` để cập nhật kết quả cuối.

## 4. API catalog

Lấy danh sách sản phẩm đang bán trên web, giá dành cho CTV và tình trạng tồn kho.

```http
GET /partner/v1/catalog
```

cURL:

```bash
curl "https://api.vanhdao.io.vn/partner/v1/catalog" \
  -H "Authorization: Bearer vd_test_REPLACE_ME"
```

Response mẫu:

```json
{
  "livemode": false,
  "categories": [
    {
      "id": "cat_123",
      "name": "AI Tools",
      "products": [
        {
          "id": "prod_123",
          "name": "ChatGPT Plus",
          "nameEn": "ChatGPT Plus",
          "description": "Mô tả sản phẩm",
          "price": 120000,
          "regularPrice": 150000,
          "collaboratorDiscountPercent": 20,
          "deliveryType": "MANUAL",
          "available": true,
          "availableQuantity": 10
        }
      ]
    }
  ],
  "uncategorized": []
}
```

`deliveryType`:

| Giá trị | Ý nghĩa |
|---|---|
| `STOCK_ITEM` | Hàng tự động, mỗi đơn lấy một item tồn kho riêng |
| `SHARED_CONTENT` | Hàng tự động, dùng chung nội dung giao |
| `MANUAL` | Hàng thủ công, cần admin VD Store nhập nội dung giao sau |

Với key test, `availableQuantity` có thể được mô phỏng để CTV test quy trình mà không tiêu kho thật.

## 5. API số dư ví

```http
GET /partner/v1/balance
```

cURL:

```bash
curl "https://api.vanhdao.io.vn/partner/v1/balance" \
  -H "Authorization: Bearer vd_live_REPLACE_ME"
```

Response:

```json
{
  "livemode": true,
  "currency": "VND",
  "balance": 2500000
}
```

Trong sandbox, hệ thống trả số dư mô phỏng để test.

## 6. Tạo đơn hàng

```http
POST /partner/v1/orders
```

Yêu cầu:

- Bắt buộc có `Idempotency-Key`.
- `externalOrderId` là mã đơn của website CTV, duy nhất theo từng CTV và từng môi trường live/test.
- Tối đa 20 item mỗi đơn.
- Có thể truyền `voucherCode` nếu muốn áp voucher giống logic trên website VD Store.

Request:

```json
{
  "externalOrderId": "CTV-ORDER-2026-0001",
  "items": [
    {
      "productId": "prod_123",
      "quantity": 1
    }
  ],
  "voucherCode": "CTV10"
}
```

cURL:

```bash
curl "https://api.vanhdao.io.vn/partner/v1/orders" \
  -X POST \
  -H "Authorization: Bearer vd_test_REPLACE_ME" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: CTV-ORDER-2026-0001" \
  -d '{
    "externalOrderId": "CTV-ORDER-2026-0001",
    "items": [
      { "productId": "prod_123", "quantity": 1 }
    ],
    "voucherCode": "CTV10"
  }'
```

Response mẫu:

```json
{
  "id": "po_123",
  "livemode": false,
  "externalOrderId": "CTV-ORDER-2026-0001",
  "status": "PENDING_FULFILLMENT",
  "currency": "VND",
  "subtotalAmount": 150000,
  "collaboratorDiscountAmount": 30000,
  "voucherDiscountAmount": 10000,
  "totalAmount": 110000,
  "refundedAmount": 0,
  "voucherCode": "CTV10",
  "balanceAfter": 999890000,
  "items": [
    {
      "id": "poi_123",
      "productId": "prod_123",
      "productName": "ChatGPT Plus",
      "deliveryType": "MANUAL",
      "quantity": 1,
      "unitPrice": 150000,
      "subtotalAmount": 150000,
      "collaboratorDiscountAmount": 30000,
      "voucherDiscountAmount": 10000,
      "totalAmount": 110000,
      "status": "PENDING_FULFILLMENT",
      "delivery": null
    }
  ],
  "createdAt": "2026-06-20T07:00:00.000Z",
  "updatedAt": "2026-06-20T07:00:00.000Z"
}
```

Nếu item tự động đã giao, `delivery` sẽ có nội dung:

```json
{
  "status": "FULFILLED",
  "delivery": {
    "content": "Nội dung giao cho khách"
  }
}
```

## 7. Idempotency khi tạo đơn

`Idempotency-Key` giúp chống tạo trùng đơn khi mạng timeout hoặc CTV retry.

Nguyên tắc:

- Mỗi đơn dùng một `Idempotency-Key` duy nhất.
- Nếu retry cùng key và cùng payload trong 24 giờ, VD Store trả lại kết quả cũ.
- Nếu cùng key nhưng payload khác, API trả `409 idempotency_conflict`.
- Không dùng timestamp quá chung như `Date.now()` nếu có thể bị tạo lại; tốt nhất dùng chính mã đơn nội bộ của CTV.

Ví dụ tốt:

```text
Idempotency-Key: CTV-ORDER-2026-0001
```

## 8. Xem chi tiết đơn

```http
GET /partner/v1/orders/:id
```

cURL:

```bash
curl "https://api.vanhdao.io.vn/partner/v1/orders/po_123" \
  -H "Authorization: Bearer vd_test_REPLACE_ME"
```

Nên lưu `id` trả về từ `POST /orders` để truy vấn lại khi webhook chậm hoặc website CTV cần đồng bộ trạng thái.

## 9. Danh sách đơn

```http
GET /partner/v1/orders?limit=50
GET /partner/v1/orders?limit=50&cursor=po_123
```

cURL:

```bash
curl "https://api.vanhdao.io.vn/partner/v1/orders?limit=50" \
  -H "Authorization: Bearer vd_test_REPLACE_ME"
```

Response:

```json
{
  "data": [
    {
      "id": "po_123",
      "livemode": false,
      "externalOrderId": "CTV-ORDER-2026-0001",
      "status": "FULFILLED",
      "currency": "VND",
      "subtotalAmount": 150000,
      "collaboratorDiscountAmount": 30000,
      "voucherDiscountAmount": 10000,
      "totalAmount": 110000,
      "refundedAmount": 0,
      "voucherCode": "CTV10",
      "items": []
    }
  ],
  "hasMore": true,
  "nextCursor": "po_122"
}
```

Giới hạn `limit` tối đa là 100.

## 10. Trạng thái đơn và item

Trạng thái đơn:

| Status | Ý nghĩa |
|---|---|
| `FULFILLED` | Tất cả item đã giao |
| `PENDING_FULFILLMENT` | Toàn bộ item đang chờ admin giao |
| `PARTIALLY_FULFILLED` | Một phần đã giao/hủy, một phần còn chờ |
| `PARTIALLY_CANCELLED` | Một phần bị hủy, không còn item chờ |
| `CANCELLED` | Toàn bộ đơn bị hủy |

Trạng thái item:

| Status | Ý nghĩa |
|---|---|
| `FULFILLED` | Item đã có nội dung giao |
| `PENDING_FULFILLMENT` | Item thủ công đang chờ admin xử lý |
| `CANCELLED` | Item đã hủy, nếu live thì phần tiền tương ứng đã hoàn vào ví CTV |

Với đơn live:

- Nếu thiếu tiền ví, toàn bộ đơn bị từ chối, không trừ ví.
- Nếu hết hàng, toàn bộ đơn bị từ chối, không trừ ví.
- Nếu item thủ công bị admin hủy, hệ thống hoàn đúng phần tiền item đó và trả lại tồn.

Với đơn sandbox/test:

- `livemode` luôn là `false`.
- Không có ví/kho/voucher live nào bị thay đổi.
- Item tự động trả nội dung test.
- Item thủ công khi admin hoàn tất sẽ trả nội dung mô phỏng `TEST_MANUAL_DELIVERY_...`.
- CTV không được giao nội dung này cho khách thật.

## 11. Webhook

CTV có thể cấu hình webhook để nhận cập nhật tự động từ VD Store.

Event hiện hỗ trợ:

| Event | Khi nào gửi |
|---|---|
| `order.created` | Sau khi đơn API được tạo |
| `order.updated` | Khi đơn/item được admin hoàn tất hoặc hủy |
| `webhook.test` | Khi admin gửi event test |

Payload mẫu:

```json
{
  "id": "evt_123",
  "type": "order.updated",
  "createdAt": "2026-06-20T07:00:00.000Z",
  "livemode": true,
  "data": {
    "order": {
      "id": "po_123",
      "externalOrderId": "CTV-ORDER-2026-0001",
      "status": "FULFILLED",
      "currency": "VND",
      "totalAmount": 110000,
      "refundedAmount": 0,
      "items": []
    }
  }
}
```

Nếu webhook có `livemode: false`, đó là webhook sandbox/test. Website production của CTV chỉ nên ghi log hoặc cập nhật đơn test nội bộ, không giao hàng thật cho khách.

Header webhook:

```http
Content-Type: application/json
User-Agent: VD-Store-Partner-Webhook/1.0
VD-Event-Id: evt_123
VD-Signature: t=1781940000,v1=<hex_hmac_sha256>
```

Quy tắc:

- Endpoint webhook production phải dùng HTTPS public.
- Không dùng URL localhost, IP private hoặc URL có username/password.
- VD Store không follow redirect khi gửi webhook.
- Nếu endpoint trả HTTP `2xx`, VD Store coi là thành công.
- Nếu timeout hoặc trả `5xx/4xx`, VD Store retry tối đa khoảng 24 giờ.
- CTV nên lưu `VD-Event-Id` để bỏ qua event trùng.

## 12. Xác minh chữ ký webhook bằng Node.js

VD Store ký chuỗi:

```text
timestamp.rawBody
```

Trong đó `timestamp` là giá trị `t` trong header `VD-Signature`, còn `rawBody` là body JSON nguyên bản chưa parse.

Ví dụ Express:

```js
import express from "express";
import crypto from "node:crypto";

const app = express();

app.post("/vd-store/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const rawBody = req.body.toString("utf8");
  const signature = req.header("vd-signature") ?? "";
  const eventId = req.header("vd-event-id");

  if (!verifyVdStoreWebhook(rawBody, signature, process.env.VD_STORE_WEBHOOK_SECRET)) {
    return res.status(400).send("Invalid signature");
  }

  const event = JSON.parse(rawBody);

  // TODO: lưu eventId để chống xử lý trùng
  // TODO: cập nhật đơn nội bộ theo event.data.order

  return res.sendStatus(200);
});

function verifyVdStoreWebhook(rawBody, signatureHeader, secret) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    })
  );

  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");

  const actualBuffer = Buffer.from(parts.v1 ?? "", "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
```

## 13. Xác minh chữ ký webhook bằng PHP

```php
<?php

$rawBody = file_get_contents('php://input');
$signatureHeader = $_SERVER['HTTP_VD_SIGNATURE'] ?? '';
$secret = getenv('VD_STORE_WEBHOOK_SECRET');

if (!verifyVdStoreWebhook($rawBody, $signatureHeader, $secret)) {
    http_response_code(400);
    echo 'Invalid signature';
    exit;
}

$eventId = $_SERVER['HTTP_VD_EVENT_ID'] ?? null;
$event = json_decode($rawBody, true);

// TODO: lưu $eventId để chống xử lý trùng
// TODO: cập nhật đơn nội bộ theo $event['data']['order']

http_response_code(200);
echo 'OK';

function verifyVdStoreWebhook(string $rawBody, string $signatureHeader, string $secret): bool
{
    $parts = [];
    foreach (explode(',', $signatureHeader) as $item) {
        [$key, $value] = array_pad(explode('=', $item, 2), 2, null);
        if ($key && $value) {
            $parts[$key] = $value;
        }
    }

    if (empty($parts['t']) || empty($parts['v1'])) {
        return false;
    }

    $timestamp = (int) $parts['t'];
    if (abs(time() - $timestamp) > 300) {
        return false;
    }

    $expected = hash_hmac('sha256', $parts['t'] . '.' . $rawBody, $secret);

    return hash_equals($expected, $parts['v1']);
}
```

## 14. Ví dụ tạo đơn bằng Node.js

```js
const apiKey = process.env.VD_STORE_API_KEY;
const baseUrl = "https://api.vanhdao.io.vn/partner/v1";

async function createVdStoreOrder(localOrder) {
  const response = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": localOrder.id
    },
    body: JSON.stringify({
      externalOrderId: localOrder.id,
      items: localOrder.items.map((item) => ({
        productId: item.vdStoreProductId,
        quantity: item.quantity
      })),
      voucherCode: localOrder.voucherCode || undefined
    })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(`${result.code}: ${result.detail}`);
  }

  return result;
}
```

## 15. Ví dụ tạo đơn bằng PHP

```php
<?php

function createVdStoreOrder(array $localOrder): array
{
    $payload = [
        'externalOrderId' => $localOrder['id'],
        'items' => array_map(fn ($item) => [
            'productId' => $item['vdStoreProductId'],
            'quantity' => $item['quantity'],
        ], $localOrder['items']),
    ];

    if (!empty($localOrder['voucherCode'])) {
        $payload['voucherCode'] = $localOrder['voucherCode'];
    }

    $ch = curl_init('https://api.vanhdao.io.vn/partner/v1/orders');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . getenv('VD_STORE_API_KEY'),
            'Content-Type: application/json',
            'Idempotency-Key: ' . $localOrder['id'],
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
    ]);

    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $result = json_decode($body, true);

    if ($status < 200 || $status >= 300) {
        throw new RuntimeException(($result['code'] ?? 'request_failed') . ': ' . ($result['detail'] ?? $body));
    }

    return $result;
}
```

## 16. Format lỗi

Khi lỗi, API trả `application/problem+json`.

Ví dụ:

```json
{
  "type": "https://api.vanhdao.io.vn/problems/insufficient_balance",
  "title": "Bad Request",
  "status": 400,
  "detail": "Số dư ví không đủ.",
  "instance": "/partner/v1/orders",
  "code": "insufficient_balance",
  "requestId": "7d7d2b6e-..."
}
```

Các mã lỗi thường gặp:

| Code | HTTP | Ý nghĩa |
|---|---:|---|
| `missing_api_key` | 401 | Thiếu header Authorization |
| `invalid_api_key` | 401 | Key sai, hết hạn hoặc đã bị thu hồi |
| `partner_account_disabled` | 403 | Tài khoản CTV bị khóa, mất quyền CTV hoặc API bị tắt |
| `insufficient_scope` | 403 | Key thiếu scope cần thiết |
| `browser_requests_forbidden` | 403 | Gọi API từ browser/frontend |
| `invalid_idempotency_key` | 400 | Thiếu hoặc sai `Idempotency-Key` |
| `invalid_external_order_id` | 400 | `externalOrderId` thiếu hoặc quá dài |
| `invalid_items` | 400 | Giỏ hàng rỗng hoặc quá 20 item |
| `duplicate_external_order` | 409 | `externalOrderId` đã tồn tại |
| `idempotency_conflict` | 409 | Cùng `Idempotency-Key` nhưng payload khác |
| `request_in_progress` | 409 | Request cùng key đang xử lý |
| `insufficient_balance` | 400 | Ví CTV không đủ tiền |
| `out_of_stock` | 400 | Sản phẩm hết hàng |
| `rate_limit_exceeded` | 429 | Vượt giới hạn request/phút |
| `concurrency_limit_exceeded` | 429 | Quá nhiều request tạo đơn đồng thời |
| `rate_limiter_unavailable` | 503 | Dịch vụ tạm thời không sẵn sàng |
| `partner_api_disabled` | 503 | Partner API đang tạm tắt |

Khi cần hỗ trợ, gửi `requestId` cho VD Store để tra log nhanh hơn.

## 17. Rate limit

Mặc định:

- GET: 120 request/phút/key.
- POST tạo đơn: 20 request/phút/key.
- Tối đa 3 request tạo đơn đồng thời/key.

Response có thể kèm header:

```http
RateLimit-Limit: 120
RateLimit-Remaining: 119
RateLimit-Reset: 1781940060
Retry-After: 30
```

Nếu bị `429`, CTV nên retry sau thời gian trong `Retry-After`.

## 18. Checklist trước khi chạy live

Trước khi dùng `vd_live_...`, CTV nên hoàn tất:

- Đã test `GET /catalog` bằng key test.
- Đã test `POST /orders` bằng key test.
- Đã test retry cùng `Idempotency-Key` không tạo trùng đơn.
- Đã test xử lý đơn `FULFILLED`.
- Đã test xử lý đơn `PENDING_FULFILLMENT`.
- Production của CTV đã cấu hình key `vd_live_...`, không dùng key `vd_test_...`.
- Code production của CTV đã kiểm `livemode === true` trước khi giao hàng thật.
- Nếu dùng webhook: đã xác minh chữ ký, lưu `VD-Event-Id` và trả `2xx` nhanh.
- Backend không log API key, webhook secret hoặc nội dung giao hàng nhạy cảm.
- Website CTV chỉ gọi VD Store sau khi đã xác nhận khách thanh toán thành công.
- Ví CTV đã được nạp đủ tiền trước khi tạo đơn live.

## 19. Ghi chú bảo mật quan trọng

- Không đưa API key vào frontend.
- Không gửi API key cho khách cuối.
- Không commit API key lên GitHub/GitLab.
- Không dùng chung key live cho môi trường test/staging.
- Nếu nghi key lộ, báo admin VD Store để revoke/rotate ngay.
- Nên lưu `externalOrderId`, `partnerOrder.id`, trạng thái đơn và toàn bộ response tạo đơn để đối soát.

## 20. Tóm tắt endpoint

| Method | Endpoint | Scope | Mục đích |
|---|---|---|---|
| GET | `/partner/v1/catalog` | `catalog:read` | Lấy catalog, giá CTV, tồn kho |
| GET | `/partner/v1/balance` | `balance:read` | Xem số dư ví CTV |
| POST | `/partner/v1/orders` | `orders:write` | Tạo đơn, trừ ví live |
| GET | `/partner/v1/orders/:id` | `orders:read` | Xem chi tiết đơn |
| GET | `/partner/v1/orders?limit=50&cursor=...` | `orders:read` | Xem danh sách đơn |
