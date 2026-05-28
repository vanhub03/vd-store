import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  Headphones,
  History,
  Home,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  PackageCheck,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  TimerReset,
  UserRound,
  Wallet,
  Zap
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
type Tab = "home" | "products" | "wallet" | "history";

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
  const [activeTab, setActiveTab] = useState<Tab>("home");

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
      <Header customer={customer} balance={balance} activeTab={activeTab} onTab={setActiveTab} onLogin={() => setAuthOpen(true)} onLogout={logout} />

      {activeTab === "home" ? <HomeTab onShop={() => setActiveTab("products")} onWallet={() => setActiveTab("wallet")} /> : null}
      {activeTab === "products" ? (
        <ProductsTab
          products={filteredProducts}
          query={query}
          loading={loading}
          error={error}
          onQuery={setQuery}
          onView={setSelectedProduct}
          onWallet={buyWithWallet}
          onBank={buyWithBank}
        />
      ) : null}
      {activeTab === "wallet" ? (
        <section className="shell tab-shell">
          <WalletPanel balance={balance} disabled={!token} loading={loading} onTopup={createTopup} onLogin={() => setAuthOpen(true)} />
        </section>
      ) : null}
      {activeTab === "history" ? (
        <section className="shell tab-shell">
          <HistoryPanel history={history} onRefresh={() => token && loadPrivateData()} loading={loading === "profile"} />
        </section>
      ) : null}

      <Footer onTab={setActiveTab} />

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
  activeTab,
  onTab,
  onLogin,
  onLogout
}: {
  customer: Session["customer"] | null;
  balance: number;
  activeTab: Tab;
  onTab: (tab: Tab) => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const navItems: Array<{ tab: Tab; label: string; icon: React.ReactNode }> = [
    { tab: "home", label: "Home", icon: <Home size={17} /> },
    { tab: "products", label: "Sản phẩm", icon: <ShoppingBag size={17} /> },
    { tab: "wallet", label: "Ví", icon: <Wallet size={17} /> },
    { tab: "history", label: "Lịch sử", icon: <History size={17} /> }
  ];

  return (
    <header className="topbar">
      <button className="brand" onClick={() => onTab("home")}>
        <img className="brand-logo" src="/logo.png" alt="VD AI Shop" />
        <span>VD AI Shop</span>
      </button>
      <nav className="tab-nav" aria-label="Điều hướng">
        {navItems.map((item) => (
          <button key={item.tab} className={activeTab === item.tab ? "active" : ""} onClick={() => onTab(item.tab)}>
            {item.icon}
            {item.label}
          </button>
        ))}
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

function HomeTab({ onShop, onWallet }: { onShop: () => void; onWallet: () => void }) {
  return (
    <>
      <Hero onShop={onShop} onWallet={onWallet} />
      <TrustShowcase />
      <HowItWorks onShop={onShop} onWallet={onWallet} />
      <BrandShowcase />
    </>
  );
}

function Hero({ onShop, onWallet }: { onShop: () => void; onWallet: () => void }) {
  return (
    <section className="hero">
      <div className="hero-backdrop">
        <img src="/banner.png" alt="" />
      </div>
      <div className="hero-content reveal">
        <img className="hero-logo" src="/logo.png" alt="VD AI Shop" />
        <p className="eyebrow">Digital goods, ví VietQR, tự đối soát</p>
        <h1>VD AI Shop</h1>
        <p className="hero-text">
          Mua tài khoản AI, phần mềm, slot premium và dịch vụ số. Hệ thống tạo QR theo mã riêng, đối soát SePay tự động và chỉ hiển thị hàng sau khi thanh toán thành công.
        </p>
        <div className="hero-actions">
          <button className="primary-button" onClick={onShop}>
            <ShoppingBag size={19} /> Xem sản phẩm
          </button>
          <button className="ghost-button" onClick={onWallet}>
            <QrCode size={19} /> Nạp ví
          </button>
        </div>
      </div>
      <div className="hero-stats reveal">
        <span><ShieldCheck size={18} /> QR có mã riêng</span>
        <span><TimerReset size={18} /> Hết hạn tự động</span>
        <span><PackageCheck size={18} /> Giao sau thanh toán</span>
      </div>
    </section>
  );
}

function TrustShowcase() {
  const cards = [
    { icon: <BadgeCheck />, title: "Đối soát rõ ràng", text: "Mỗi QR có mã NAP/DH riêng, ghi nhận lịch sử ví và đơn hàng để tra cứu sau này." },
    { icon: <Zap />, title: "Mua nhanh bằng ví", text: "Nạp một lần, mua nhiều lần, hệ thống tự trừ số dư và trả kết quả sau thanh toán." },
    { icon: <Headphones />, title: "Hỗ trợ thủ công", text: "Với sản phẩm cần xử lý riêng, thông tin liên hệ admin chỉ mở sau khi đơn đã thanh toán." },
    { icon: <ShieldCheck />, title: "Bảo mật giao dịch", text: "Webhook SePay kiểm tra mã thanh toán, số tiền và chống xử lý trùng giao dịch." }
  ];

  return (
    <section className="shell trust-showcase">
      <div className="section-head compact">
        <div>
          <p className="eyebrow">Tăng độ tin cậy</p>
          <h2>Một quy trình mua hàng minh bạch từ QR đến giao hàng</h2>
        </div>
      </div>
      <div className="trust-grid">
        {cards.map((card, index) => (
          <article className="trust-card reveal" style={{ "--d": `${index * 90}ms` } as React.CSSProperties} key={card.title}>
            {card.icon}
            <h3>{card.title}</h3>
            <p>{card.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function HowItWorks({ onShop, onWallet }: { onShop: () => void; onWallet: () => void }) {
  const steps = [
    ["1", "Chọn sản phẩm", "Xem giá, số lượng còn lại và chọn mua bằng ví hoặc chuyển khoản QR."],
    ["2", "Thanh toán", "QR được tạo theo đúng số tiền và mã nội dung riêng trong 10 phút."],
    ["3", "Đối soát", "Khi SePay báo tiền vào, hệ thống tự cộng ví hoặc hoàn tất đơn hàng."],
    ["4", "Nhận hàng", "Chỉ sau khi đơn thành công, hệ thống mới hiển thị hàng hoặc hướng dẫn liên hệ admin."]
  ];

  return (
    <section className="shell flow-section">
      <div className="flow-copy reveal">
        <p className="eyebrow">Luồng xử lý</p>
        <h2>Không lộ hàng trước thanh toán, không cần xác nhận tay từng đơn</h2>
        <p>
          Trang web dùng chung dữ liệu với bot Telegram. Người mua có thể kiểm tra ví, lịch sử đơn, trạng thái giao dịch và quay lại xem thông tin giao hàng đã thanh toán.
        </p>
        <div className="flow-actions">
          <button className="primary-button" onClick={onShop}>Mua hàng <ArrowRight size={18} /></button>
          <button className="ghost-button" onClick={onWallet}>Nạp ví <Wallet size={18} /></button>
        </div>
      </div>
      <div className="timeline">
        {steps.map(([number, title, text], index) => (
          <article className="timeline-item reveal" style={{ "--d": `${index * 120}ms` } as React.CSSProperties} key={title}>
            <span>{number}</span>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function BrandShowcase() {
  const brands = ["ChatGPT", "Claude", "Gemini", "Adobe", "CapCut", "YouTube", "Canva", "Cursor", "Grok", "Netflix"];
  return (
    <section className="shell brand-showcase">
      <div className="brand-panel reveal">
        <div>
          <p className="eyebrow">Danh mục phổ biến</p>
          <h2>Các gói AI, sáng tạo nội dung và premium account</h2>
        </div>
        <div className="brand-cloud" aria-label="Các thương hiệu phổ biến">
          {brands.map((brand, index) => (
            <span key={brand} style={{ "--d": `${index * 70}ms` } as React.CSSProperties}>
              {brandGlyph(brand)} {brand}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductsTab({
  products,
  query,
  loading,
  error,
  onQuery,
  onView,
  onWallet,
  onBank
}: {
  products: Product[];
  query: string;
  loading: string;
  error: string;
  onQuery: (value: string) => void;
  onView: (product: Product) => void;
  onWallet: (product: Product) => void;
  onBank: (product: Product) => void;
}) {
  return (
    <section className="shell product-section">
      <div className="section-head">
        <div>
          <p className="eyebrow">Kho sản phẩm</p>
          <h2>Chọn sản phẩm và thanh toán ngay trên web</h2>
        </div>
        <div className="search-box">
          <Search size={18} />
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Tìm ChatGPT, Claude, YouTube..." />
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      <div className="product-grid">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            loading={loading}
            onView={() => onView(product)}
            onWallet={() => onWallet(product)}
            onBank={() => onBank(product)}
          />
        ))}
      </div>
      {!products.length ? <div className="empty-state">Chưa có sản phẩm phù hợp.</div> : null}
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
  const disabled = stock <= 0;
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
        <p>{product.description || "Thông tin nhận hàng sẽ hiển thị sau khi thanh toán thành công."}</p>
        <div className="product-meta">
          <span>
            <Boxes size={15} /> Kho: {product.deliveryType === "SHARED_CONTENT" ? "không giới hạn" : stock}
          </span>
          <span>{postPaymentLabel(product.deliveryType)}</span>
        </div>
      </div>
      <div className="product-actions">
        <button onClick={onView}>Chi tiết</button>
        <button onClick={onWallet} disabled={loading === `wallet:${product.id}` || disabled}>
          {loading === `wallet:${product.id}` ? <Loader2 className="spin" size={16} /> : <Wallet size={16} />} Ví
        </button>
        <button onClick={onBank} disabled={loading === `bank:${product.id}` || disabled}>
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
  const [customAmount, setCustomAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const amounts = [50000, 100000, 200000, 500000];

  function submitCustomTopup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(customAmount.replace(/[^\d]/g, ""));
    if (!Number.isFinite(amount) || amount < 1000) {
      setAmountError("Số tiền nạp tối thiểu là 1.000đ.");
      return;
    }
    setAmountError("");
    onTopup(amount);
  }

  return (
    <section className="panel wallet-panel" id="wallet">
      <div className="panel-title">
        <Wallet />
        <div>
          <h2>Ví VD</h2>
          <p>Số dư dùng để mua nhanh mà không cần quét QR từng đơn.</p>
        </div>
      </div>
      <div className="wallet-number">{formatVnd(balance)}</div>
      {disabled ? (
        <button className="primary-button" onClick={onLogin}>
          <Lock size={18} /> Đăng nhập để nạp ví
        </button>
      ) : (
        <>
          <div className="amount-grid">
            {amounts.map((amount) => (
              <button key={amount} onClick={() => onTopup(amount)} disabled={loading === "topup"}>
                {loading === "topup" ? <Loader2 className="spin" size={16} /> : null}
                {formatVnd(amount)}
              </button>
            ))}
          </div>
          <form className="custom-topup" onSubmit={submitCustomTopup}>
            <label htmlFor="custom-amount">Nạp số tiền tùy ý</label>
            <div>
              <input
                id="custom-amount"
                inputMode="numeric"
                min={1000}
                placeholder="Ví dụ: 150000"
                value={customAmount}
                onChange={(event) => {
                  setCustomAmount(event.target.value);
                  setAmountError("");
                }}
              />
              <button className="primary-button" disabled={loading === "topup"}>
                {loading === "topup" ? <Loader2 className="spin" size={18} /> : <QrCode size={18} />}
                Tạo QR
              </button>
            </div>
            {amountError ? <p className="field-error">{amountError}</p> : <p className="muted">Nhập số tiền muốn nạp, hệ thống sẽ tạo QR VietQR theo đúng số tiền đó.</p>}
          </form>
        </>
      )}
    </section>
  );
}

function HistoryPanel({ history, onRefresh, loading }: { history: StoreHistory | null; onRefresh: () => void; loading: boolean }) {
  return (
    <section className="panel history-panel" id="history">
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
          history.orders.slice(0, 8).map((order) => (
            <div className="history-row" key={order.code}>
              <div>
                <span>{order.product.name}</span>
                {order.deliveryText ? <pre className="history-delivery">{order.deliveryText}</pre> : null}
              </div>
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
        <div className="dialog-media">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <span>{product.buttonIcon ?? brandGlyph(product.name)}</span>}</div>
        <h2>{product.name}</h2>
        <p>{product.description || "Thông tin giao hàng sẽ mở sau khi thanh toán thành công."}</p>
        <div className="detail-grid">
          <span>Giá</span><b>{formatVnd(product.price)}</b>
          <span>Kho</span><b>{product.deliveryType === "SHARED_CONTENT" ? "không giới hạn" : availableQuantity(product)}</b>
          <span>Nhận hàng</span><b>Hiển thị sau thanh toán</b>
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
        <p className="muted">Sau khi SePay báo tiền vào, hệ thống tự cộng ví hoặc hoàn tất đơn hàng. Thông tin nhận hàng chỉ hiển thị khi đơn đã thanh toán thành công.</p>
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

function Footer({ onTab }: { onTab: (tab: Tab) => void }) {
  return (
    <footer>
      <span>VD AI Shop</span>
      <span>Thông minh - tiện lợi - uy tín</span>
      <button onClick={() => onTab("products")}>Xem sản phẩm</button>
      <a href="https://t.me/vanhdao99">Telegram @vanhdao99</a>
    </footer>
  );
}

function postPaymentLabel(type: Product["deliveryType"]) {
  if (type === "STOCK_ITEM") return "Nhận sau thanh toán";
  if (type === "SHARED_CONTENT") return "Mở sau thanh toán";
  return "Xử lý sau thanh toán";
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
  if (lower.includes("cursor")) return "❌";
  if (lower.includes("grok")) return "◩";
  if (lower.includes("netflix")) return "🎞️";
  return "🛍️";
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
