import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BadgeCheck,
  Headphones,
  History,
  Home,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MessageCircle,
  PackageCheck,
  Phone,
  QrCode,
  RefreshCw,
  Search,
  Send,
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
  formatUsdt,
  formatVnd,
  History as StoreHistory,
  PaymentResult,
  PaymentStatusResult,
  Product,
  Session,
  StoreApi,
  WalletPurchaseResult
} from "./api";
import "./styles.css";

const TOKEN_KEY = "vd_store_token";
const LANGUAGE_KEY = "vd_store_language";
const savedToken = readStoredToken();
const api = new StoreApi(savedToken);
type Tab = "home" | "products" | "history";
type Language = "vi" | "en";
const initialTab = readInitialTab();
type DeliveryNotice = {
  title: string;
  deliveryText: string;
  balanceAfter?: number;
  order?: {
    code: string;
    status?: string;
    quantity: number;
    totalAmount: number;
    deliveryText?: string | null;
    product?: { name: string; deliveryType?: Product["deliveryType"] };
  };
};

/* ─── Scroll Reveal Observer ──────────────────────────────── */

function useReveal() {
  const observed = useRef(new Set<Element>());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    function observe() {
      const elements = document.querySelectorAll(".reveal:not(.visible)");
      elements.forEach((el) => {
        if (!observed.current.has(el)) {
          observed.current.add(el);
          observer.observe(el);
        }
      });
    }

    observe();
    const timer = window.setInterval(observe, 400);
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
    };
  }, []);
}

/* ─── Dialog Close Hook (ESC + click-outside) ─────────────── */

function useDialogClose(onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleOverlayClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return { dialogRef, handleOverlayClick };
}
/* ─── App ─────────────────────────────────────────────────── */

function App() {
  const [token, setToken] = useState(savedToken);
  const [customer, setCustomer] = useState<Session["customer"] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [history, setHistory] = useState<StoreHistory | null>(null);
  const [balance, setBalance] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [qr, setQr] = useState<PaymentResult | null>(null);
  const [qrStatus, setQrStatus] = useState<PaymentStatusResult | null>(null);
  const [delivery, setDelivery] = useState<DeliveryNotice | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [loading, setLoading] = useState("boot");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [language, setLanguage] = useState<Language>(() => readStoredLanguage());

  useReveal();

  const products = useMemo(() => (catalog ? flattenCatalog(catalog) : []), [catalog]);
  const filteredProducts = useMemo(() => {
    const normalized = query.toLocaleLowerCase("vi-VN").trim();
    if (!normalized) return products;
    return products.filter((product) => `${localizedName(product, language)} ${localizedDescription(product, language) ?? ""}`.toLocaleLowerCase("vi-VN").includes(normalized));
  }, [products, query, language]);

  useEffect(() => {
    if (!selectedProduct) return;
    const freshProduct = products.find((product) => product.id === selectedProduct.id);
    if (freshProduct && freshProduct !== selectedProduct) setSelectedProduct(freshProduct);
  }, [products, selectedProduct]);

  function changeLanguage(next: Language) {
    setLanguage(next);
    localStorage.setItem(LANGUAGE_KEY, next);
  }

  useEffect(() => {
    api.setToken(token);
    void loadPublicData();
    if (token) void loadPrivateData();
    else setLoading("");
  }, [token]);

  useEffect(() => {
    const refresh = () => void loadPublicData();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!qr || !token) return;
    void checkPaymentStatus(false);
    const timer = window.setInterval(() => void checkPaymentStatus(false), 5000);
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
    persistSessionToken(session.token);
    api.setToken(session.token);
    setToken(session.token);
    setCustomer(session.customer);
    setAuthOpen(false);
  }

  function logout() {
    clearSessionToken();
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
      setQrStatus(null);
      setDelivery(null);
    });
  }

  async function buyWithWallet(product: Product, quantity = 1) {
    if (!requireLogin()) return;
    await runAction(`wallet:${product.id}`, async () => {
      const result = await api.post<WalletPurchaseResult>("/store/orders/wallet", { productId: product.id, quantity });
      setDelivery({
        title: "Mua hàng thành công",
        deliveryText: result.deliveryText,
        balanceAfter: result.balanceAfter,
        order: {
          code: result.order?.code ?? "",
          status: result.order?.status,
          quantity,
          totalAmount: product.price * quantity,
          deliveryText: result.deliveryText,
          product: {
            name: product.name,
            deliveryType: product.deliveryType
          }
        }
      });
      setQr(null);
      setQrStatus(null);
      setSelectedProduct(null);
      await loadPrivateData(false);
    });
  }

  async function buyWithBank(product: Product, quantity = 1) {
    if (!requireLogin()) return;
    await runAction(`bank:${product.id}`, async () => {
      setQr(await api.post<PaymentResult>("/store/orders/bank", { productId: product.id, quantity }));
      setQrStatus(null);
      setDelivery(null);
      setSelectedProduct(null);
    });
  }

  async function buyWithUsdt(product: Product, quantity = 1) {
    if (!requireLogin()) return;
    await runAction(`usdt:${product.id}`, async () => {
      setQr(await api.post<PaymentResult>("/store/orders/usdt", { productId: product.id, quantity }));
      setQrStatus(null);
      setDelivery(null);
      setSelectedProduct(null);
    });
  }

  async function checkPaymentStatus(showLoading = true) {
    if (!qr || !token) return;
    try {
      if (showLoading) setLoading("payment-status");
      const status = await api.get<PaymentStatusResult>(`/store/payments/${qr.code}`);
      setQrStatus(status);
      setBalance(status.balance);

      if (status.status === "PENDING") return;

      await loadPrivateData(false);

      if (status.kind === "TOPUP" && status.status === "SUCCEEDED") {
        setQr(null);
        setDelivery({
          title: "Nạp tiền thành công",
          deliveryText: `Đã cộng ${formatVnd(status.amount)} vào ví.`,
          balanceAfter: status.balance
        });
        return;
      }

      if (status.kind === "DIRECT_ORDER" && status.status === "SUCCEEDED" && status.order?.deliveryText) {
        setQr(null);
        setDelivery({
          title: "Mua hàng thành công",
          deliveryText: status.order.deliveryText,
          balanceAfter: status.balance,
          order: status.order
        });
        return;
      }

      if (status.status === "CREDITED_TO_WALLET") {
        setQr(null);
        setDelivery({
          title: "Tiền đã cộng vào ví",
          deliveryText: "Đơn hàng chưa thể giao tự động nên hệ thống đã cộng tiền vào ví của bạn.",
          balanceAfter: status.balance
        });
        return;
      }

      if (status.status === "MANUAL_REVIEW") {
        setQr(null);
        setDelivery({
          title: "Giao dịch cần kiểm tra",
          deliveryText: "Giao dịch đã được ghi nhận nhưng cần admin kiểm tra lại số tiền hoặc nội dung chuyển khoản.",
          balanceAfter: status.balance
        });
      }

      if (status.status === "EXPIRED" || status.status === "FAILED") {
        setQr(null);
        setDelivery({
          title: status.status === "EXPIRED" ? "QR đã hết hạn" : "Thanh toán thất bại",
          deliveryText:
            status.status === "EXPIRED"
              ? "Mã QR này đã quá thời gian 10 phút. Bạn có thể tạo QR mới để nạp ví hoặc mua hàng. Nếu chuyển khoản sau khi QR hết hạn, hệ thống vẫn ghi nhận và xử lý theo trạng thái giao dịch."
              : "Giao dịch chưa hoàn tất. Vui lòng tạo lại QR hoặc liên hệ hỗ trợ nếu bạn đã chuyển khoản.",
          balanceAfter: status.balance
        });
        return;
      }
    } catch (err) {
      if (showLoading) setError((err as Error).message);
    } finally {
      if (showLoading) setLoading("");
    }
  }

  function requireLogin() {
    if (token) return true;
    setAuthOpen(true);
    return false;
  }

  async function openProduct(product: Product) {
    await runAction(`product:${product.id}`, async () => {
      const freshProduct = await api.get<Product>(`/store/products/${product.id}`);
      setSelectedProduct({ ...product, ...freshProduct, category: freshProduct.category ?? product.category });
      await loadPublicData();
    });
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
      <Header customer={customer} balance={balance} activeTab={activeTab} language={language} onLanguage={changeLanguage} onTab={setActiveTab} onLogin={() => setAuthOpen(true)} onLogout={logout} onWalletOpen={() => { if (token) setWalletOpen(true); else setAuthOpen(true); }} />

      {activeTab === "home" ? (
        <HomeTab
          products={products.slice(0, 6)}
          loading={loading}
          language={language}
          onProduct={(product) => void openProduct(product)}
          onShop={() => setActiveTab("products")}
          onWallet={() => {
            if (token) setWalletOpen(true);
            else setAuthOpen(true);
          }}
        />
      ) : null}
      {activeTab === "products" ? (
        <ProductsTab
          products={filteredProducts}
          query={query}
          loading={loading}
          error={error}
          onQuery={setQuery}
          onView={(product) => void openProduct(product)}
          language={language}
        />
      ) : null}
      {activeTab === "history" ? (
        <section className="shell tab-shell">
          <HistoryPanel history={history} onRefresh={() => token && loadPrivateData()} loading={loading === "profile"} />
        </section>
      ) : null}

      <Footer onTab={setActiveTab} />

      {authOpen ? <AuthDialog onClose={() => setAuthOpen(false)} onSession={saveSession} /> : null}
      {walletOpen ? (
        <WalletDialog balance={balance} loading={loading} onTopup={createTopup} onClose={() => setWalletOpen(false)} />
      ) : null}
      {selectedProduct ? (
        <ProductDialog
          product={selectedProduct}
          loading={loading}
          onClose={() => setSelectedProduct(null)}
          onWallet={(quantity) => buyWithWallet(selectedProduct, quantity)}
          onBank={(quantity) => buyWithBank(selectedProduct, quantity)}
          onUsdt={(quantity) => buyWithUsdt(selectedProduct, quantity)}
          language={language}
        />
      ) : null}
      <FloatingCtas />
      {qr ? (
        <QrDialog
          payment={qr}
          status={qrStatus}
          loading={loading === "payment-status"}
          onClose={() => setQr(null)}
          onRefresh={() => checkPaymentStatus(true)}
        />
      ) : null}
      {delivery ? <DeliveryDialog delivery={delivery} onClose={() => setDelivery(null)} /> : null}
      {loading === "boot" ? <div className="boot"><Loader2 className="spin" /> Đang mở VD AI Shop</div> : null}
    </main>
  );
}

/* ─── Header ──────────────────────────────────────────────── */

function Header({
  customer,
  balance,
  activeTab,
  language,
  onLanguage,
  onTab,
  onLogin,
  onLogout,
  onWalletOpen
}: {
  customer: Session["customer"] | null;
  balance: number;
  activeTab: Tab;
  language: Language;
  onLanguage: (language: Language) => void;
  onTab: (tab: Tab) => void;
  onLogin: () => void;
  onLogout: () => void;
  onWalletOpen: () => void;
}) {
  const navItems: Array<{ tab: Tab; label: string; icon: React.ReactNode }> = [
    { tab: "home", label: "Home", icon: <Home size={16} /> },
    { tab: "products", label: "Sản phẩm", icon: <ShoppingBag size={16} /> },
    { tab: "history", label: "Lịch sử", icon: <History size={16} /> }
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
        <button className="ghost-button lang-switch" onClick={() => onLanguage(language === "vi" ? "en" : "vi")}>
          {language === "vi" ? "EN" : "VI"}
        </button>
        {customer ? (
          <>
            <span className="customer-pill">
              <UserRound size={15} /> {customer.displayName ?? customer.email}
              <button className="balance-pill" onClick={onWalletOpen} title="Nạp ví">
                <Wallet size={14} />{formatVnd(balance)}
              </button>
            </span>
            <button className="icon-button" onClick={onLogout} aria-label="Đăng xuất">
              <LogOut size={17} />
            </button>
          </>
        ) : (
          <button className="primary-button" onClick={onLogin}>
            <KeyRound size={17} /> Đăng nhập
          </button>
        )}
      </div>
    </header>
  );
}

/* ─── Home Tab ────────────────────────────────────────────── */

function HomeTab({
  products,
  loading,
  language,
  onProduct,
  onShop,
  onWallet
}: {
  products: Product[];
  loading: string;
  language: Language;
  onProduct: (product: Product) => void;
  onShop: () => void;
  onWallet: () => void;
}) {
  return (
    <>
      <Hero onShop={onShop} onWallet={onWallet} />
      <FeaturedProducts products={products} loading={loading} language={language} onProduct={onProduct} onShop={onShop} />
      <TrustShowcase />
      <HowItWorks onShop={onShop} onWallet={onWallet} />
      <BrandShowcase />
      <MerchantInfo />
      <PolicySections />
    </>
  );
}

/* ─── Hero ────────────────────────────────────────────────── */

function Hero({ onShop, onWallet }: { onShop: () => void; onWallet: () => void }) {
  return (
    <section className="hero">
      <div className="hero-backdrop" />
      <div className="hero-content reveal">
        <img className="hero-logo" src="/logo.png" alt="VD AI Shop" />
        <p className="eyebrow">Tài khoản AI Premium &middot; Tự động 24/7 &middot; Bảo hành uy tín</p>
        <h1>VD AI Shop</h1>
        <p className="hero-text">
          Cung cấp tài khoản ChatGPT Plus, Claude Pro, Gemini Advanced và key bản quyền phần mềm chính hãng hàng đầu Việt Nam. Tự động hóa hoàn toàn, kích hoạt siêu tốc trong 30 giây giúp nâng tầm hiệu suất công việc của bạn.
        </p>
        <div className="hero-actions">
          <button className="primary-button" onClick={onShop}>
            <ShoppingBag size={18} /> Xem sản phẩm
          </button>
          <button className="ghost-button" onClick={onWallet}>
            <QrCode size={18} /> Nạp ví
          </button>
        </div>
        <div className="hero-proofline" aria-label="Tín hiệu tin cậy">
          <span>Giao hàng tự động 24/7</span>
          <span>Chính hãng 100%</span>
          <span>Bảo hành 1-đổi-1</span>
        </div>
        <div className="hero-stats" style={{ "--d": "200ms" } as React.CSSProperties}>
          <span><ShieldCheck size={16} /> Tiết kiệm đến 70%</span>
          <span><TimerReset size={16} /> Hỗ trợ kỹ thuật 24/7</span>
          <span><PackageCheck size={16} /> Thanh toán VietQR an toàn</span>
        </div>
      </div>
      <div className="hero-motion" aria-hidden="true">
        <div className="checkout-stage">
          <div className="stage-card stage-product">
            <span>ChatGPT Plus</span>
            <b>250.000 d</b>
            <i>5 còn lại</i>
          </div>
          <div className="stage-card stage-qr">
            <span>DH_AUTO</span>
            <div className="qr-matrix">
              {Array.from({ length: 36 }).map((_, index) => (
                <i key={index} />
              ))}
            </div>
            <b>10 phút</b>
          </div>
          <div className="stage-card stage-ledger">
            <span>VD AI Shop</span>
            <b>Tự động 24/7</b>
            <i>Giao hàng tức thì</i>
          </div>
        </div>
        <div className="route-map">
          <span>Chọn hàng</span>
          <span>Quét QR</span>
          <span>Kích hoạt</span>
          <span>Nhận hàng</span>
        </div>
      </div>
    </section>
  );
}

/* ─── Trust Showcase ──────────────────────────────────────── */

function TrustShowcase() {
  const cards = [
    { icon: <BadgeCheck />, title: "Sức mạnh AI Tối thượng", text: "Truy cập không giới hạn GPT-4o, Claude 3.5 Sonnet, Gemini Advanced. Phản hồi siêu tốc, hỗ trợ lập trình, phân tích dữ liệu chuyên nghiệp." },
    { icon: <Zap />, title: "Sáng tạo & Giải trí Đỉnh cao", text: "Mở khóa kho tài nguyên khổng lồ của Canva Pro, Adobe Creative Cloud, CapCut Pro hay YouTube Premium không quảng cáo chất lượng cao." },
    { icon: <Headphones />, title: "Hỗ trợ Kỹ thuật 24/7", text: "Đội ngũ kỹ thuật túc trực sẵn sàng hỗ trợ cài đặt, kích hoạt và giải quyết mọi thắc mắc của khách hàng bất cứ lúc nào." },
    { icon: <ShieldCheck />, title: "Bảo hành 1-đổi-1 Uy tín", text: "Cam kết tài khoản hoạt động ổn định, chính hãng 100%. Chính sách bảo hành 1-đổi-1 rõ ràng trong suốt thời gian sử dụng dịch vụ." }
  ];

  return (
    <section className="shell trust-showcase">
      <div className="section-head compact">
        <div>
          <p className="eyebrow reveal">Giá trị vượt trội</p>
          <h2 className="reveal" style={{ "--d": "80ms" } as React.CSSProperties}>Giải pháp Premium nâng tầm năng suất công việc và học tập</h2>
        </div>
      </div>
      <div className="trust-strip reveal" style={{ "--d": "120ms" } as React.CSSProperties} aria-label="Cam kết vận hành">
        <span>Chính hãng 100%</span>
        <span>Giao hàng tự động</span>
        <span>Bảo hành trọn vẹn</span>
        <span>Hỗ trợ tận tâm</span>
      </div>
      <div className="trust-grid">
        {cards.map((card, index) => (
          <article className="trust-card reveal" style={{ "--d": `${160 + index * 80}ms` } as React.CSSProperties} key={card.title}>
            {card.icon}
            <h3>{card.title}</h3>
            <p>{card.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FeaturedProducts({
  products,
  loading,
  language,
  onProduct,
  onShop
}: {
  products: Product[];
  loading: string;
  language: Language;
  onProduct: (product: Product) => void;
  onShop: () => void;
}) {
  return (
    <section className="shell featured-products" id="featured-products">
      <div className="section-head compact">
        <div>
          <p className="eyebrow reveal">Sản phẩm đang bán</p>
          <h2 className="reveal" style={{ "--d": "80ms" } as React.CSSProperties}>Tài khoản AI, phần mềm và dịch vụ số có giá niêm yết rõ ràng</h2>
          <p className="product-section-copy reveal" style={{ "--d": "140ms" } as React.CSSProperties}>
            Mỗi sản phẩm có giá, tồn kho, phương thức nhận hàng và lịch sử đơn hàng minh bạch. Thông tin giao hàng chỉ mở sau khi thanh toán thành công.
          </p>
        </div>
        <button className="ghost-button reveal" onClick={onShop} style={{ "--d": "180ms" } as React.CSSProperties}>
          Xem tất cả <ArrowRight size={17} />
        </button>
      </div>
      <div className="product-grid compact-grid">
        {products.length ? (
          products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              loading={loading}
              language={language}
              onView={() => onProduct(product)}
            />
          ))
        ) : (
          <div className="empty-state">Danh sách sản phẩm đang được tải. Có thể xem đầy đủ tại tab Sản phẩm.</div>
        )}
      </div>
    </section>
  );
}

/* ─── How It Works ────────────────────────────────────────── */

function HowItWorks({ onShop, onWallet }: { onShop: () => void; onWallet: () => void }) {
  const steps = [
    ["1", "Lựa chọn dịch vụ", "Khám phá danh mục sản phẩm AI, thiết kế đồ họa hoặc giải trí và chọn gói phù hợp nhất."],
    ["2", "Quét QR siêu tốc", "QR thanh toán tự động được tạo ngay lập tức với số tiền chính xác, xử lý giao dịch tức thì."],
    ["3", "Xác thực tự động", "Giao dịch được xác minh tự động chỉ trong 5-10 giây, không cần chờ đợi xác nhận thủ công."],
    ["4", "Nhận hàng & Sử dụng", "Thông tin tài khoản/key kèm hướng dẫn sử dụng chi tiết hiển thị trực tiếp và gửi qua Telegram."]
  ];

  return (
    <section className="shell flow-section">
      <div className="flow-copy reveal">
        <h2>Hệ thống mua sắm tự động hóa, an toàn và bảo mật tối đa</h2>
        <p>
          Chúng tôi mang đến giải pháp sở hữu Premium account dễ dàng nhất. Mọi đơn hàng và số dư ví được lưu trữ minh bạch, hỗ trợ quản lý đồng bộ qua bot Telegram giúp bạn tra cứu lịch sử mua hàng mọi lúc mọi nơi.
        </p>
        <div className="flow-actions">
          <button className="primary-button" onClick={onShop}>Mua ngay <ArrowRight size={17} /></button>
          <button className="ghost-button" onClick={onWallet}>Nạp ví <Wallet size={17} /></button>
        </div>
      </div>
      <div className="timeline">
        {steps.map(([number, title, text], index) => (
          <article className="timeline-item reveal" style={{ "--d": `${index * 100}ms` } as React.CSSProperties} key={title}>
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

/* ─── Brand Showcase ──────────────────────────────────────── */

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
          {brands.map((brand) => (
            <span key={brand}>{brand}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Products Tab ────────────────────────────────────────── */

function MerchantInfo() {
  const contacts = [
    { label: "Email hỗ trợ", value: "vietanh.dao99@gmail.com", href: "mailto:vietanh.dao99@gmail.com", icon: <Mail size={18} /> },
    { label: "Zalo", value: "0377952999", href: "https://zalo.me/0377952999", icon: <Phone size={18} /> },
    { label: "Telegram", value: "@vanhdao99", href: "https://t.me/vanhdao99", icon: <Send size={18} /> }
  ];
  return (
    <section className="shell merchant-section" id="contact">
      <div className="merchant-panel reveal">
        <div>
          <p className="eyebrow">Thông tin cửa hàng</p>
          <h2>VD AI Shop cung cấp dịch vụ số có hỗ trợ trực tiếp</h2>
          <p>
            VD AI Shop là cửa hàng trực tuyến bán tài khoản AI, tài khoản premium, key phần mềm và dịch vụ số. Khách hàng có thể mua trên website hoặc Telegram bot, thanh toán bằng VietQR, ví nội bộ hoặc USDT khi cổng thanh toán được kích hoạt.
          </p>
          <p>
            Thời gian hỗ trợ: 08:00 đến 23:00 hằng ngày theo giờ Việt Nam. Các đơn cần xử lý thủ công sẽ được hướng dẫn liên hệ admin sau khi thanh toán thành công.
          </p>
        </div>
        <div className="contact-cards" aria-label="Thông tin liên hệ VD AI Shop">
          {contacts.map((contact) => (
            <a href={contact.href} target={contact.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" key={contact.label}>
              {contact.icon}
              <span>{contact.label}</span>
              <b>{contact.value}</b>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function PolicySections() {
  const policies = [
    {
      id: "delivery-policy",
      title: "Chính sách giao hàng",
      text: "Sản phẩm dạng mã, tài khoản hoặc nội dung số sẽ được giao tự động sau khi hệ thống xác nhận thanh toán. Sản phẩm cần xử lý riêng sẽ hiển thị mã đơn và hướng dẫn liên hệ admin."
    },
    {
      id: "refund-policy",
      title: "Chính sách hoàn tiền",
      text: "Nếu đơn hết hàng, thanh toán sai nội dung, thanh toán quá hạn hoặc không thể giao đúng sản phẩm, hệ thống sẽ cộng tiền về ví hoặc admin xử lý hoàn tiền theo từng trường hợp."
    },
    {
      id: "terms",
      title: "Điều khoản sử dụng",
      text: "Khách hàng cần kiểm tra kỹ tên sản phẩm, số lượng và giá trước khi thanh toán. Sản phẩm số đã giao thành công không đổi trả nếu thông tin hoạt động đúng mô tả."
    },
    {
      id: "privacy",
      title: "Bảo mật thông tin",
      text: "Website chỉ lưu thông tin cần thiết để tạo tài khoản, xử lý thanh toán, giao hàng và hỗ trợ đơn hàng. Thông tin thanh toán được dùng để đối soát giao dịch và không bán cho bên thứ ba."
    }
  ];
  return (
    <section className="shell policy-section" id="policies">
      <div className="section-head compact">
        <div>
          <p className="eyebrow reveal">Minh bạch giao dịch</p>
          <h2 className="reveal" style={{ "--d": "80ms" } as React.CSSProperties}>Chính sách mua hàng, giao hàng và hoàn tiền</h2>
        </div>
      </div>
      <div className="policy-grid">
        {policies.map((policy, index) => (
          <article id={policy.id} className="policy-card reveal" style={{ "--d": `${120 + index * 70}ms` } as React.CSSProperties} key={policy.id}>
            <h3>{policy.title}</h3>
            <p>{policy.text}</p>
          </article>
        ))}
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
  language
}: {
  products: Product[];
  query: string;
  loading: string;
  error: string;
  onQuery: (value: string) => void;
  onView: (product: Product) => void;
  language: Language;
}) {
  return (
    <section className="shell product-section">
      <div className="section-head">
        <div>
          <p className="eyebrow reveal">Sản phẩm Premium</p>
          <h2 className="reveal" style={{ "--d": "60ms" } as React.CSSProperties}>Mở khóa Trí tuệ Nhân tạo & Sáng tạo</h2>
          <p className="product-section-copy reveal" style={{ "--d": "120ms" } as React.CSSProperties}>
            Danh sách tài khoản premium ChatGPT, Claude, Gemini, Canva, Adobe chính hãng được tuyển chọn để tăng tốc hiệu năng làm việc, tiết kiệm tối đa chi phí.
          </p>
        </div>
        <div className="search-box">
          <Search size={17} />
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
            language={language}
          />
        ))}
      </div>
      {!products.length ? <div className="empty-state">Chưa có sản phẩm phù hợp.</div> : null}
    </section>
  );
}

/* ─── Product Card ────────────────────────────────────────── */

function ProductCard({
  product,
  loading,
  onView,
  language
}: {
  product: Product;
  loading: string;
  onView: () => void;
  language: Language;
}) {
  const stock = availableQuantity(product);
  const disabled = stock <= 0;
  const opening = loading === `product:${product.id}`;
  const imageSrc = productArtUrl(product);
  const stockLabel = product.deliveryType === "SHARED_CONTENT" ? "Không giới hạn" : `${stock} còn lại`;
  return (
    <article className="product-card reveal">
      <div className="product-media">
        {imageSrc ? <img src={imageSrc} alt={`${product.name} tại VD AI Shop`} loading="lazy" referrerPolicy="no-referrer" /> : <span>{brandGlyph(product.name)}</span>}
      </div>
      <div className="product-body">
        <div className="product-kicker">
          <span>{product.category?.name ?? "Sản phẩm số"}</span>
          <span className={disabled ? "stock-empty" : ""}>{stockLabel}</span>
        </div>
        <h3>{localizedName(product, language)}</h3>
        <p>{localizedDescription(product, language) || "Delivery information appears after successful payment."}</p>
        <div className="product-summary">
          <strong>{formatProductPrice(product, language)}</strong>
          <span>{postPaymentLabel(product.deliveryType)}</span>
        </div>
      </div>
      <div className="product-actions">
        <button onClick={onView} disabled={opening}>{opening ? <Loader2 className="spin" size={15} /> : <Search size={15} />} Chi tiết</button>
        <button onClick={onView} disabled={opening || loading === `wallet:${product.id}` || loading === `bank:${product.id}` || disabled}>
          {opening || loading === `wallet:${product.id}` || loading === `bank:${product.id}` ? <Loader2 className="spin" size={15} /> : <ShoppingBag size={15} />}
          Mua hàng
        </button>
      </div>
    </article>
  );
}

/* ─── Wallet Dialog ───────────────────────────────────────── */

function WalletDialog({
  balance,
  loading,
  onTopup,
  onClose
}: {
  balance: number;
  loading: string;
  onTopup: (amount: number) => void;
  onClose: () => void;
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

  const { handleOverlayClick } = useDialogClose(onClose);

  return (
    <div className="overlay" onClick={handleOverlayClick}>
      <div className="dialog">
        <button className="close" onClick={onClose}>&times;</button>
        <h2>Ví VD</h2>
        <p className="muted">Số dư dùng để mua nhanh mà không cần quét QR từng đơn.</p>
        <div className="wallet-number">{formatVnd(balance)}</div>
        <div className="amount-grid">
          {amounts.map((amount) => (
            <button key={amount} onClick={() => onTopup(amount)} disabled={loading === "topup"}>
              {loading === "topup" ? <Loader2 className="spin" size={15} /> : null}
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
              {loading === "topup" ? <Loader2 className="spin" size={17} /> : <QrCode size={17} />}
              Tạo QR
            </button>
          </div>
          {amountError ? <p className="field-error">{amountError}</p> : <p className="muted">Nhập số tiền muốn nạp, hệ thống sẽ tạo QR VietQR theo đúng số tiền đó.</p>}
        </form>
      </div>
    </div>
  );
}

/* ─── History Panel ───────────────────────────────────────── */

function HistoryPanel({ history, onRefresh, loading }: { history: StoreHistory | null; onRefresh: () => void; loading: boolean }) {
  return (
    <section className="panel history-panel reveal" id="history">
      <div className="panel-title">
        <History />
        <div>
          <h2>Lịch sử</h2>
          <p>Đơn hàng và biến động ví gần nhất.</p>
        </div>
        <button className="icon-button" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={loading ? "spin" : ""} size={17} />
        </button>
      </div>
      <div className="history-list">
        {history?.orders.length ? (
          history.orders.slice(0, 8).map((order) => (
            <div className="history-row" key={order.code}>
              <div>
                <span>{order.product.name}</span>
                <div className="history-order-meta">
                  <b>Mã đơn: {order.code}</b>
                  <b>SL: {order.quantity}</b>
                  <b>{new Date(order.createdAt).toLocaleString("vi-VN")}</b>
                </div>
                <pre className="history-order-copy">{buildOrderCopyText(order)}</pre>
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

/* ─── Auth Dialog ─────────────────────────────────────────── */

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

  const { handleOverlayClick } = useDialogClose(onClose);

  return (
    <div className="overlay auth-overlay" onClick={handleOverlayClick}>
      <div className="dialog auth-dialog">
        <button className="close" onClick={onClose}>&times;</button>
        <h2>{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</h2>
        <form onSubmit={submit}>
          {mode === "register" ? <input name="name" placeholder="Tên hiển thị" /> : null}
          <input name="email" type="email" placeholder="Email" required />
          <input name="password" type="password" minLength={6} placeholder="Mật khẩu" required />
          {error ? <div className="alert">{error}</div> : null}
          <button className="primary-button" disabled={loading}>
            {loading ? <Loader2 className="spin" size={17} /> : <KeyRound size={17} />}
            {mode === "login" ? "Đăng nhập" : "Đăng ký"}
          </button>
        </form>
        <button className="link-button" onClick={() => setMode(mode === "login" ? "register" : "login")} style={{ marginTop: 14 }}>
          {mode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
        </button>
      </div>
    </div>
  );
}

/* ─── Product Dialog ──────────────────────────────────────── */

function ProductDialog({
  product,
  loading,
  onClose,
  onWallet,
  onBank,
  onUsdt,
  language
}: {
  product: Product;
  loading: string;
  onClose: () => void;
  onWallet: (quantity: number) => void;
  onBank: (quantity: number) => void;
  onUsdt: (quantity: number) => void;
  language: Language;
}) {
  const stock = availableQuantity(product);
  const maxQuantity = product.deliveryType === "SHARED_CONTENT" ? 999 : stock;
  const [quantity, setQuantity] = useState(1);
  const invalidQuantity = quantity < 1 || quantity > maxQuantity;
  const imageSrc = productArtUrl(product);
  const deliveryLabel = postPaymentLabel(product.deliveryType);

  const { handleOverlayClick } = useDialogClose(onClose);

  return (
    <div className="overlay" onClick={handleOverlayClick}>
      <div className="dialog product-dialog">
        <button className="close" onClick={onClose}>&times;</button>
        <div className="dialog-media">
          {imageSrc ? <img src={imageSrc} alt={`${product.name} - VD AI Shop`} referrerPolicy="no-referrer" /> : <span>{brandGlyph(product.name)}</span>}
        </div>
        <div className="dialog-heading">
          <span>{product.category?.name ?? "Sản phẩm số"}</span>
          <h2>{localizedName(product, language)}</h2>
          <p>{localizedDescription(product, language) || "Delivery information appears after successful payment."}</p>
        </div>
        <div className="detail-grid">
          <div>
            <span>Giá</span>
            <b>{formatProductPrice(product, language)}</b>
          </div>
          <div>
            <span>Kho</span>
            <b>{product.deliveryType === "SHARED_CONTENT" ? "Không giới hạn" : availableQuantity(product)}</b>
          </div>
          <div>
            <span>Nhận hàng</span>
            <b>{deliveryLabel}</b>
          </div>
        </div>
        <div className="quantity-box">
          <div className="quantity-head">
            <label htmlFor="order-quantity">Số lượng</label>
            <span>Tối đa {maxQuantity}</span>
          </div>
          <div className="quantity-stepper">
            <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>&#8722;</button>
            <input
              id="order-quantity"
              inputMode="numeric"
              min={1}
              max={maxQuantity}
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value.replace(/[^\d]/g, "")) || 1)}
            />
            <button type="button" onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))}>+</button>
          </div>
          <div className="quantity-total">
            <span>Tổng thanh toán</span>
            <b>{formatProductTotal(product, quantity, language)}</b>
          </div>
        </div>
        <div className="dialog-actions">
          <button className="primary-button" onClick={() => onWallet(quantity)} disabled={loading === `wallet:${product.id}` || invalidQuantity}>
            {loading === `wallet:${product.id}` ? <Loader2 className="spin" size={17} /> : <Wallet size={17} />} Mua bằng ví
          </button>
          <button className="ghost-button" onClick={() => onUsdt(quantity)} disabled={loading === `usdt:${product.id}` || invalidQuantity || !product.usdtPrice}>
            {loading === `usdt:${product.id}` ? <Loader2 className="spin" size={17} /> : <QrCode size={17} />} USDT Cryptomus
          </button>
          <button className="ghost-button" onClick={() => onBank(quantity)} disabled={loading === `bank:${product.id}` || invalidQuantity}>
            {loading === `bank:${product.id}` ? <Loader2 className="spin" size={17} /> : <QrCode size={17} />} Chuyển khoản QR
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── QR Dialog ───────────────────────────────────────────── */

function QrDialog({
  payment,
  status,
  loading,
  onClose,
  onRefresh
}: {
  payment: PaymentResult;
  status: PaymentStatusResult | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { handleOverlayClick } = useDialogClose(onClose);

  return (
    <div className="overlay" onClick={handleOverlayClick}>
      <div className="dialog qr-dialog">
        <button className="close" onClick={onClose}>&times;</button>
        <h2>Quét QR thanh toán</h2>
        {payment.qrImageUrl ? <img className="qr-image" src={payment.qrImageUrl} alt={`QR ${payment.code}`} /> : null}
        {payment.checkoutUrl ? (
          <a className="primary-button" href={payment.checkoutUrl} target="_blank" rel="noreferrer" style={{ width: "100%", justifyContent: "center" }}>
            Open Cryptomus invoice
          </a>
        ) : null}
        <div className="detail-grid">
          <span>Mã</span><b>{payment.code}</b>
          <span>Số tiền</span><b>{payment.cryptoCurrency === "USDT" ? formatUsdt(payment.cryptoAmount) : formatVnd(payment.amount)}</b>
          {payment.network ? (
            <>
              <span>Network</span><b>{payment.network.toUpperCase()}</b>
            </>
          ) : null}
          {payment.address ? (
            <>
              <span>Địa chỉ ví</span><b className="break-all">{payment.address}</b>
            </>
          ) : null}
          <span>Hạn</span><b>{new Date(payment.expiresAt).toLocaleTimeString("vi-VN")}</b>
          <span>Trạng thái</span><b>{statusLabel(status?.status ?? "PENDING")}</b>
        </div>
        <p className="muted">VND được đối soát qua SePay. USDT được đối soát qua Cryptomus webhook. Thông tin nhận hàng chỉ hiển thị khi đơn đã thanh toán thành công.</p>
        <button className="ghost-button" onClick={onRefresh} disabled={loading} style={{ width: "100%", marginTop: 12 }}>
          <RefreshCw className={loading ? "spin" : ""} size={17} /> Kiểm tra trạng thái
        </button>
      </div>
    </div>
  );
}

/* ─── Delivery Dialog ─────────────────────────────────────── */

function DeliveryDialog({ delivery, onClose }: { delivery: DeliveryNotice; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const orderCopyText = delivery.order ? buildOrderCopyText(delivery.order) : "";
  const isManualOrder = delivery.order?.product?.deliveryType === "MANUAL";

  async function copyOrder() {
    if (!orderCopyText) return;
    try {
      await navigator.clipboard.writeText(orderCopyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const { handleOverlayClick } = useDialogClose(onClose);

  return (
    <div className="overlay" onClick={handleOverlayClick}>
      <div className="dialog">
        <button className="close" onClick={onClose}>&times;</button>
        <h2>{delivery.title}</h2>
        {delivery.balanceAfter !== undefined ? <p>Số dư hiện tại: <b>{formatVnd(delivery.balanceAfter)}</b></p> : null}
        {isManualOrder ? (
          <div className="manual-contact-hint">
            Sản phẩm này cần admin giao thủ công. Bạn hãy bấm nút <b>Zalo</b> ở góc phải bên dưới, gửi kèm thông tin đơn hàng này để admin kiểm tra và giao hàng.
          </div>
        ) : null}
        {delivery.order ? (
          <div className="order-copy-card">
            <div>
              <span>Thông tin đơn hàng</span>
              <button className="ghost-button" onClick={copyOrder}>{copied ? "Đã copy" : "Copy gửi admin"}</button>
            </div>
            <pre>{orderCopyText}</pre>
          </div>
        ) : null}
        <pre className="delivery-box">{delivery.deliveryText}</pre>
      </div>
    </div>
  );
}

/* ─── Floating CTAs ───────────────────────────────────────── */

function FloatingCtas() {
  return (
    <div className="floating-ctas" aria-label="Liên hệ nhanh">
      <a href="https://zalo.me/0377952999" target="_blank" rel="noreferrer">
        <MessageCircle size={16} /> Zalo
      </a>
      <a href="https://www.facebook.com/vanh.dao.735/" target="_blank" rel="noreferrer">
        <span className="brand-letter">f</span> Facebook
      </a>
      <a href="https://t.me/vanhdao99" target="_blank" rel="noreferrer">
        <Send size={16} /> Telegram
      </a>
    </div>
  );
}

/* ─── Footer ──────────────────────────────────────────────── */

function Footer({ onTab }: { onTab: (tab: Tab) => void }) {
  return (
    <footer>
      <div>
        <span>VD AI Shop</span>
        <small>Tài khoản AI, premium account, key phần mềm và dịch vụ số.</small>
      </div>
      <nav aria-label="Liên kết thông tin cửa hàng">
        <button onClick={() => onTab("products")}>Sản phẩm</button>
        <a href="#contact">Liên hệ</a>
        <a href="#delivery-policy">Giao hàng</a>
        <a href="#refund-policy">Hoàn tiền</a>
        <a href="#terms">Điều khoản</a>
        <a href="#privacy">Bảo mật</a>
      </nav>
      <div className="footer-contact">
        <a href="mailto:vietanh.dao99@gmail.com">vietanh.dao99@gmail.com</a>
        <a href="https://zalo.me/0377952999" target="_blank" rel="noreferrer">Zalo 0377952999</a>
        <a href="https://t.me/vanhdao99" target="_blank" rel="noreferrer">Telegram @vanhdao99</a>
      </div>
    </footer>
  );
}

/* ─── Utility Functions (unchanged logic) ─────────────────── */

function postPaymentLabel(type: Product["deliveryType"]) {
  if (type === "STOCK_ITEM") return "Nhận sau thanh toán";
  if (type === "SHARED_CONTENT") return "Mở sau thanh toán";
  return "Xử lý sau thanh toán";
}

function statusLabel(status: PaymentStatusResult["status"]) {
  const labels: Record<PaymentStatusResult["status"], string> = {
    PENDING: "Đang chờ thanh toán",
    SUCCEEDED: "Đã thanh toán",
    EXPIRED: "Đã hết hạn",
    FAILED: "Thất bại",
    CREDITED_TO_WALLET: "Đã cộng vào ví",
    MANUAL_REVIEW: "Cần admin kiểm tra"
  };
  return labels[status];
}

function buildOrderCopyText(order: {
  code: string;
  status?: string;
  quantity: number;
  totalAmount: number;
  deliveryText?: string | null;
  product?: { name: string; deliveryType?: Product["deliveryType"] };
}) {
  return [
    `Mã đơn: ${order.code || "Đang cập nhật"}`,
    `Sản phẩm: ${order.product?.name ?? "Đang cập nhật"}`,
    `Số lượng: ${order.quantity}`,
    `Tổng tiền: ${formatVnd(order.totalAmount)}`,
    order.status ? `Trạng thái: ${order.status}` : null,
    order.product?.deliveryType === "MANUAL" ? "Yêu cầu: Nhận hàng thủ công qua admin/Zalo" : null
  ]
    .filter(Boolean)
    .join("\n");
}

function readStoredToken() {
  return readCookie(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
}

function readInitialTab(): Tab {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "products" || tab === "history" ? tab : "home";
}

function readStoredLanguage(): Language {
  return localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "vi";
}

function localizedName(product: Product, language: Language) {
  return language === "en" ? product.nameEn?.trim() || product.name : product.name;
}

function localizedDescription(product: Product, language: Language) {
  return language === "en" ? product.descriptionEn?.trim() || product.description : product.description;
}

function formatProductPrice(product: Product, language: Language) {
  return language === "en" && product.usdtPrice ? formatUsdt(product.usdtPrice) : formatVnd(product.price);
}

function formatProductTotal(product: Product, quantity: number, language: Language) {
  return language === "en" && product.usdtPrice ? formatUsdt(Number(product.usdtPrice) * quantity) : formatVnd(product.price * quantity);
}

function persistSessionToken(token: string) {
  const maxAge = 60 * 60 * 24 * 400;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  localStorage.setItem(TOKEN_KEY, token);
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

function clearSessionToken() {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  localStorage.removeItem(TOKEN_KEY);
  document.cookie = `${TOKEN_KEY}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  const cookie = document.cookie.split("; ").find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

function brandTone(name: string) {
  const lower = name.toLocaleLowerCase("vi-VN");
  if (lower.includes("chatgpt") || lower.includes("openai")) return "openai";
  if (lower.includes("claude")) return "claude";
  if (lower.includes("gemini") || lower.includes("gemeni")) return "gemini";
  if (lower.includes("canva")) return "canva";
  if (lower.includes("youtube")) return "youtube";
  if (lower.includes("adobe")) return "adobe";
  if (lower.includes("capcut")) return "capcut";
  if (lower.includes("grok")) return "grok";
  if (lower.includes("cursor")) return "cursor";
  return "default";
}

function productArtUrl(product: Product) {
  const brand = brandTone(product.name);
  const imageUrl = product.imageUrl?.trim();
  if (imageUrl?.includes("/product-art/")) return `/product-art/${brand}.svg?v=20260529b`;
  if (imageUrl) return imageUrl;
  return `/product-art/${brand}.svg?v=20260529b`;
}

function brandGlyph(name: string) {
  const lower = name.toLocaleLowerCase("vi-VN");
  if (lower.includes("chatgpt") || lower.includes("openai")) return "\u{1F916}";
  if (lower.includes("claude")) return "\u{1F7EB}";
  if (lower.includes("gemini") || lower.includes("gemeni")) return "\u2726";
  if (lower.includes("adobe")) return "\u{1F170}\uFE0F";
  if (lower.includes("capcut")) return "\u{1F3AC}";
  if (lower.includes("youtube")) return "\u25B6\uFE0F";
  if (lower.includes("canva")) return "\u{1F7E3}";
  if (lower.includes("cursor")) return "\u274C";
  if (lower.includes("grok")) return "\u25E9";
  if (lower.includes("netflix")) return "\u{1F39E}\uFE0F";
  return "\u{1F6CD}\uFE0F";
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
