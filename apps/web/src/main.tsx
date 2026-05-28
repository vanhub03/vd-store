import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BadgeCheck,
  Boxes,
  Clock3,
  CreditCard,
  History,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  PackageCheck,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  UserRound,
  Wallet
} from "lucide-react";
import {
  availableQuantity,
  Catalog,
  flattenCatalog,
  formatVnd,
  History as StoreHistory,
  PaymentResult,
  Product,
  Session,
  StoreApi,
  WalletPurchaseResult
} from "./api";
import "./styles.css";

const savedToken = localStorage.getItem("vd_store_token");
const api = new StoreApi(savedToken);

function App() {
  const [token, setToken] = useState(savedToken);
  const [customer, setCustomer] = useState<Session["customer"] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [history, setHistory] = useState<StoreHistory | null>(null);
  const [balance, setBalance] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [qr, setQr] = useState<PaymentResult | null>(null);
  const [delivery, setDelivery] = useState<WalletPurchaseResult | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [loading, setLoading] = useState("boot");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const products = useMemo(() => (catalog ? flattenCatalog(catalog) : []), [catalog]);
  const filteredProducts = useMemo(() => {
    const normalized = query.toLocaleLowerCase("vi-VN").trim();
    if (!normalized) return products;
    return products.filter((product) => `${product.name} ${product.description ?? ""}`.toLocaleLowerCase("vi-VN").includes(normalized));
  }, [products, query]);

  useEffect(() => {
    api.setToken(token);
    void loadPublicData();
    if (token) void loadPrivateData();
    else setLoading("");
  }, [token]);

  useEffect(() => {
    if (!qr || !token) return;
    const timer = window.setInterval(() => void loadPrivateData(false), 7000);
    return () => window.clearInterval(timer);
  }, [qr, token]);

  async function loadPublicData() {
    try {
      setCatalog(await api.get<Catalog>("/store/catalog"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loadPrivateData(showLoading = true) {
    try {
      if (showLoading) setLoading("profile");
      const profile = await api.get<{ customer: Session["customer"]; wallet: { balance: number } }>("/store/me");
      const nextHistory = await api.get<StoreHistory>("/store/history");
      setCustomer(profile.customer);
      setBalance(profile.wallet.balance);
      setHistory(nextHistory);
      setError("");
    } catch (err) {
      logout();
      setError((err as Error).message);
    } finally {
      setLoading("");
    }
  }

  function saveSession(session: Session) {
    localStorage.setItem("vd_store_token", session.token);
    api.setToken(session.token);
    setToken(session.token);
    setCustomer(session.customer);
    setAuthOpen(false);
  }

  function logout() {
    localStorage.removeItem("vd_store_token");
    api.setToken(null);
    setToken(null);
    setCustomer(null);
    setHistory(null);
    setBalance(0);
  }

  async function createTopup(amount: number) {
    if (!requireLogin()) return;
    await runAction("topup", async () => {
      setQr(await api.post<PaymentResult>("/store/topups", { amount }));
      setDelivery(null);
    });
  }

  async function buyWithWallet(product: Product) {
    if (!requireLogin()) return;
    await runAction(`wallet:${product.id}`, async () => {
      const result = await api.post<WalletPurchaseResult>("/store/orders/wallet", { productId: product.id, quantity: 1 });
      setDelivery(result);
      setQr(null);
      await loadPrivateData(false);
    });
  }

  async function buyWithBank(product: Product) {
    if (!requireLogin()) return;
    await runAction(`bank:${product.id}`, async () => {
      setQr(await api.post<PaymentResult>("/store/orders/bank", { productId: product.id, quantity: 1 }));
      setDelivery(null);
    });
  }

  function requireLogin() {
    if (token) return true;
    setAuthOpen(true);
    return false;
  }

  async function runAction(name: string, action: () => Promise<void>) {
    try {
      setLoading(name);
      setError("");
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading("");
    }
  }

  return (
    <main>
      <Header customer={customer} balance={balance} onLogin={() => setAuthOpen(true)} onLogout={logout} />
      <Hero onShop={() => document.getElementById("products")?.scrollIntoView({ behavior: "smooth" })} />

      <section className="shell product-section" id="products">
        <div className="section-head">
          <div>
            <p className="eyebrow">Kho sản phẩm trong bot</p>
            <h2>Chọn sản phẩm và thanh toán ngay trên web</h2>
          </div>
          <div className="search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm ChatGPT, Claude, YouTube..." />
          </div>
        </div>

        {error ? <div className="alert">{error}</div> : null}
        <div className="product-grid">
          {filteredProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              loading={loading}
              onView={() => setSelectedProduct(product)}
              onWallet={() => buyWithWallet(product)}
              onBank={() => buyWithBank(product)}
            />
          ))}
        </div>
      </section>

      <section className="shell account-grid">
        <WalletPanel balance={balance} disabled={!token} loading={loading} onTopup={createTopup} onLogin={() => setAuthOpen(true)} />
        <HistoryPanel history={history} onRefresh={() => token && loadPrivateData()} loading={loading === "profile"} />
      </section>

      <Footer />

      {authOpen ? <AuthDialog onClose={() => setAuthOpen(false)} onSession={saveSession} /> : null}
      {selectedProduct ? (
        <ProductDialog
          product={selectedProduct}
          loading={loading}
          onClose={() => setSelectedProduct(null)}
          onWallet={() => buyWithWallet(selectedProduct)}
          onBank={() => buyWithBank(selectedProduct)}
        />
      ) : null}
      {qr ? <QrDialog payment={qr} onClose={() => setQr(null)} onRefresh={() => token && loadPrivateData()} /> : null}
      {delivery ? <DeliveryDialog delivery={delivery} onClose={() => setDelivery(null)} /> : null}
      {loading === "boot" ? <div className="boot"><Loader2 className="spin" /> Đang mở VD AI Shop</div> : null}
    </main>
  );
}

function Header({
  customer,
  balance,
  onLogin,
  onLogout
}: {
  customer: Session["customer"] | null;
  balance: number;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="topbar">
      <a className="brand" href="#">
        <span className="brand-mark">VD</span>
        <span>VD AI Shop</span>
      </a>
      <nav>
        <a href="#products">Sản phẩm</a>
        <a href="#wallet">Ví</a>
        <a href="#history">Lịch sử</a>
      </nav>
      <div className="top-actions">
        {customer ? (
          <>
            <span className="balance-pill">
              <Wallet size={16} /> {formatVnd(balance)}
            </span>
            <span className="customer-pill">
              <UserRound size={16} /> {customer.displayName ?? customer.email}
            </span>
            <button className="icon-button" onClick={onLogout} aria-label="Đăng xuất">
              <LogOut size={18} />
            </button>
          </>
        ) : (
          <button className="primary-button" onClick={onLogin}>
            <KeyRound size={18} /> Đăng nhập
          </button>
        )}
      </div>
    </header>
  );
}

function Hero({ onShop }: { onShop: () => void }) {
  const orbitItems = ["ChatGPT", "Claude", "Gemini", "CapCut", "YouTube", "Adobe"];
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">Digital goods, tự động, có ví VietQR</p>
        <h1>VD AI Shop</h1>
        <p className="hero-text">Mua tài khoản, slot AI, phần mềm và dịch vụ số với QR tự đối soát, giao hàng tự động hoặc chuyển admin xử lý.</p>
        <div className="hero-actions">
          <button className="primary-button" onClick={onShop}>
            <ShoppingBag size={19} /> Mua ngay
          </button>
          <a className="ghost-button" href="#wallet">
            <QrCode size={19} /> Nạp ví
          </a>
        </div>
        <div className="trust-row">
          <span>
            <ShieldCheck size={18} /> SePay/VietQR
          </span>
          <span>
            <PackageCheck size={18} /> Giao hàng số
          </span>
          <span>
            <Clock3 size={18} /> QR 10 phút
          </span>
        </div>
      </div>
      <div className="kinetic-stage" aria-hidden="true">
        <div className="banner-frame">
          <img src="/banner.png" alt="" />
        </div>
        <div className="terminal-card">
          <span>PAYMENT MATCHED</span>
          <b>NAP • DH • VI</b>
        </div>
        <div className="orbit">
          {orbitItems.map((item, index) => (
            <i key={item} style={{ "--i": index } as React.CSSProperties}>
              {brandGlyph(item)}
            </i>
          ))}
        </div>
        <div className="scanner" />
        <div className="shelf shelf-a" />
        <div className="shelf shelf-b" />
      </div>
    </section>
  );
}

function ProductCard({
  product,
  loading,
  onView,
  onWallet,
  onBank
}: {
  product: Product;
  loading: string;
  onView: () => void;
  onWallet: () => void;
  onBank: () => void;
}) {
  const stock = availableQuantity(product);
  return (
    <article className="product-card">
      <div className="product-media">
        {product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <span>{product.buttonIcon ?? brandGlyph(product.name)}</span>}
      </div>
      <div className="product-body">
        <div className="product-title">
          <h3>{product.buttonIcon ?? brandGlyph(product.name)} {product.name}</h3>
          <strong>{formatVnd(product.price)}</strong>
        </div>
        <p>{product.description || deliveryLabel(product.deliveryType)}</p>
        <div className="product-meta">
          <span>
            <Boxes size={15} /> Kho: {product.deliveryType === "SHARED_CONTENT" ? "không giới hạn" : stock}
          </span>
          <span>{deliveryLabel(product.deliveryType)}</span>
        </div>
      </div>
      <div className="product-actions">
        <button onClick={onView}>Chi tiết</button>
        <button onClick={onWallet} disabled={loading === `wallet:${product.id}` || stock <= 0}>
          {loading === `wallet:${product.id}` ? <Loader2 className="spin" size={16} /> : <Wallet size={16} />} Ví
        </button>
        <button onClick={onBank} disabled={loading === `bank:${product.id}` || stock <= 0}>
          {loading === `bank:${product.id}` ? <Loader2 className="spin" size={16} /> : <QrCode size={16} />} QR
        </button>
      </div>
    </article>
  );
}

function WalletPanel({
  balance,
  disabled,
  loading,
  onTopup,
  onLogin
}: {
  balance: number;
  disabled: boolean;
  loading: string;
  onTopup: (amount: number) => void;
  onLogin: () => void;
}) {
  const amounts = [50000, 100000, 200000, 500000];
  return (
    <section className="panel" id="wallet">
      <div className="panel-title">
        <Wallet />
        <div>
          <h2>Ví VD</h2>
          <p>Số dư dùng để mua nhanh không cần quét QR từng đơn.</p>
        </div>
      </div>
      <div className="wallet-number">{formatVnd(balance)}</div>
      {disabled ? (
        <button className="primary-button" onClick={onLogin}>
          <Lock size={18} /> Đăng nhập để nạp ví
        </button>
      ) : (
        <div className="amount-grid">
          {amounts.map((amount) => (
            <button key={amount} onClick={() => onTopup(amount)} disabled={loading === "topup"}>
              {loading === "topup" ? <Loader2 className="spin" size={16} /> : null}
              {formatVnd(amount)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryPanel({ history, onRefresh, loading }: { history: StoreHistory | null; onRefresh: () => void; loading: boolean }) {
  return (
    <section className="panel" id="history">
      <div className="panel-title">
        <History />
        <div>
          <h2>Lịch sử</h2>
          <p>Đơn hàng và biến động ví gần nhất.</p>
        </div>
        <button className="icon-button" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={loading ? "spin" : ""} size={18} />
        </button>
      </div>
      <div className="history-list">
        {history?.orders.length ? (
          history.orders.slice(0, 5).map((order) => (
            <div className="history-row" key={order.code}>
              <span>{order.product.name}</span>
              <b>{formatVnd(order.totalAmount)}</b>
              <em>{order.status}</em>
            </div>
          ))
        ) : (
          <p className="muted">Đăng nhập để xem lịch sử mua hàng.</p>
        )}
      </div>
    </section>
  );
}

function AuthDialog({ onClose, onSession }: { onClose: () => void; onSession: (session: Session) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError("");
    try {
      const session = await api.post<Session>(mode === "login" ? "/store/auth/login" : "/store/auth/register", {
        email: form.get("email"),
        password: form.get("password"),
        name: form.get("name")
      });
      onSession(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overlay">
      <div className="dialog auth-dialog">
        <button className="close" onClick={onClose}>×</button>
        <h2>{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</h2>
        <form onSubmit={submit}>
          {mode === "register" ? <input name="name" placeholder="Tên hiển thị" /> : null}
          <input name="email" type="email" placeholder="Email" required />
          <input name="password" type="password" minLength={6} placeholder="Mật khẩu" required />
          {error ? <div className="alert">{error}</div> : null}
          <button className="primary-button" disabled={loading}>
            {loading ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
            {mode === "login" ? "Đăng nhập" : "Đăng ký"}
          </button>
        </form>
        <button className="link-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
        </button>
      </div>
    </div>
  );
}

function ProductDialog({
  product,
  loading,
  onClose,
  onWallet,
  onBank
}: {
  product: Product;
  loading: string;
  onClose: () => void;
  onWallet: () => void;
  onBank: () => void;
}) {
  return (
    <div className="overlay">
      <div className="dialog product-dialog">
        <button className="close" onClick={onClose}>×</button>
        <div className="dialog-media">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <span>{product.buttonIcon ?? "🛍️"}</span>}</div>
        <h2>{product.name}</h2>
        <p>{product.description || deliveryLabel(product.deliveryType)}</p>
        <div className="detail-grid">
          <span>Giá</span><b>{formatVnd(product.price)}</b>
          <span>Kho</span><b>{product.deliveryType === "SHARED_CONTENT" ? "không giới hạn" : availableQuantity(product)}</b>
          <span>Giao hàng</span><b>{deliveryLabel(product.deliveryType)}</b>
        </div>
        <div className="dialog-actions">
          <button className="primary-button" onClick={onWallet} disabled={loading === `wallet:${product.id}`}>
            {loading === `wallet:${product.id}` ? <Loader2 className="spin" size={18} /> : <Wallet size={18} />} Mua bằng ví
          </button>
          <button className="ghost-button" onClick={onBank} disabled={loading === `bank:${product.id}`}>
            {loading === `bank:${product.id}` ? <Loader2 className="spin" size={18} /> : <QrCode size={18} />} Chuyển khoản QR
          </button>
        </div>
      </div>
    </div>
  );
}

function QrDialog({ payment, onClose, onRefresh }: { payment: PaymentResult; onClose: () => void; onRefresh: () => void }) {
  return (
    <div className="overlay">
      <div className="dialog qr-dialog">
        <button className="close" onClick={onClose}>×</button>
        <h2>Quét QR thanh toán</h2>
        <img className="qr-image" src={payment.qrImageUrl} alt={`QR ${payment.code}`} />
        <div className="detail-grid">
          <span>Mã</span><b>{payment.code}</b>
          <span>Số tiền</span><b>{formatVnd(payment.amount)}</b>
          <span>Hạn</span><b>{new Date(payment.expiresAt).toLocaleTimeString("vi-VN")}</b>
        </div>
        <p className="muted">Sau khi SePay báo tiền vào, hệ thống tự cộng ví hoặc giao hàng. Trang này sẽ tự làm mới lịch sử.</p>
        <button className="ghost-button" onClick={onRefresh}>
          <RefreshCw size={18} /> Kiểm tra trạng thái
        </button>
      </div>
    </div>
  );
}

function DeliveryDialog({ delivery, onClose }: { delivery: WalletPurchaseResult; onClose: () => void }) {
  return (
    <div className="overlay">
      <div className="dialog">
        <button className="close" onClick={onClose}>×</button>
        <h2>Mua hàng thành công</h2>
        <p>Số dư còn lại: <b>{formatVnd(delivery.balanceAfter)}</b></p>
        <pre className="delivery-box">{delivery.deliveryText}</pre>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer>
      <span>VD AI Shop</span>
      <span>Thông minh - tiện lợi - uy tín</span>
      <a href="https://t.me/vanhdao99">Telegram @vanhdao99</a>
    </footer>
  );
}

function deliveryLabel(type: Product["deliveryType"]) {
  if (type === "STOCK_ITEM") return "Giao tự động";
  if (type === "SHARED_CONTENT") return "Nội dung dùng chung";
  return "Liên hệ admin";
}

function brandGlyph(name: string) {
  const lower = name.toLocaleLowerCase("vi-VN");
  if (lower.includes("chatgpt") || lower.includes("openai")) return "🤖";
  if (lower.includes("claude")) return "🟫";
  if (lower.includes("gemini")) return "✦";
  if (lower.includes("adobe")) return "🅰️";
  if (lower.includes("capcut")) return "🎬";
  if (lower.includes("youtube")) return "▶️";
  if (lower.includes("canva")) return "🟣";
  return "🛍️";
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
