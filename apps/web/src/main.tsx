import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Copy,
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
const TEXT = {
  vi: {
    navHome: "Home",
    navProducts: "Sản phẩm",
    navHistory: "Lịch sử",
    login: "Đăng nhập",
    logout: "Đăng xuất",
    topupTitle: "Nạp ví",
    boot: "Đang mở VD AI Shop",
    shopCta: "Xem sản phẩm",
    walletCta: "Nạp ví",
    detail: "Chi tiết",
    buy: "Mua hàng",
    categoryFallback: "Sản phẩm số",
    unlimited: "Không giới hạn",
    left: "còn lại",
    searchPlaceholder: "Tìm ChatGPT, Claude, YouTube...",
    noProducts: "Chưa có sản phẩm phù hợp.",
    deliveryFallback: "Thông tin nhận hàng sẽ hiển thị sau khi thanh toán thành công.",
    price: "Giá",
    stock: "Kho",
    delivery: "Nhận hàng",
    quantity: "Số lượng",
    max: "Tối đa",
    total: "Tổng thanh toán",
    payWallet: "Mua bằng ví",
    payUsdt: "USDT Cryptomus",
    payBank: "Chuyển khoản QR",
    scanQr: "Quét QR thanh toán",
    openInvoice: "Mở invoice Cryptomus",
    code: "Mã",
    amount: "Số tiền",
    network: "Network",
    walletAddress: "Địa chỉ ví",
    copied: "Đã copy",
    copy: "Copy",
    expires: "Hạn",
    status: "Trạng thái",
    cryptoWarning: "Chỉ chuyển USDT qua mạng {network}. Chuyển sai network có thể mất tiền và hệ thống không thể tự đối soát.",
    qrNote: "VND được đối soát qua SePay. USDT được đối soát qua Cryptomus webhook. Thông tin nhận hàng chỉ hiển thị khi đơn đã thanh toán thành công.",
    refreshStatus: "Kiểm tra trạng thái",
    historyTitle: "Lịch sử",
    historySub: "Đơn hàng và biến động ví gần nhất.",
    historyLogin: "Đăng nhập để xem lịch sử mua hàng.",
    orderCode: "Mã đơn",
    loginTitle: "Đăng nhập",
    registerTitle: "Tạo tài khoản",
    displayName: "Tên hiển thị",
    password: "Mật khẩu",
    register: "Đăng ký",
    noAccount: "Chưa có tài khoản? Đăng ký",
    hasAccount: "Đã có tài khoản? Đăng nhập"
  },
  en: {
    navHome: "Home",
    navProducts: "Products",
    navHistory: "History",
    login: "Sign in",
    logout: "Sign out",
    topupTitle: "Top up",
    boot: "Opening VD AI Shop",
    shopCta: "Browse products",
    walletCta: "Top up wallet",
    detail: "Details",
    buy: "Buy now",
    categoryFallback: "Digital product",
    unlimited: "Unlimited",
    left: "left",
    searchPlaceholder: "Search ChatGPT, Claude, YouTube...",
    noProducts: "No matching products.",
    deliveryFallback: "Delivery information appears after successful payment.",
    price: "Price",
    stock: "Stock",
    delivery: "Delivery",
    quantity: "Quantity",
    max: "Max",
    total: "Total",
    payWallet: "Pay with wallet",
    payUsdt: "Pay with USDT",
    payBank: "Bank QR",
    scanQr: "Scan payment QR",
    openInvoice: "Open Cryptomus invoice",
    code: "Code",
    amount: "Amount",
    network: "Network",
    walletAddress: "Wallet address",
    copied: "Copied",
    copy: "Copy",
    expires: "Expires",
    status: "Status",
    cryptoWarning: "Only send USDT through {network}. Sending through the wrong network may permanently lose funds and cannot be reconciled automatically.",
    qrNote: "VND payments are reconciled by SePay. USDT payments are reconciled by Cryptomus webhook. Delivery is shown only after successful payment.",
    refreshStatus: "Check status",
    historyTitle: "History",
    historySub: "Recent orders and wallet activity.",
    historyLogin: "Sign in to view your order history.",
    orderCode: "Order code",
    loginTitle: "Sign in",
    registerTitle: "Create account",
    displayName: "Display name",
    password: "Password",
    register: "Register",
    noAccount: "No account yet? Register",
    hasAccount: "Already have an account? Sign in"
  }
} as const;
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
type ProductGroup = {
  id: string;
  name: string;
  products: Product[];
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
  const closeTimerRef = useRef<number | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (closeTimerRef.current !== null) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 260);
  }, [onClose]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, [requestClose]);

  function handleOverlayClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      requestClose();
    }
  }

  return { dialogRef, handleOverlayClick, isClosing, requestClose };
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
  const groupedProducts = useMemo(() => groupCatalogProducts(catalog, query, language), [catalog, query, language]);

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

  function navigateTab(next: Tab) {
    setActiveTab(next);
    window.history.replaceState(null, "", next === "home" ? window.location.pathname : `${window.location.pathname}?tab=${next}`);
  }

  function navigateHomeSection(sectionId: string) {
    setActiveTab("home");
    window.history.replaceState(null, "", `${window.location.pathname}#${sectionId}`);
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }

  return (
    <main>
      <Header customer={customer} balance={balance} activeTab={activeTab} language={language} onLanguage={changeLanguage} onTab={navigateTab} onLogin={() => setAuthOpen(true)} onLogout={logout} onWalletOpen={() => { if (token) setWalletOpen(true); else setAuthOpen(true); }} />

      {activeTab === "home" ? (
        <HomeTab
          products={products.slice(0, 6)}
          loading={loading}
          language={language}
          onProduct={(product) => void openProduct(product)}
          onShop={() => navigateTab("products")}
          onWallet={() => {
            if (token) setWalletOpen(true);
            else setAuthOpen(true);
          }}
        />
      ) : null}
      {activeTab === "products" ? (
        <ProductsTab
          groups={groupedProducts}
          productCount={filteredProducts.length}
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
          <HistoryPanel language={language} history={history} onRefresh={() => token && loadPrivateData()} loading={loading === "profile"} />
        </section>
      ) : null}

      <Footer language={language} onTab={navigateTab} onSection={navigateHomeSection} />

      {authOpen ? <AuthDialog language={language} onClose={() => setAuthOpen(false)} onSession={saveSession} /> : null}
      {walletOpen ? (
        <WalletDialog language={language} balance={balance} loading={loading} onTopup={createTopup} onClose={() => setWalletOpen(false)} />
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
          language={language}
          onClose={() => setQr(null)}
          onRefresh={() => checkPaymentStatus(true)}
        />
      ) : null}
      {delivery ? <DeliveryDialog delivery={delivery} onClose={() => setDelivery(null)} /> : null}
      {loading === "boot" ? <div className="boot"><Loader2 className="spin" /> {TEXT[language].boot}</div> : null}
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
  const copy = TEXT[language];
  const navItems: Array<{ tab: Tab; label: string; icon: React.ReactNode }> = [
    { tab: "home", label: copy.navHome, icon: <Home size={16} /> },
    { tab: "products", label: copy.navProducts, icon: <ShoppingBag size={16} /> },
    { tab: "history", label: copy.navHistory, icon: <History size={16} /> }
  ];

  return (
    <header className="topbar">
      <button className="brand" onClick={() => onTab("home")}>
        <img className="brand-logo" src="/logo.png" alt="VD AI Shop" />
        <span>VD AI Shop</span>
      </button>
      <nav className="tab-nav" aria-label={language === "en" ? "Navigation" : "Điều hướng"}>
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
              <button className="balance-pill" onClick={onWalletOpen} title={copy.topupTitle}>
                <Wallet size={14} />{formatVnd(balance)}
              </button>
            </span>
            <button className="icon-button" onClick={onLogout} aria-label={copy.logout}>
              <LogOut size={17} />
            </button>
          </>
        ) : (
          <button className="primary-button" onClick={onLogin}>
            <KeyRound size={17} /> {copy.login}
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
  const vi = language === "vi";
  return (
    <>
      <Hero language={language} onShop={onShop} onWallet={onWallet} />
      <FeaturedProducts products={products} loading={loading} language={language} onProduct={onProduct} onShop={onShop} />
      <TrustShowcase language={language} />
      <HowItWorks language={language} onShop={onShop} onWallet={onWallet} />
      <BrandShowcase language={language} />
      <MerchantInfo language={language} />
      <PolicySections language={language} />
    </>
  );
}

/* ─── Hero ────────────────────────────────────────────────── */

function Hero({ language, onShop, onWallet }: { language: Language; onShop: () => void; onWallet: () => void }) {
  const vi = language === "vi";
  const copy = TEXT[language];
  return (
    <section className="hero">
      <div className="hero-backdrop" />
      <div className="hero-content reveal">
        <img className="hero-logo" src="/logo.png" alt="VD AI Shop" />
        <p className="eyebrow">{vi ? "Tài khoản AI Premium · Tự động 24/7 · Bảo hành uy tín" : "AI premium access · 24/7 automation · Trusted support"}</p>
        <h1>VD AI Shop</h1>
        <p className="hero-text">
          {vi
            ? "Cung cấp tài khoản ChatGPT Plus, Claude Pro, Gemini Advanced và key phần mềm số. Tự động hóa hoàn toàn, kích hoạt nhanh giúp nâng tầm hiệu suất công việc của bạn."
            : "Digital productivity services for AI tools, premium software access and online subscriptions. Fast checkout, clear delivery status and support after payment."}
        </p>
        <div className="hero-actions">
          <button className="primary-button" onClick={onShop}>
            <ShoppingBag size={18} /> {copy.shopCta}
          </button>
          <button className="ghost-button" onClick={onWallet}>
            <QrCode size={18} /> {copy.walletCta}
          </button>
        </div>
        <div className="hero-proofline" aria-label="Tín hiệu tin cậy">
          <span>{vi ? "Giao hàng tự động 24/7" : "24/7 digital delivery"}</span>
          <span>{vi ? "Thông tin minh bạch" : "Clear order tracking"}</span>
          <span>{vi ? "Hỗ trợ sau thanh toán" : "After-payment support"}</span>
        </div>
        <div className="hero-stats" style={{ "--d": "200ms" } as React.CSSProperties}>
          <span><ShieldCheck size={16} /> {vi ? "Giá niêm yết rõ ràng" : "Transparent pricing"}</span>
          <span><TimerReset size={16} /> {vi ? "Hỗ trợ kỹ thuật 24/7" : "24/7 support"}</span>
          <span><PackageCheck size={16} /> {vi ? "VietQR và ví nội bộ" : "USDT invoice support"}</span>
        </div>
      </div>
      <div className="hero-motion" aria-hidden="true">
        <div className="checkout-stage">
          <div className="stage-card stage-product">
            <span>ChatGPT Plus</span>
            <b>{vi ? "250.000 d" : "10 USDT"}</b>
            <i>{vi ? "5 còn lại" : "5 left"}</i>
          </div>
          <div className="stage-card stage-qr">
            <span>DH_AUTO</span>
            <div className="qr-matrix">
              {Array.from({ length: 36 }).map((_, index) => (
                <i key={index} />
              ))}
            </div>
            <b>{vi ? "10 phút" : "10 min"}</b>
          </div>
          <div className="stage-card stage-ledger">
            <span>VD AI Shop</span>
            <b>{vi ? "Tự động 24/7" : "24/7 automated"}</b>
            <i>{vi ? "Giao hàng tức thì" : "Fast delivery"}</i>
          </div>
        </div>
        <div className="route-map">
          <span>{vi ? "Chọn hàng" : "Choose"}</span>
          <span>{vi ? "Quét QR" : "Pay"}</span>
          <span>{vi ? "Kích hoạt" : "Verify"}</span>
          <span>{vi ? "Nhận hàng" : "Receive"}</span>
        </div>
      </div>
    </section>
  );
}

/* ─── Trust Showcase ──────────────────────────────────────── */

function TrustShowcase({ language }: { language: Language }) {
  const vi = language === "vi";
  const cards = vi
    ? [
        { icon: <BadgeCheck />, title: "Đối soát rõ ràng", text: "Mỗi QR có mã thanh toán riêng, lịch sử đơn hàng và trạng thái xử lý minh bạch." },
        { icon: <Zap />, title: "Mua nhanh", text: "Khách có thể thanh toán bằng ví, VietQR hoặc USDT tùy theo ngôn ngữ và cấu hình sản phẩm." },
        { icon: <Headphones />, title: "Hỗ trợ thủ công", text: "Đơn cần admin xử lý sẽ hiện hướng dẫn sau khi thanh toán thành công." },
        { icon: <ShieldCheck />, title: "Bảo mật giao dịch", text: "Webhook thanh toán kiểm tra mã đơn, số tiền và chống xử lý trùng." }
      ]
    : [
        { icon: <BadgeCheck />, title: "Clear reconciliation", text: "Each invoice has a unique order code, visible status and trackable order history." },
        { icon: <Zap />, title: "Fast checkout", text: "English checkout prioritizes USDT/Cryptomus invoices when a product has a USDT price." },
        { icon: <Headphones />, title: "Manual support", text: "Manual-delivery items show admin contact instructions only after successful payment." },
        { icon: <ShieldCheck />, title: "Payment safety", text: "Webhooks verify order codes, amounts and duplicate transaction processing." }
      ];

  return (
    <section className="shell trust-showcase">
      <div className="section-head compact">
        <div>
          <p className="eyebrow reveal">{vi ? "Giá trị vượt trội" : "Trust signals"}</p>
          <h2 className="reveal" style={{ "--d": "80ms" } as React.CSSProperties}>
            {vi ? "Một quy trình mua hàng minh bạch từ QR đến giao hàng" : "A transparent checkout flow from invoice to delivery"}
          </h2>
        </div>
      </div>
      <div className="trust-strip reveal" style={{ "--d": "120ms" } as React.CSSProperties} aria-label="Cam kết vận hành">
        <span>{vi ? "Giá rõ ràng" : "Clear pricing"}</span>
        <span>{vi ? "Giao hàng số" : "Digital delivery"}</span>
        <span>{vi ? "Lưu lịch sử" : "Order history"}</span>
        <span>{vi ? "Hỗ trợ trực tiếp" : "Direct support"}</span>
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
  const copy = TEXT[language];
  const vi = language === "vi";
  return (
    <section className="shell featured-products" id="featured-products">
      <div className="section-head compact">
        <div>
          <p className="eyebrow reveal">{vi ? "Sản phẩm đang bán" : "Available products"}</p>
          <h2 className="reveal" style={{ "--d": "80ms" } as React.CSSProperties}>{vi ? "Tài khoản AI, phần mềm và dịch vụ số có giá niêm yết rõ ràng" : "AI access, software services and digital products with clear pricing"}</h2>
          <p className="product-section-copy reveal" style={{ "--d": "140ms" } as React.CSSProperties}>
            {vi
              ? "Mỗi sản phẩm có giá, tồn kho, phương thức nhận hàng và lịch sử đơn hàng minh bạch. Thông tin giao hàng chỉ mở sau khi thanh toán thành công."
              : "Each product shows price, stock, delivery type and order tracking. Delivery information is displayed only after successful payment."}
          </p>
        </div>
        <button className="ghost-button reveal" onClick={onShop} style={{ "--d": "180ms" } as React.CSSProperties}>
          {vi ? "Xem tất cả" : "View all"} <ArrowRight size={17} />
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
          <div className="empty-state">{vi ? "Danh sách sản phẩm đang được tải. Có thể xem đầy đủ tại tab Sản phẩm." : "Products are loading. You can view the full catalog in the Products tab."}</div>
        )}
      </div>
    </section>
  );
}

/* ─── How It Works ────────────────────────────────────────── */

function HowItWorks({ language, onShop, onWallet }: { language: Language; onShop: () => void; onWallet: () => void }) {
  const vi = language === "vi";
  const steps = vi
    ? [
        ["1", "Lựa chọn dịch vụ", "Khám phá danh mục sản phẩm số và chọn gói phù hợp."],
        ["2", "Thanh toán", "Tiếng Việt dùng ví hoặc VietQR. Tiếng Anh dùng USDT invoice khi sản phẩm có giá USDT."],
        ["3", "Xác thực tự động", "Giao dịch được webhook xác nhận và cập nhật trạng thái đơn hàng."],
        ["4", "Nhận hàng", "Thông tin nhận hàng chỉ hiển thị sau khi đơn thanh toán thành công."]
      ]
    : [
        ["1", "Choose a service", "Browse digital services and select the package you need."],
        ["2", "Pay securely", "English checkout uses USDT/Cryptomus invoices when available."],
        ["3", "Auto verification", "The webhook verifies payment and updates the order status."],
        ["4", "Receive delivery", "Delivery details are shown only after successful payment."]
      ];

  return (
    <section className="shell flow-section">
      <div className="flow-copy reveal">
        <h2>{vi ? "Hệ thống mua sắm tự động hóa, an toàn và bảo mật tối đa" : "Automated checkout with clear payment separation"}</h2>
        <p>
          {vi
            ? "Mọi đơn hàng và số dư ví được lưu trữ minh bạch, hỗ trợ quản lý đồng bộ qua website và bot Telegram."
            : "Orders, invoices and wallet activity are tracked clearly across the website and Telegram bot."}
        </p>
        <div className="flow-actions">
          <button className="primary-button" onClick={onShop}>{vi ? "Mua ngay" : "Buy now"} <ArrowRight size={17} /></button>
          <button className="ghost-button" onClick={onWallet}>{vi ? "Nạp ví" : "Top up"} <Wallet size={17} /></button>
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

function BrandShowcase({ language }: { language: Language }) {
  const vi = language === "vi";
  const brands = ["ChatGPT", "Claude", "Gemini", "Adobe", "CapCut", "YouTube", "Canva", "Cursor", "Grok", "Netflix"];
  return (
    <section className="shell brand-showcase">
      <div className="brand-panel reveal">
        <div>
          <p className="eyebrow">{vi ? "Danh mục phổ biến" : "Popular categories"}</p>
          <h2>{vi ? "Các gói AI, sáng tạo nội dung và premium account" : "AI, creative software and digital subscription services"}</h2>
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

function MerchantInfo({ language }: { language: Language }) {
  const vi = language === "vi";
  const contacts = [
    { label: vi ? "Email hỗ trợ" : "Support email", value: "vietanh.dao99@gmail.com", href: "mailto:vietanh.dao99@gmail.com", icon: <Mail size={18} /> },
    { label: "Zalo", value: "0377952999", href: "https://zalo.me/0377952999", icon: <Phone size={18} /> },
    { label: "Telegram", value: "@vanhdao99", href: "https://t.me/vanhdao99", icon: <Send size={18} /> }
  ];
  return (
    <section className="shell merchant-section" id="contact">
      <div className="merchant-panel reveal">
        <div>
          <p className="eyebrow">{vi ? "Thông tin cửa hàng" : "Merchant information"}</p>
          <h2>{vi ? "VD AI Shop cung cấp dịch vụ số có hỗ trợ trực tiếp" : "VD AI Shop provides digital services with direct support"}</h2>
          <p>
            {vi
              ? "VD AI Shop là cửa hàng trực tuyến bán tài khoản AI, tài khoản premium, key phần mềm và dịch vụ số. Khách hàng có thể mua trên website hoặc Telegram bot, thanh toán bằng VietQR, ví nội bộ hoặc USDT khi cổng thanh toán được kích hoạt."
              : "VD AI Shop is an online digital-service store for AI productivity access, premium software services, software keys and digital subscriptions. Customers can purchase through the website or Telegram bot."}
          </p>
          <p>
            {vi
              ? "Thời gian hỗ trợ: 08:00 đến 23:00 hằng ngày theo giờ Việt Nam. Các đơn cần xử lý thủ công sẽ được hướng dẫn liên hệ admin sau khi thanh toán thành công."
              : "Support hours: 08:00 to 23:00 Vietnam time. Manual-delivery orders show admin contact instructions only after successful payment."}
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

function PolicySections({ language }: { language: Language }) {
  const vi = language === "vi";
  const policies = vi
    ? [
        { id: "delivery-policy", title: "Chính sách giao hàng", text: "Sản phẩm dạng mã, tài khoản hoặc nội dung số sẽ được giao tự động sau khi hệ thống xác nhận thanh toán. Sản phẩm cần xử lý riêng sẽ hiển thị mã đơn và hướng dẫn liên hệ admin." },
        { id: "refund-policy", title: "Chính sách hoàn tiền", text: "Nếu đơn hết hàng, thanh toán sai nội dung, thanh toán quá hạn hoặc không thể giao đúng sản phẩm, hệ thống sẽ cộng tiền về ví hoặc admin xử lý hoàn tiền theo từng trường hợp." },
        { id: "terms", title: "Điều khoản sử dụng", text: "Khách hàng cần kiểm tra kỹ tên sản phẩm, số lượng và giá trước khi thanh toán. Sản phẩm số đã giao thành công không đổi trả nếu thông tin hoạt động đúng mô tả." },
        { id: "privacy", title: "Bảo mật thông tin", text: "Website chỉ lưu thông tin cần thiết để tạo tài khoản, xử lý thanh toán, giao hàng và hỗ trợ đơn hàng. Thông tin thanh toán được dùng để đối soát giao dịch và không bán cho bên thứ ba." }
      ]
    : [
        { id: "delivery-policy", title: "Delivery policy", text: "Digital codes, account access or digital content are delivered after payment confirmation. Manual-delivery products display order details and admin contact instructions after payment." },
        { id: "refund-policy", title: "Refund policy", text: "If an order is out of stock, paid late, paid incorrectly or cannot be delivered as described, the balance is credited back to the wallet or handled manually by support." },
        { id: "terms", title: "Terms of use", text: "Customers should review product name, quantity and price before payment. Delivered digital services are not refundable when they work as described." },
        { id: "privacy", title: "Privacy", text: "The website stores only the information needed for account access, payment processing, delivery and support. Payment data is used for reconciliation and is not sold to third parties." }
      ];
  return (
    <section className="shell policy-section" id="policies">
      <div className="section-head compact">
        <div>
          <p className="eyebrow reveal">{vi ? "Minh bạch giao dịch" : "Transparent checkout"}</p>
          <h2 className="reveal" style={{ "--d": "80ms" } as React.CSSProperties}>{vi ? "Chính sách mua hàng, giao hàng và hoàn tiền" : "Purchase, delivery and refund policies"}</h2>
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
  groups,
  productCount,
  query,
  loading,
  error,
  onQuery,
  onView,
  language
}: {
  groups: ProductGroup[];
  productCount: number;
  query: string;
  loading: string;
  error: string;
  onQuery: (value: string) => void;
  onView: (product: Product) => void;
  language: Language;
}) {
  const copy = TEXT[language];
  return (
    <section className="shell product-section">
      <div className="section-head">
        <div>
          <p className="eyebrow reveal">{language === "vi" ? "Sản phẩm Premium" : "Premium products"}</p>
          <h2 className="reveal" style={{ "--d": "60ms" } as React.CSSProperties}>{language === "vi" ? "Mở khóa Trí tuệ Nhân tạo & Sáng tạo" : "AI productivity and digital service catalog"}</h2>
          <p className="product-section-copy reveal" style={{ "--d": "120ms" } as React.CSSProperties}>
            {language === "vi"
              ? "Danh sách tài khoản premium ChatGPT, Claude, Gemini, Canva, Adobe được tuyển chọn để tăng tốc hiệu năng làm việc, tiết kiệm tối đa chi phí."
              : "Browse AI access, creative software services and digital subscriptions. English checkout shows USDT pricing when configured."}
          </p>
        </div>
        <div className="search-box">
          <Search size={17} />
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}
      <div className="product-groups">
        {groups.map((group) => (
          <section className="product-group" key={group.id}>
            <div className="group-heading">
              <div>
                <span>{language === "vi" ? "Nhóm" : "Group"}</span>
                <h3>{group.name}</h3>
              </div>
              <b>{group.products.length} {language === "vi" ? "sản phẩm" : "products"}</b>
            </div>
            <div className="product-grid">
              {group.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  loading={loading}
                  onView={() => onView(product)}
                  language={language}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {!productCount ? <div className="empty-state">{copy.noProducts}</div> : null}
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
  const copy = TEXT[language];
  const stockLabel = product.deliveryType === "SHARED_CONTENT" ? copy.unlimited : `${stock} ${copy.left}`;

  function openProduct() {
    if (!opening) onView();
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openProduct();
  }

  function handleActionClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    openProduct();
  }

  return (
    <article
      className="product-card reveal"
      role="button"
      tabIndex={0}
      aria-label={`${copy.detail}: ${localizedName(product, language)}`}
      onClick={openProduct}
      onKeyDown={handleCardKeyDown}
    >
      <div className="product-media">
        {imageSrc ? <img src={imageSrc} alt={`${product.name} tại VD AI Shop`} loading="lazy" referrerPolicy="no-referrer" /> : <span>{brandGlyph(product.name)}</span>}
      </div>
      <div className="product-body">
        <div className="product-kicker">
          <span>{product.category?.name ?? copy.categoryFallback}</span>
          <span className={disabled ? "stock-empty" : ""}>{stockLabel}</span>
        </div>
        <h3>{localizedName(product, language)}</h3>
        <p>{localizedDescription(product, language) || copy.deliveryFallback}</p>
        <div className="product-summary">
          <strong>{formatProductPrice(product, language)}</strong>
          <span>{postPaymentLabel(product.deliveryType, language)}</span>
        </div>
      </div>
      <div className="product-actions">
        <button onClick={handleActionClick} disabled={opening}>{opening ? <Loader2 className="spin" size={15} /> : <Search size={15} />} {copy.detail}</button>
        <button onClick={handleActionClick} disabled={opening || loading === `wallet:${product.id}` || loading === `bank:${product.id}` || disabled}>
          {opening || loading === `wallet:${product.id}` || loading === `bank:${product.id}` ? <Loader2 className="spin" size={15} /> : <ShoppingBag size={15} />}
          {copy.buy}
        </button>
      </div>
    </article>
  );
}

/* ─── Wallet Dialog ───────────────────────────────────────── */

function WalletDialog({
  language,
  balance,
  loading,
  onTopup,
  onClose
}: {
  language: Language;
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
      setAmountError(language === "vi" ? "Số tiền nạp tối thiểu là 1.000đ." : "Minimum top-up amount is 1,000 VND.");
      return;
    }
    setAmountError("");
    onTopup(amount);
  }

  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);

  return (
    <div className={`overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <div className="dialog">
        <button className="close" onClick={requestClose}>&times;</button>
        <h2>{language === "vi" ? "Ví VD" : "VD Wallet"}</h2>
        <p className="muted">{language === "vi" ? "Số dư dùng để mua nhanh mà không cần quét QR từng đơn." : "Wallet balance lets you buy quickly without scanning a QR for every order."}</p>
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
          <label htmlFor="custom-amount">{language === "vi" ? "Nạp số tiền tùy ý" : "Custom top-up amount"}</label>
          <div>
            <input
              id="custom-amount"
              inputMode="numeric"
              min={1000}
              placeholder={language === "vi" ? "Ví dụ: 150000" : "Example: 150000"}
              value={customAmount}
              onChange={(event) => {
                setCustomAmount(event.target.value);
                setAmountError("");
              }}
            />
            <button className="primary-button" disabled={loading === "topup"}>
              {loading === "topup" ? <Loader2 className="spin" size={17} /> : <QrCode size={17} />}
              {language === "vi" ? "Tạo QR" : "Create QR"}
            </button>
          </div>
          {amountError ? <p className="field-error">{amountError}</p> : <p className="muted">{language === "vi" ? "Nhập số tiền muốn nạp, hệ thống sẽ tạo QR VietQR theo đúng số tiền đó." : "Enter a VND top-up amount. The system will create a matching VietQR code."}</p>}
        </form>
      </div>
    </div>
  );
}

/* ─── History Panel ───────────────────────────────────────── */

function HistoryPanel({ language, history, onRefresh, loading }: { language: Language; history: StoreHistory | null; onRefresh: () => void; loading: boolean }) {
  const copy = TEXT[language];
  return (
    <section className="panel history-panel reveal" id="history">
      <div className="panel-title">
        <History />
        <div>
          <h2>{copy.historyTitle}</h2>
          <p>{copy.historySub}</p>
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
                  <b>{copy.orderCode}: {order.code}</b>
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
          <p className="muted">{copy.historyLogin}</p>
        )}
      </div>
    </section>
  );
}

/* ─── Auth Dialog ─────────────────────────────────────────── */

function AuthDialog({ language, onClose, onSession }: { language: Language; onClose: () => void; onSession: (session: Session) => void }) {
  const copy = TEXT[language];
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

  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);

  return (
    <div className={`overlay auth-overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <div className="dialog auth-dialog">
        <button className="close" onClick={requestClose}>&times;</button>
        <h2>{mode === "login" ? copy.loginTitle : copy.registerTitle}</h2>
        <form onSubmit={submit}>
          {mode === "register" ? <input name="name" placeholder={copy.displayName} /> : null}
          <input name="email" type="email" placeholder="Email" required />
          <input name="password" type="password" minLength={6} placeholder={copy.password} required />
          {error ? <div className="alert">{error}</div> : null}
          <button className="primary-button" disabled={loading}>
            {loading ? <Loader2 className="spin" size={17} /> : <KeyRound size={17} />}
            {mode === "login" ? copy.login : copy.register}
          </button>
        </form>
        <button className="link-button" onClick={() => setMode(mode === "login" ? "register" : "login")} style={{ marginTop: 14 }}>
          {mode === "login" ? copy.noAccount : copy.hasAccount}
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
  const copy = TEXT[language];
  const deliveryLabel = postPaymentLabel(product.deliveryType, language);

  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);

  return (
    <div className={`overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <div className="dialog product-dialog">
        <button className="close" onClick={requestClose}>&times;</button>
        <div className="product-dialog-scroll">
          <div className="dialog-media">
            {imageSrc ? <img src={imageSrc} alt={`${product.name} - VD AI Shop`} referrerPolicy="no-referrer" /> : <span>{brandGlyph(product.name)}</span>}
          </div>
          <div className="dialog-heading">
            <span>{product.category?.name ?? copy.categoryFallback}</span>
            <h2>{localizedName(product, language)}</h2>
            <p>{localizedDescription(product, language) || copy.deliveryFallback}</p>
          </div>
          <div className="detail-grid">
            <div>
              <span>{copy.price}</span>
              <b>{formatProductPrice(product, language)}</b>
            </div>
            <div>
              <span>{copy.stock}</span>
              <b>{product.deliveryType === "SHARED_CONTENT" ? copy.unlimited : availableQuantity(product)}</b>
            </div>
            <div>
              <span>{copy.delivery}</span>
              <b>{deliveryLabel}</b>
            </div>
          </div>
          <div className="quantity-box">
            <div className="quantity-head">
              <label htmlFor="order-quantity">{copy.quantity}</label>
              <span>{copy.max} {maxQuantity}</span>
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
              <span>{copy.total}</span>
              <b>{formatProductTotal(product, quantity, language)}</b>
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          {language === "en" ? (
            <button className="primary-button" onClick={() => onUsdt(quantity)} disabled={loading === `usdt:${product.id}` || invalidQuantity || !product.usdtPrice}>
              {loading === `usdt:${product.id}` ? <Loader2 className="spin" size={17} /> : <QrCode size={17} />} {copy.payUsdt}
            </button>
          ) : (
            <>
              <button className="primary-button" onClick={() => onWallet(quantity)} disabled={loading === `wallet:${product.id}` || invalidQuantity}>
                {loading === `wallet:${product.id}` ? <Loader2 className="spin" size={17} /> : <Wallet size={17} />} {copy.payWallet}
              </button>
              <button className="ghost-button" onClick={() => onUsdt(quantity)} disabled={loading === `usdt:${product.id}` || invalidQuantity || !product.usdtPrice}>
                {loading === `usdt:${product.id}` ? <Loader2 className="spin" size={17} /> : <QrCode size={17} />} {copy.payUsdt}
              </button>
              <button className="ghost-button" onClick={() => onBank(quantity)} disabled={loading === `bank:${product.id}` || invalidQuantity}>
                {loading === `bank:${product.id}` ? <Loader2 className="spin" size={17} /> : <QrCode size={17} />} {copy.payBank}
              </button>
            </>
          )}
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
  language,
  onClose,
  onRefresh
}: {
  payment: PaymentResult;
  status: PaymentStatusResult | null;
  loading: boolean;
  language: Language;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const copy = TEXT[language];
  const networkLabel = payment.network ? cryptoNetworkLabel(payment.network) : "";

  async function copyAddress() {
    if (!payment.address) return;
    try {
      await navigator.clipboard.writeText(payment.address);
      setCopiedAddress(true);
      window.setTimeout(() => setCopiedAddress(false), 1800);
    } catch {
      setCopiedAddress(false);
    }
  }

  return (
    <div className={`overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <div className="dialog qr-dialog">
        <button className="close" onClick={requestClose}>&times;</button>
        <h2>{copy.scanQr}</h2>
        {payment.qrImageUrl ? <img className="qr-image" src={payment.qrImageUrl} alt={`QR ${payment.code}`} /> : null}
        {payment.checkoutUrl ? (
          <a className="primary-button" href={payment.checkoutUrl} target="_blank" rel="noreferrer" style={{ width: "100%", justifyContent: "center" }}>
            {copy.openInvoice}
          </a>
        ) : null}
        <div className="detail-grid">
          <span>{copy.code}</span><b>{payment.code}</b>
          <span>{copy.amount}</span><b>{payment.cryptoCurrency === "USDT" ? formatUsdt(payment.cryptoAmount) : formatVnd(payment.amount)}</b>
          {payment.network ? (
            <>
              <span>{copy.network}</span><b>{networkLabel}</b>
            </>
          ) : null}
          {payment.address ? (
            <>
              <span>{copy.walletAddress}</span>
              <div className="wallet-address-row">
                <b className="break-all">{payment.address}</b>
                <button type="button" onClick={copyAddress}>
                  {copiedAddress ? <Check size={15} /> : <Copy size={15} />}
                  {copiedAddress ? copy.copied : copy.copy}
                </button>
              </div>
            </>
          ) : null}
          <span>{copy.expires}</span><b>{new Date(payment.expiresAt).toLocaleTimeString(language === "vi" ? "vi-VN" : "en-US")}</b>
          <span>{copy.status}</span><b>{statusLabel(status?.status ?? "PENDING", language)}</b>
        </div>
        {payment.cryptoCurrency === "USDT" && payment.network ? (
          <div className="network-warning">
            {copy.cryptoWarning.split("{network}")[0]}<b>{networkLabel}</b>{copy.cryptoWarning.split("{network}")[1]}
          </div>
        ) : null}
        <p className="muted">{copy.qrNote}</p>
        <button className="ghost-button" onClick={onRefresh} disabled={loading} style={{ width: "100%", marginTop: 12 }}>
          <RefreshCw className={loading ? "spin" : ""} size={17} /> {copy.refreshStatus}
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

  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);

  return (
    <div className={`overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <div className="dialog">
        <button className="close" onClick={requestClose}>&times;</button>
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

function Footer({ language, onTab, onSection }: { language: Language; onTab: (tab: Tab) => void; onSection: (sectionId: string) => void }) {
  const vi = language === "vi";
  return (
    <footer>
      <div>
        <span>VD AI Shop</span>
        <small>{vi ? "Tài khoản AI, premium account, key phần mềm và dịch vụ số." : "AI access, premium accounts, software keys and digital services."}</small>
      </div>
      <nav aria-label="Liên kết thông tin cửa hàng">
        <button onClick={() => onTab("products")}>{vi ? "Sản phẩm" : "Products"}</button>
        <button onClick={() => onSection("contact")}>{vi ? "Liên hệ" : "Contact"}</button>
        <button onClick={() => onSection("delivery-policy")}>{vi ? "Giao hàng" : "Delivery"}</button>
        <button onClick={() => onSection("refund-policy")}>{vi ? "Hoàn tiền" : "Refund"}</button>
        <button onClick={() => onSection("terms")}>{vi ? "Điều khoản" : "Terms"}</button>
        <button onClick={() => onSection("privacy")}>{vi ? "Bảo mật" : "Privacy"}</button>
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

function postPaymentLabel(type: Product["deliveryType"], language: Language = "vi") {
  if (language === "en") {
    if (type === "STOCK_ITEM") return "Delivered after payment";
    if (type === "SHARED_CONTENT") return "Unlocked after payment";
    return "Manual after payment";
  }
  if (type === "STOCK_ITEM") return "Nhận sau thanh toán";
  if (type === "SHARED_CONTENT") return "Mở sau thanh toán";
  return "Xử lý sau thanh toán";
}

function groupCatalogProducts(catalog: Catalog | null, query: string, language: Language): ProductGroup[] {
  if (!catalog) return [];
  const normalized = query.toLocaleLowerCase("vi-VN").trim();
  const matches = (product: Product) => {
    if (!normalized) return true;
    return `${localizedName(product, language)} ${localizedDescription(product, language) ?? ""}`
      .toLocaleLowerCase("vi-VN")
      .includes(normalized);
  };
  const groups: ProductGroup[] = catalog.categories
    .map((category) => ({
      id: category.id,
      name: category.name,
      products: category.products.map((product) => ({ ...product, category: { id: category.id, name: category.name } })).filter(matches)
    }))
    .filter((group) => group.products.length > 0);
  const uncategorized = catalog.uncategorized.filter(matches);
  if (uncategorized.length) {
    groups.push({
      id: "uncategorized",
      name: language === "vi" ? "Sản phẩm khác" : "Other products",
      products: uncategorized
    });
  }
  return groups;
}

function statusLabel(status: PaymentStatusResult["status"], language: Language = "vi") {
  const labels: Record<PaymentStatusResult["status"], string> = language === "en" ? {
    PENDING: "Pending payment",
    SUCCEEDED: "Paid",
    EXPIRED: "Expired",
    FAILED: "Failed",
    CREDITED_TO_WALLET: "Credited to wallet",
    MANUAL_REVIEW: "Manual review"
  } : {
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

function cryptoNetworkLabel(network: string) {
  const normalized = network.trim().toUpperCase();
  const labels: Record<string, string> = {
    TRON: "TRON / TRC20",
    BSC: "BSC / BEP20",
    ETH: "Ethereum / ERC20",
    POLYGON: "Polygon",
    ARBITRUM: "Arbitrum",
    TON: "TON",
    SOL: "Solana",
    AVALANCHE: "Avalanche"
  };
  return labels[normalized] ?? normalized;
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
