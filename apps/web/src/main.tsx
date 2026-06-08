import React, { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CreditCard,
  Headphones,
  Heart,
  History,
  Home,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  Minus,
  PackageCheck,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  TimerReset,
  Trash2,
  UserRound,
  Wallet,
  X,
  Zap
} from "lucide-react";
import {
  availableQuantity,
  Catalog,
  CartPurchaseResult,
  flattenCatalog,
  formatUsdt,
  formatVnd,
  History as StoreHistory,
  PaymentResult,
  PaymentStatusResult,
  Product,
  ProductReview,
  ReviewsResponse,
  Session,
  StoreApi,
  VoucherPreview,
  WalletPurchaseResult
} from "./api";
import "./styles.css";

const TOKEN_KEY = "vd_store_token";
const LANGUAGE_KEY = "vd_store_language";
const savedToken = readStoredToken();
const api = new StoreApi(savedToken);

type Tab = "home" | "products" | "reviews" | "history";
type Language = "vi" | "en";
type PayMethod = "bank" | "wallet" | "usdt";

const initialTab = readInitialTab();

const TEXT = {
  vi: {
    navHome: "Trang chủ",
    navProducts: "Sản phẩm",
    navReviews: "Đánh giá",
    navHistory: "Kiểm tra đơn",
    login: "Đăng nhập",
    logout: "Đăng xuất",
    topupTitle: "Nạp ví",
    boot: "Đang mở VD AI Shop",
    shopCta: "Mua ngay",
    catalogCta: "Xem danh mục",
    walletCta: "Nạp ví",
    detail: "Xem nhanh",
    buy: "Mua ngay",
    addCart: "Thêm vào giỏ",
    cart: "Giỏ hàng",
    cartEmpty: "Giỏ hàng của bạn đang trống.",
    cartHint: "Sản phẩm trong giỏ có thể chỉnh số lượng và thanh toán từng món bằng mã đơn riêng.",
    checkout: "Thanh toán",
    remove: "Xóa",
    categoryFallback: "Sản phẩm số",
    unlimited: "Không giới hạn",
    left: "còn lại",
    searchPlaceholder: "Tìm kiếm sản phẩm...",
    noProducts: "Chưa có sản phẩm phù hợp.",
    deliveryFallback: "Thông tin nhận hàng sẽ hiển thị sau khi thanh toán thành công.",
    price: "Giá",
    stock: "Kho",
    delivery: "Nhận hàng",
    quantity: "Số lượng",
    max: "Tối đa",
    total: "Tổng thanh toán",
    payWallet: "Thanh toán ví",
    payUsdt: "USDT",
    payBank: "VietQR",
    scanQr: "Quét QR thanh toán",
    openInvoice: "Mở invoice",
    code: "Mã",
    amount: "Số tiền",
    network: "Network",
    walletAddress: "Địa chỉ ví",
    copied: "Đã copy",
    copy: "Copy",
    expires: "Hạn",
    status: "Trạng thái",
    cryptoWarning: "Chỉ chuyển USDT qua mạng {network}. Chuyển sai network có thể mất tiền và hệ thống không thể tự đối soát.",
    qrNote: "VND được đối soát qua SePay. USDT được đối soát qua Cryptomus webhook. Thông tin nhận hàng chỉ mở sau khi đơn đã thanh toán thành công.",
    refreshStatus: "Kiểm tra trạng thái",
    historyTitle: "Kiểm tra đơn hàng",
    historySub: "Đơn hàng, mã thanh toán và biến động ví gần nhất.",
    historyLogin: "Đăng nhập để xem lịch sử mua hàng.",
    orderCode: "Mã đơn",
    loginTitle: "Đăng nhập",
    registerTitle: "Tạo tài khoản",
    displayName: "Tên hiển thị",
    password: "Mật khẩu",
    register: "Đăng ký",
    noAccount: "Chưa có tài khoản? Đăng ký",
    hasAccount: "Đã có tài khoản? Đăng nhập",
    reviewTitle: "Gửi đánh giá",
    reviewSub: "Chia sẻ trải nghiệm để khách mới chọn sản phẩm dễ hơn.",
    reviewProduct: "Mặt hàng",
    reviewRating: "Đánh giá",
    reviewHeadline: "Tiêu đề ngắn",
    reviewContent: "Nội dung đánh giá",
    reviewSubmit: "Đăng đánh giá",
    reviewLogin: "Đăng nhập để gửi đánh giá.",
    reviewThanks: "Cảm ơn bạn, đánh giá đã được hiển thị trên trang chủ.",
    reviewPickProduct: "Chọn sản phẩm để đánh giá",
    reviewPlaceholder: "Ví dụ: giao nhanh, đúng mô tả, admin hỗ trợ rõ ràng...",
    reviewHeadlinePlaceholder: "Ví dụ: Giao nhanh và dễ dùng"
  },
  en: {
    navHome: "Home",
    navProducts: "Products",
    navReviews: "Reviews",
    navHistory: "Track order",
    login: "Sign in",
    logout: "Sign out",
    topupTitle: "Top up",
    boot: "Opening VD AI Shop",
    shopCta: "Buy now",
    catalogCta: "Browse catalog",
    walletCta: "Top up wallet",
    detail: "Quick view",
    buy: "Buy now",
    addCart: "Add to cart",
    cart: "Cart",
    cartEmpty: "Your cart is empty.",
    cartHint: "Cart keeps products ready so you can adjust quantities and checkout each item with a clear order code.",
    checkout: "Checkout",
    remove: "Remove",
    categoryFallback: "Digital product",
    unlimited: "Unlimited",
    left: "left",
    searchPlaceholder: "Search products...",
    noProducts: "No matching products.",
    deliveryFallback: "Delivery information appears after successful payment.",
    price: "Price",
    stock: "Stock",
    delivery: "Delivery",
    quantity: "Quantity",
    max: "Max",
    total: "Total",
    payWallet: "Pay with wallet",
    payUsdt: "USDT",
    payBank: "VietQR",
    scanQr: "Scan payment QR",
    openInvoice: "Open invoice",
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
    historyTitle: "Track orders",
    historySub: "Recent orders, payment codes and wallet activity.",
    historyLogin: "Sign in to view your order history.",
    orderCode: "Order code",
    loginTitle: "Sign in",
    registerTitle: "Create account",
    displayName: "Display name",
    password: "Password",
    register: "Register",
    noAccount: "No account yet? Register",
    hasAccount: "Already have an account? Sign in",
    reviewTitle: "Write a review",
    reviewSub: "Share your experience so new customers can choose with more confidence.",
    reviewProduct: "Product",
    reviewRating: "Rating",
    reviewHeadline: "Short headline",
    reviewContent: "Review content",
    reviewSubmit: "Publish review",
    reviewLogin: "Sign in to write a review.",
    reviewThanks: "Thank you, your review is now visible on the homepage.",
    reviewPickProduct: "Choose a product to review",
    reviewPlaceholder: "Example: fast delivery, accurate description, clear support...",
    reviewHeadlinePlaceholder: "Example: Fast delivery and easy to use"
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
    subtotalAmount?: number;
    discountAmount?: number;
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

type CartItem = {
  product: Product;
  quantity: number;
};

type CartFlyItem = {
  id: number;
  name: string;
  categoryName: string;
  description: string;
  deliveryLabel: string;
  stockLabel: string;
  price: string;
  image: string | null;
  glyph: string;
  actionText: string;
  buyText: string;
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  targetX: number;
  targetY: number;
  dx: number;
  dy: number;
  shrinkX: number;
  shrinkY: number;
  earlyX: number;
  earlyY: number;
  midX: number;
  midY: number;
  lateX: number;
  lateY: number;
  arc1X: number;
  arc1Y: number;
  arc2X: number;
  arc2Y: number;
  arc3X: number;
  arc3Y: number;
  arc4X: number;
  arc4Y: number;
  arc5X: number;
  arc5Y: number;
  arc6X: number;
  arc6Y: number;
  trailLeft: number;
  trailTop: number;
  trailWidth: number;
  trailHeight: number;
  trailPath: string;
};

type CategoryTile = {
  tone: string;
  icon: React.ReactNode;
};

const categoryVisuals: CategoryTile[] = [
  { tone: "cyan", icon: <Sparkles size={26} /> },
  { tone: "violet", icon: <PackageCheck size={26} /> },
  { tone: "orange", icon: <Zap size={26} /> },
  { tone: "emerald", icon: <ShieldCheck size={26} /> },
  { tone: "pink", icon: <CreditCard size={26} /> },
  { tone: "blue", icon: <BadgeCheck size={26} /> }
];

function useReveal() {
  const observed = useRef(new Set<Element>());

  useEffect(() => {
    const showAll = () => {
      document.querySelectorAll(".reveal:not(.visible)").forEach((element) => element.classList.add("visible"));
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      showAll();
      return;
    }

    if (!("IntersectionObserver" in window)) {
      showAll();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -48px 0px" }
    );

    const observe = () => {
      document.querySelectorAll(".reveal:not(.visible)").forEach((element) => {
        if (!observed.current.has(element)) {
          observed.current.add(element);
          observer.observe(element);
        }
      });
    };

    observe();
    const mutation = new MutationObserver(observe);
    mutation.observe(document.body, { childList: true, subtree: true });
    const fallbackTimer = window.setTimeout(showAll, 700);

    return () => {
      window.clearTimeout(fallbackTimer);
      mutation.disconnect();
      observer.disconnect();
    };
  }, []);
}

function useHeroOrbit(count: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const pausedRef = useRef(false);

  const setItemRef = useCallback((node: HTMLElement | null, index: number) => {
    itemRefs.current[index] = node;
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    pausedRef.current = paused;
    containerRef.current?.classList.toggle("is-orbit-paused", paused);
  }, []);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root || count <= 0) return undefined;

    let frame = 0;
    let rotation = -Math.PI / 2;
    let previousTime = performance.now();
    const fullTurn = Math.PI * 2;
    const duration = 32000;

    const paint = (time: number) => {
      const rect = root.getBoundingClientRect();
      const radiusX = Math.max(132, Math.min(rect.width * 0.37, 270));
      const radiusY = Math.max(92, Math.min(rect.height * 0.29, 152));

      if (!pausedRef.current) {
        const delta = Math.min(80, Math.max(0, time - previousTime));
        rotation = (rotation + (delta / duration) * fullTurn) % fullTurn;
      }
      previousTime = time;

      itemRefs.current.slice(0, count).forEach((node, index) => {
        if (!node) return;
        const angle = rotation + (index * fullTurn) / count;
        const x = Math.cos(angle) * radiusX;
        const y = Math.sin(angle) * radiusY;
        const depth = (Math.sin(angle) + 1) / 2;
        const scale = 0.88 + depth * 0.16;
        const opacity = 0.78 + depth * 0.22;

        node.style.setProperty("--orbit-x", `${x.toFixed(2)}px`);
        node.style.setProperty("--orbit-y", `${y.toFixed(2)}px`);
        node.style.setProperty("--orbit-scale", scale.toFixed(3));
        node.style.setProperty("--orbit-opacity", opacity.toFixed(3));
        node.style.zIndex = String(10 + Math.round(depth * 30));
      });

      frame = window.requestAnimationFrame(paint);
    };

    paint(previousTime);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [count]);

  return { containerRef, setItemRef, setPaused };
}

function useDialogClose(onClose: () => void) {
  const closeTimerRef = useRef<number | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (closeTimerRef.current !== null) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 220);
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
    if (event.target === event.currentTarget) requestClose();
  }

  return { handleOverlayClick, isClosing, requestClose };
}

function App() {
  const [token, setToken] = useState(savedToken);
  const [customer, setCustomer] = useState<Session["customer"] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [history, setHistory] = useState<StoreHistory | null>(null);
  const [balance, setBalance] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [checkoutItem, setCheckoutItem] = useState<CartItem | null>(null);
  const [checkoutCartItems, setCheckoutCartItems] = useState<CartItem[] | null>(null);
  const [qr, setQr] = useState<PaymentResult | null>(null);
  const [qrStatus, setQrStatus] = useState<PaymentStatusResult | null>(null);
  const [delivery, setDelivery] = useState<DeliveryNotice | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartPulse, setCartPulse] = useState(false);
  const [loading, setLoading] = useState("boot");
  const [error, setError] = useState("");
  const [query, setQuery] = useState(new URLSearchParams(window.location.search).get("q") ?? "");
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [language, setLanguage] = useState<Language>(() => readStoredLanguage());
  const [cartFlyItems, setCartFlyItems] = useState<CartFlyItem[]>([]);
  const cartButtonRef = useRef<HTMLButtonElement>(null);
  const cartFlyTimersRef = useRef<number[]>([]);

  useReveal();

  const products = useMemo(() => (catalog ? flattenCatalog(catalog) : []), [catalog]);
  const filteredProducts = useMemo(() => {
    const normalized = query.toLocaleLowerCase("vi-VN").trim();
    if (!normalized) return products;
    return products.filter((product) =>
      `${localizedName(product, language)} ${localizedDescription(product, language) ?? ""}`.toLocaleLowerCase("vi-VN").includes(normalized)
    );
  }, [products, query, language]);
  const groupedProducts = useMemo(() => groupCatalogProducts(catalog, query, language), [catalog, query, language]);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cartItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  useEffect(() => {
    const title =
      language === "vi"
        ? "VD AI Shop - Tài khoản AI, premium account và phần mềm"
        : "VD AI Shop - AI accounts, premium software and digital services";
    const description =
      language === "vi"
        ? "Mua ChatGPT Plus, Claude Pro, Gemini Advanced, Canva Pro, Adobe, YouTube Premium và dịch vụ số. Thanh toán VietQR, ví nội bộ hoặc USDT."
        : "Buy ChatGPT Plus, Claude Pro, Gemini Advanced, Canva Pro, Adobe, YouTube Premium and digital services with VietQR, wallet or USDT checkout.";

    document.documentElement.lang = language;
    document.title = title;
    document.querySelector("meta[name='description']")?.setAttribute("content", description);
  }, [language]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!selectedProduct) return;
    const freshProduct = products.find((product) => product.id === selectedProduct.id);
    if (freshProduct && freshProduct !== selectedProduct) setSelectedProduct(freshProduct);
  }, [products, selectedProduct]);

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

  useEffect(() => {
    return () => {
      cartFlyTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      cartFlyTimersRef.current = [];
    };
  }, []);

  async function loadPublicData() {
    try {
      const [nextCatalog, nextReviews] = await Promise.all([
        api.get<Catalog>("/store/catalog"),
        api.get<ReviewsResponse>("/store/reviews").catch(() => ({ reviews: [] }))
      ]);
      setCatalog(nextCatalog);
      setReviews(nextReviews.reviews);
      setError("");
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

  function changeLanguage(next: Language) {
    setLanguage(next);
    localStorage.setItem(LANGUAGE_KEY, next);
  }

  function playCartFlyAnimation(product: Product, origin?: Element | null) {
    const targetRect = cartButtonRef.current?.getBoundingClientRect();
    const sourceRect = origin?.getBoundingClientRect();
    if (!targetRect || !sourceRect || !origin || sourceRect.width <= 0 || sourceRect.height <= 0) return;

    const compact = window.innerWidth < 640;
    const sourceCard = origin.closest(".product-card") ?? origin;
    sourceCard.classList.add("cart-throw-origin");
    const width = Math.min(Math.max(sourceRect.width * 0.54, compact ? 166 : 190), compact ? 190 : 224);
    const height = Math.min(Math.max(sourceRect.height * 0.38, compact ? 140 : 158), compact ? 164 : 188);
    const rawLeft = sourceRect.left + sourceRect.width / 2 - width / 2;
    const rawTop = sourceRect.top + Math.min(sourceRect.height * 0.26, 96) - height / 2;
    const minLeft = compact ? 10 : 18;
    const minTop = compact ? 12 : Math.min(94, window.innerHeight * 0.15);
    const left = Math.min(Math.max(rawLeft, minLeft), Math.max(minLeft, window.innerWidth - width - minLeft));
    const top = Math.min(Math.max(rawTop, minTop), Math.max(minTop, window.innerHeight - height - 18));
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    const targetX = targetRect.left + targetRect.width / 2;
    const targetY = targetRect.top + targetRect.height / 2;
    const dx = targetX - centerX;
    const dy = targetY - centerY;
    const distance = Math.hypot(dx, dy);
    const lift = Math.min(compact ? 164 : 196, Math.max(compact ? 90 : 112, distance * 0.2));
    const controlX = centerX + dx * 0.5;
    const controlY = Math.max(compact ? 28 : 58, Math.min(centerY, targetY) - lift);
    const trailPad = 88;
    const trailLeft = Math.floor(Math.min(centerX, controlX, targetX) - trailPad);
    const trailTop = Math.floor(Math.min(centerY, controlY, targetY) - trailPad);
    const trailRight = Math.ceil(Math.max(centerX, controlX, targetX) + trailPad);
    const trailBottom = Math.ceil(Math.max(centerY, controlY, targetY) + trailPad);
    const trailWidth = Math.max(1, trailRight - trailLeft);
    const trailHeight = Math.max(1, trailBottom - trailTop);
    const trailPath = `M ${Math.round(centerX - trailLeft)} ${Math.round(centerY - trailTop)} Q ${Math.round(controlX - trailLeft)} ${Math.round(controlY - trailTop)} ${Math.round(targetX - trailLeft)} ${Math.round(targetY - trailTop)}`;
    const id = Date.now() + Math.random();
    const minVisibleY = compact ? 8 : 16;
    const clampFlyY = (value: number, scale: number) => {
      const scaledInset = (height - height * scale) / 2;
      return Math.max(value, minVisibleY - top - scaledInset);
    };
    const pointOnCurve = (t: number, scale: number) => {
      const inverse = 1 - t;
      const x = inverse * inverse * centerX + 2 * inverse * t * controlX + t * t * targetX;
      const y = inverse * inverse * centerY + 2 * inverse * t * controlY + t * t * targetY;
      return {
        x: x - centerX,
        y: clampFlyY(y - centerY, scale)
      };
    };
    const arc1 = pointOnCurve(0.12, 0.92);
    const arc2 = pointOnCurve(0.26, 0.78);
    const arc3 = pointOnCurve(0.42, 0.62);
    const arc4 = pointOnCurve(0.58, 0.46);
    const arc5 = pointOnCurve(0.74, 0.3);
    const arc6 = pointOnCurve(0.9, 0.14);
    const deliveryLabel = postPaymentLabel(product.deliveryType, language);
    const stockLabel =
      product.deliveryType === "SHARED_CONTENT"
        ? TEXT[language].unlimited
        : `${availableQuantity(product)} ${TEXT[language].left}`;

    setCartFlyItems((current) => [
      ...current,
      {
        id,
        name: localizedName(product, language),
        categoryName: product.category?.name ?? TEXT[language].categoryFallback,
        description: localizedDescription(product, language) || TEXT[language].deliveryFallback,
        deliveryLabel,
        stockLabel,
        price: formatProductPrice(product, language),
        image: productArtUrl(product),
        glyph: brandGlyph(product.name),
        actionText: TEXT[language].addCart,
        buyText: TEXT[language].buy,
        left,
        top,
        width,
        height,
        centerX,
        centerY,
        targetX,
        targetY,
        dx,
        dy,
        shrinkX: dx * 0.03,
        shrinkY: clampFlyY(Math.min(-16, dy * 0.035), 0.78),
        earlyX: dx * 0.18,
        earlyY: clampFlyY(dy * 0.08 - lift * 0.66, 0.58),
        midX: dx * 0.52,
        midY: clampFlyY(dy * 0.3 - lift * 0.84, 0.36),
        lateX: dx * 0.83,
        lateY: clampFlyY(dy * 0.73 - lift * 0.2, 0.18),
        arc1X: arc1.x,
        arc1Y: arc1.y,
        arc2X: arc2.x,
        arc2Y: arc2.y,
        arc3X: arc3.x,
        arc3Y: arc3.y,
        arc4X: arc4.x,
        arc4Y: arc4.y,
        arc5X: arc5.x,
        arc5Y: arc5.y,
        arc6X: arc6.x,
        arc6Y: arc6.y,
        trailLeft,
        trailTop,
        trailWidth,
        trailHeight,
        trailPath
      }
    ]);

    const receiveTimer = window.setTimeout(() => {
      setCartPulse(true);
    }, 1050);
    const clearPulseTimer = window.setTimeout(() => {
      setCartPulse(false);
    }, 1370);
    const timer = window.setTimeout(() => {
      setCartFlyItems((current) => current.filter((item) => item.id !== id));
      cartFlyTimersRef.current = cartFlyTimersRef.current.filter((savedTimer) => savedTimer !== timer);
    }, 1450);
    const originTimer = window.setTimeout(() => {
      sourceCard.classList.remove("cart-throw-origin");
      cartFlyTimersRef.current = cartFlyTimersRef.current.filter((savedTimer) => savedTimer !== originTimer);
    }, 330);
    cartFlyTimersRef.current.push(receiveTimer, clearPulseTimer, timer, originTimer);
  }

  function addToCart(product: Product, quantity = 1, origin?: Element | null) {
    const stock = availableQuantity(product);
    const maxQuantity = product.deliveryType === "SHARED_CONTENT" ? 999 : Math.max(0, stock);
    if (maxQuantity <= 0) return;
    setCartItems((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing) {
        return current.map((item) =>
          item.product.id === product.id
            ? { ...item, product: { ...item.product, ...product }, quantity: Math.min(maxQuantity, item.quantity + quantity) }
            : item
        );
      }
      return [...current, { product, quantity: Math.min(maxQuantity, Math.max(1, quantity)) }];
    });
    playCartFlyAnimation(product, origin);
  }

  function updateCartQuantity(productId: string, quantity: number) {
    setCartItems((current) =>
      current.flatMap((item) => {
        if (item.product.id !== productId) return [item];
        const maxQuantity = item.product.deliveryType === "SHARED_CONTENT" ? 999 : Math.max(1, availableQuantity(item.product));
        const nextQuantity = Math.max(0, Math.min(maxQuantity, quantity));
        return nextQuantity ? [{ ...item, quantity: nextQuantity }] : [];
      })
    );
  }

  function updateCheckoutQuantity(quantity: number) {
    setCheckoutItem((current) => {
      if (!current) return current;
      const maxQuantity = current.product.deliveryType === "SHARED_CONTENT" ? 999 : Math.max(1, availableQuantity(current.product));
      const nextQuantity = Math.max(1, Math.min(maxQuantity, quantity));
      updateCartQuantity(current.product.id, nextQuantity);
      return { ...current, quantity: nextQuantity };
    });
  }

  function removeFromCart(productId: string) {
    setCartItems((current) => current.filter((item) => item.product.id !== productId));
    setCheckoutItem((current) => (current?.product.id === productId ? null : current));
    setCheckoutCartItems((current) => current?.filter((item) => item.product.id !== productId) ?? null);
  }

  function checkoutCartItem(item: CartItem) {
    setCartOpen(false);
    setSelectedProduct(null);
    setCheckoutCartItems(null);
    setCheckoutItem(item);
  }

  function checkoutCartAll() {
    if (!cartItems.length) return;
    setCartOpen(false);
    setSelectedProduct(null);
    setCheckoutItem(null);
    setCheckoutCartItems(cartItems);
  }

  function checkoutProduct(product: Product, quantity = 1) {
    setSelectedProduct(null);
    setCartOpen(false);
    setCheckoutCartItems(null);
    setCheckoutItem({ product, quantity });
  }

  async function createTopup(amount: number) {
    if (!requireLogin()) return;
    await runAction("topup", async () => {
      setQr(await api.post<PaymentResult>("/store/topups", { amount }));
      setQrStatus(null);
      setDelivery(null);
      setWalletOpen(false);
    });
  }

  async function buyWithWallet(product: Product, quantity = 1, voucherCode?: string | null) {
    if (!requireLogin()) return;
    await runAction(`wallet:${product.id}`, async () => {
      const result = await api.post<WalletPurchaseResult>("/store/orders/wallet", { productId: product.id, quantity, voucherCode });
      setDelivery({
        title: language === "vi" ? "Mua hàng thành công" : "Purchase completed",
        deliveryText: result.deliveryText,
        balanceAfter: result.balanceAfter,
        order: {
          code: result.order?.code ?? "",
          status: result.order?.status,
          quantity,
          subtotalAmount: result.order?.subtotalAmount,
          discountAmount: result.order?.discountAmount,
          totalAmount: result.order?.totalAmount ?? product.price * quantity,
          deliveryText: result.deliveryText,
          product: { name: product.name, deliveryType: product.deliveryType }
        }
      });
      setQr(null);
      setQrStatus(null);
      setSelectedProduct(null);
      setCheckoutItem(null);
      removeFromCart(product.id);
      await loadPrivateData(false);
    });
  }

  async function buyWithBank(product: Product, quantity = 1, voucherCode?: string | null) {
    if (!requireLogin()) return;
    await runAction(`bank:${product.id}`, async () => {
      setQr(await api.post<PaymentResult>("/store/orders/bank", { productId: product.id, quantity, voucherCode }));
      setQrStatus(null);
      setDelivery(null);
      setSelectedProduct(null);
      setCheckoutItem(null);
      removeFromCart(product.id);
    });
  }

  async function buyWithUsdt(product: Product, quantity = 1, voucherCode?: string | null) {
    if (!requireLogin()) return;
    await runAction(`usdt:${product.id}`, async () => {
      setQr(await api.post<PaymentResult>("/store/orders/usdt", { productId: product.id, quantity, voucherCode }));
      setQrStatus(null);
      setDelivery(null);
      setSelectedProduct(null);
      setCheckoutItem(null);
      removeFromCart(product.id);
    });
  }

  async function buyCartWithWallet(items: CartItem[], voucherCode?: string | null) {
    if (!requireLogin()) return;
    const payloadItems = items.map((item) => ({ productId: item.product.id, quantity: item.quantity }));
    await runAction("cart-wallet", async () => {
      const result = await api.post<CartPurchaseResult>("/store/cart/orders/wallet", { items: payloadItems, voucherCode });
      setDelivery({
        title: language === "vi" ? "Mua giỏ hàng thành công" : "Cart purchase completed",
        deliveryText: result.deliveryText,
        balanceAfter: result.balanceAfter,
        order: {
          code: result.order?.code ?? "",
          status: result.order?.status,
          quantity: result.orders.reduce((sum, order) => sum + order.quantity, 0),
          totalAmount: result.voucher?.totalAmount ?? result.orders.reduce((sum, order) => sum + order.totalAmount, 0),
          deliveryText: result.deliveryText,
          product: { name: language === "vi" ? `${result.orders.length} sản phẩm` : `${result.orders.length} products`, deliveryType: "MANUAL" }
        }
      });
      setQr(null);
      setQrStatus(null);
      setCheckoutCartItems(null);
      setCartItems([]);
      await loadPrivateData(false);
    });
  }

  async function buyCartWithBank(items: CartItem[], voucherCode?: string | null) {
    if (!requireLogin()) return;
    const payloadItems = items.map((item) => ({ productId: item.product.id, quantity: item.quantity }));
    await runAction("cart-bank", async () => {
      setQr(await api.post<PaymentResult>("/store/cart/orders/bank", { items: payloadItems, voucherCode }));
      setQrStatus(null);
      setDelivery(null);
      setCheckoutCartItems(null);
      setCartItems([]);
    });
  }

  async function buyCartWithUsdt(items: CartItem[], voucherCode?: string | null) {
    if (!requireLogin()) return;
    const payloadItems = items.map((item) => ({ productId: item.product.id, quantity: item.quantity }));
    await runAction("cart-usdt", async () => {
      setQr(await api.post<PaymentResult>("/store/cart/orders/usdt", { items: payloadItems, voucherCode }));
      setQrStatus(null);
      setDelivery(null);
      setCheckoutCartItems(null);
      setCartItems([]);
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
          title: language === "vi" ? "Nạp tiền thành công" : "Top-up completed",
          deliveryText: language === "vi" ? `Đã cộng ${formatVnd(status.amount)} vào ví.` : `${formatVnd(status.amount)} has been added to your wallet.`,
          balanceAfter: status.balance
        });
        return;
      }

      if (status.kind === "DIRECT_ORDER" && status.status === "SUCCEEDED" && status.order?.deliveryText) {
        setQr(null);
        setDelivery({
          title: language === "vi" ? "Mua hàng thành công" : "Purchase completed",
          deliveryText: status.order.deliveryText,
          balanceAfter: status.balance,
          order: status.order
        });
        return;
      }

      if (status.status === "CREDITED_TO_WALLET") {
        setQr(null);
        setDelivery({
          title: language === "vi" ? "Tiền đã cộng vào ví" : "Balance credited",
          deliveryText:
            language === "vi"
              ? "Đơn hàng chưa thể giao tự động nên hệ thống đã cộng tiền vào ví của bạn."
              : "The order could not be delivered automatically, so the system credited the balance to your wallet.",
          balanceAfter: status.balance
        });
        return;
      }

      if (status.status === "MANUAL_REVIEW") {
        setQr(null);
        setDelivery({
          title: language === "vi" ? "Giao dịch cần kiểm tra" : "Payment needs review",
          deliveryText:
            language === "vi"
              ? "Giao dịch đã được ghi nhận nhưng cần admin kiểm tra lại số tiền hoặc nội dung chuyển khoản."
              : "The payment was recorded but support needs to review the amount or transfer content.",
          balanceAfter: status.balance
        });
        return;
      }

      if (status.status === "EXPIRED" || status.status === "FAILED") {
        setQr(null);
        setDelivery({
          title: status.status === "EXPIRED" ? (language === "vi" ? "QR đã hết hạn" : "QR expired") : language === "vi" ? "Thanh toán thất bại" : "Payment failed",
          deliveryText:
            status.status === "EXPIRED"
              ? language === "vi"
                ? "Mã QR này đã quá thời gian. Bạn có thể tạo QR mới hoặc liên hệ hỗ trợ nếu đã chuyển khoản."
                : "This QR has expired. Create a new QR or contact support if you already transferred."
              : language === "vi"
                ? "Giao dịch chưa hoàn tất. Vui lòng tạo lại QR hoặc liên hệ hỗ trợ nếu bạn đã chuyển khoản."
                : "The transaction was not completed. Please create a new QR or contact support if you already transferred.",
          balanceAfter: status.balance
        });
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
      setSelectedQuantity(1);
      setSelectedProduct({ ...product, ...freshProduct, category: freshProduct.category ?? product.category });
      await loadPublicData();
    });
  }

  async function createReview(input: { productId: string; rating: number; title?: string; content: string }) {
    if (!requireLogin()) return;
    await runAction("review", async () => {
      const result = await api.post<{ review: ProductReview }>("/store/reviews", input);
      setReviews((current) => [result.review, ...current.filter((review) => review.id !== result.review.id)].slice(0, 18));
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
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  return (
    <main className="app-shell">
      <AuroraBackground />
      <Header
        customer={customer}
        balance={balance}
        activeTab={activeTab}
        catalog={catalog}
        language={language}
        cartCount={cartCount}
        onLanguage={changeLanguage}
        onTab={navigateTab}
        onLogin={() => setAuthOpen(true)}
        onLogout={logout}
        onWalletOpen={() => {
          if (token) setWalletOpen(true);
          else setAuthOpen(true);
        }}
        onCartOpen={() => setCartOpen(true)}
        cartButtonRef={cartButtonRef}
        cartPulse={cartPulse}
        onCommand={() => setCommandOpen(true)}
        onSection={navigateHomeSection}
      />
      <CartFlyLayer items={cartFlyItems} />

      {activeTab === "home" ? (
        <HomeTab
          catalog={catalog}
          products={products}
          reviews={reviews}
          loading={loading}
          error={error}
          language={language}
          onProduct={(product) => void openProduct(product)}
          onAddCart={addToCart}
          onCheckout={checkoutProduct}
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
          onAddCart={addToCart}
          onCheckout={checkoutProduct}
          language={language}
        />
      ) : null}

      {activeTab === "reviews" ? (
        <section className="shell tab-shell">
          <ReviewTab
            products={products}
            reviews={reviews}
            customer={customer}
            loading={loading}
            language={language}
            onLogin={() => setAuthOpen(true)}
            onSubmit={(input) => createReview(input)}
          />
        </section>
      ) : null}

      {activeTab === "history" ? (
        <section className="shell tab-shell">
          <HistoryPanel
            language={language}
            history={history}
            onRefresh={() => {
              if (token) void loadPrivateData();
              else setAuthOpen(true);
            }}
            loading={loading === "profile"}
          />
        </section>
      ) : null}

      <Footer language={language} onTab={navigateTab} onSection={navigateHomeSection} />

      {commandOpen ? (
        <CommandPalette
          products={products}
          language={language}
          onClose={() => setCommandOpen(false)}
          onOpenProduct={(product) => void openProduct(product)}
          onProducts={() => navigateTab("products")}
        />
      ) : null}

      {authOpen ? <AuthDialog language={language} onClose={() => setAuthOpen(false)} onSession={saveSession} /> : null}
      {walletOpen ? <WalletDialog language={language} balance={balance} loading={loading} onTopup={createTopup} onClose={() => setWalletOpen(false)} /> : null}
      {selectedProduct ? (
        <ProductDialog
          product={selectedProduct}
          initialQuantity={selectedQuantity}
          loading={loading}
          onClose={() => setSelectedProduct(null)}
          onAddCart={(quantity, origin) => addToCart(selectedProduct, quantity, origin)}
          onCheckout={(quantity) => checkoutProduct(selectedProduct, quantity)}
          language={language}
        />
      ) : null}
      {checkoutItem ? (
        <CheckoutDialog
          item={checkoutItem}
          customer={customer}
          balance={balance}
          loading={loading}
          actionError={error}
          language={language}
          onClose={() => setCheckoutItem(null)}
          onQuantity={updateCheckoutQuantity}
          onWallet={(quantity, voucherCode) => buyWithWallet(checkoutItem.product, quantity, voucherCode)}
          onBank={(quantity, voucherCode) => buyWithBank(checkoutItem.product, quantity, voucherCode)}
          onUsdt={(quantity, voucherCode) => buyWithUsdt(checkoutItem.product, quantity, voucherCode)}
          onWalletOpen={() => {
            setCheckoutItem(null);
            if (token) setWalletOpen(true);
            else setAuthOpen(true);
          }}
          onBackToCart={() => {
            setCheckoutItem(null);
            setCartOpen(true);
          }}
        />
      ) : null}
      {checkoutCartItems ? (
        <CartCheckoutDialog
          items={checkoutCartItems}
          customer={customer}
          balance={balance}
          loading={loading}
          actionError={error}
          language={language}
          onClose={() => setCheckoutCartItems(null)}
          onWallet={(voucherCode) => buyCartWithWallet(checkoutCartItems, voucherCode)}
          onBank={(voucherCode) => buyCartWithBank(checkoutCartItems, voucherCode)}
          onUsdt={(voucherCode) => buyCartWithUsdt(checkoutCartItems, voucherCode)}
          onWalletOpen={() => {
            setCheckoutCartItems(null);
            if (token) setWalletOpen(true);
            else setAuthOpen(true);
          }}
          onBackToCart={() => {
            setCheckoutCartItems(null);
            setCartOpen(true);
          }}
        />
      ) : null}
      {cartOpen ? (
        <CartDialog
          items={cartItems}
          language={language}
          total={cartTotal}
          onClose={() => setCartOpen(false)}
          onQuantity={updateCartQuantity}
          onRemove={removeFromCart}
          onCheckout={checkoutCartItem}
          onCheckoutAll={checkoutCartAll}
          onShop={() => {
            setCartOpen(false);
            navigateTab("products");
          }}
        />
      ) : null}
      {qr ? (
        <QrDialog
          payment={qr}
          status={qrStatus}
          loading={loading === "payment-status"}
          language={language}
          onClose={() => setQr(null)}
          onRefresh={() => void checkPaymentStatus(true)}
        />
      ) : null}
      {delivery ? <DeliveryDialog delivery={delivery} language={language} onClose={() => setDelivery(null)} /> : null}
      <FloatingCtas language={language} />
      {loading === "boot" ? (
        <div className="boot">
          <Loader2 className="spin" size={18} /> {TEXT[language].boot}
        </div>
      ) : null}
    </main>
  );
}

function AuroraBackground() {
  return (
    <div className="aurora-bg" aria-hidden="true">
      <span className="aurora-ribbon aurora-ribbon-one" />
      <span className="aurora-ribbon aurora-ribbon-two" />
      <span className="star-field" />
    </div>
  );
}

function Header({
  customer,
  balance,
  activeTab,
  catalog,
  language,
  cartCount,
  onLanguage,
  onTab,
  onLogin,
  onLogout,
  onWalletOpen,
  onCartOpen,
  cartButtonRef,
  cartPulse,
  onCommand,
  onSection
}: {
  customer: Session["customer"] | null;
  balance: number;
  activeTab: Tab;
  catalog: Catalog | null;
  language: Language;
  cartCount: number;
  onLanguage: (language: Language) => void;
  onTab: (tab: Tab) => void;
  onLogin: () => void;
  onLogout: () => void;
  onWalletOpen: () => void;
  onCartOpen: () => void;
  cartButtonRef: React.RefObject<HTMLButtonElement | null>;
  cartPulse: boolean;
  onCommand: () => void;
  onSection: (sectionId: string) => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const copy = TEXT[language];
  const headerCategories = buildCategoryTiles(catalog, language);
  const navItems: Array<{ tab: Tab; label: string }> = [
    { tab: "home", label: copy.navHome },
    { tab: "products", label: copy.navProducts },
    { tab: "reviews", label: copy.navReviews },
    { tab: "history", label: copy.navHistory }
  ];

  function goTab(tab: Tab) {
    setMobileOpen(false);
    onTab(tab);
  }

  return (
    <header className="site-top">
      <div className="announcement">
        <span>{language === "vi" ? "Ưu đãi chào hè, giảm đến 20% cho đơn hàng đầu tiên!" : "Summer offer, up to 20% off the first order!"}</span>
        <button onClick={() => onSection("faq")}>{language === "vi" ? "Hướng dẫn mua hàng" : "Buying guide"}</button>
        <button onClick={() => goTab("history")}>{language === "vi" ? "Kiểm tra đơn hàng" : "Track order"}</button>
        <a href="https://zalo.me/0377952999" target="_blank" rel="noreferrer">{language === "vi" ? "Liên hệ hỗ trợ" : "Support"}</a>
      </div>
      <div className="nav-shell">
        <button className="brand-lockup" onClick={() => goTab("home")} aria-label="VD AI Shop">
          <img src="/logo.png" alt="" />
          <span>
            <b>VD AI Shop</b>
            <small>AI. Premium. Software.</small>
          </span>
        </button>

        <nav className="desktop-nav" aria-label={language === "vi" ? "Điều hướng chính" : "Main navigation"}>
          {navItems.slice(0, 2).map((item) => (
            <button key={item.tab} className={activeTab === item.tab ? "active" : ""} onClick={() => goTab(item.tab)}>
              {item.label}
            </button>
          ))}
          <div className="nav-dropdown">
            <button type="button">
              {language === "vi" ? "Danh mục" : "Categories"} <ChevronDown size={14} />
            </button>
            <div className="mega-menu">
              {headerCategories.length ? (
                headerCategories.map((category) => (
                  <button key={category.id} onClick={() => goTab("products")}>
                    <span className={`category-mini ${category.tone}`}>{category.icon}</span>
                    <span>
                      <b>{category.name}</b>
                      <small>{category.count} {language === "vi" ? "sản phẩm" : "products"}</small>
                    </span>
                  </button>
                ))
              ) : (
                <button onClick={() => goTab("products")}>
                  <span className="category-mini"><Loader2 className="spin" size={18} /></span>
                  <span>
                    <b>{language === "vi" ? "Đang cập nhật danh mục" : "Updating categories"}</b>
                    <small>{language === "vi" ? "Sản phẩm mới nhất" : "Latest products"}</small>
                  </span>
                </button>
              )}
            </div>
          </div>
          <button onClick={() => onSection("featured-products")}>{language === "vi" ? "Khuyến mãi" : "Deals"}</button>
          <button onClick={() => onSection("faq")}>{language === "vi" ? "Hỗ trợ" : "Support"}</button>
        </nav>

        <button className="header-search" onClick={onCommand}>
          <Search size={15} />
          <span>{copy.searchPlaceholder}</span>
        </button>

        <div className="header-actions">
          <button className="lang-toggle" onClick={() => onLanguage(language === "vi" ? "en" : "vi")} aria-label="Switch language">
            {language === "vi" ? "EN" : "VI"}
          </button>
          {customer ? (
            <button className="wallet-button" onClick={onWalletOpen}>
              <Wallet size={16} />
              <span>{formatVnd(balance)}</span>
            </button>
          ) : (
            <button className="login-button" onClick={onLogin}>
              {copy.login}
            </button>
          )}
          <button className="topup-button" onClick={onWalletOpen}>
            <Wallet size={16} />
            <span>{copy.topupTitle}</span>
          </button>
          <button className={`cart-button${cartPulse ? " cart-arrived" : ""}`} ref={cartButtonRef} onClick={onCartOpen} aria-label={copy.cart}>
            <ShoppingCart size={19} />
            {cartCount ? <b>{cartCount}</b> : null}
          </button>
          {customer ? (
            <button className="icon-button logout-button" onClick={onLogout} aria-label={copy.logout}>
              <LogOut size={17} />
            </button>
          ) : null}
          <button className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={21} />
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="mobile-menu-panel">
          <div>
            <button className="brand-lockup" onClick={() => goTab("home")}>
              <img src="/logo.png" alt="" />
              <span>
                <b>VD AI Shop</b>
                <small>AI. Premium. Software.</small>
              </span>
            </button>
            <button className="icon-button" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X size={19} />
            </button>
          </div>
          <button className="mobile-command" onClick={onCommand}>
            <Search size={16} /> {copy.searchPlaceholder}
          </button>
          {navItems.map((item) => (
            <button key={item.tab} className={activeTab === item.tab ? "active" : ""} onClick={() => goTab(item.tab)}>
              {item.label}
              <ChevronRight size={17} />
            </button>
          ))}
          <button onClick={onWalletOpen}>
            {copy.topupTitle}
            <ChevronRight size={17} />
          </button>
        </div>
      ) : null}
    </header>
  );
}

function CartFlyLayer({ items }: { items: CartFlyItem[] }) {
  if (!items.length) return null;
  return (
    <div className="cart-fly-layer" aria-hidden="true">
      {items.map((item) => {
        const motionStyle = {
          "--fly-left": `${item.left}px`,
          "--fly-top": `${item.top}px`,
          "--fly-width": `${item.width}px`,
          "--fly-height": `${item.height}px`,
          "--fly-center-x": `${item.centerX}px`,
          "--fly-center-y": `${item.centerY}px`,
          "--fly-target-x": `${item.targetX}px`,
          "--fly-target-y": `${item.targetY}px`,
          "--fly-dx": `${item.dx}px`,
          "--fly-dy": `${item.dy}px`,
          "--fly-shrink-x": `${item.shrinkX}px`,
          "--fly-shrink-y": `${item.shrinkY}px`,
          "--fly-early-x": `${item.earlyX}px`,
          "--fly-early-y": `${item.earlyY}px`,
          "--fly-mid-x": `${item.midX}px`,
          "--fly-mid-y": `${item.midY}px`,
          "--fly-late-x": `${item.lateX}px`,
          "--fly-late-y": `${item.lateY}px`,
          "--fly-arc1-x": `${item.arc1X}px`,
          "--fly-arc1-y": `${item.arc1Y}px`,
          "--fly-arc2-x": `${item.arc2X}px`,
          "--fly-arc2-y": `${item.arc2Y}px`,
          "--fly-arc3-x": `${item.arc3X}px`,
          "--fly-arc3-y": `${item.arc3Y}px`,
          "--fly-arc4-x": `${item.arc4X}px`,
          "--fly-arc4-y": `${item.arc4Y}px`,
          "--fly-arc5-x": `${item.arc5X}px`,
          "--fly-arc5-y": `${item.arc5Y}px`,
          "--fly-arc6-x": `${item.arc6X}px`,
          "--fly-arc6-y": `${item.arc6Y}px`
        } as React.CSSProperties;

        return (
          <React.Fragment key={item.id}>
            <svg
              className="cart-fly-trail"
              style={{
                left: `${item.trailLeft}px`,
                top: `${item.trailTop}px`,
                width: `${item.trailWidth}px`,
                height: `${item.trailHeight}px`
              }}
              viewBox={`0 0 ${item.trailWidth} ${item.trailHeight}`}
            >
              <path className="cart-fly-trail-halo" d={item.trailPath} pathLength={1} />
              <path className="cart-fly-trail-line" d={item.trailPath} pathLength={1} />
            </svg>

            <div className="cart-fly-ghost" style={motionStyle} />
            {[-28, -8, 18, 38].map((offset, index) => (
              <i
                className="cart-fly-spark"
                key={`${item.id}-spark-${index}`}
                style={
                  {
                    ...motionStyle,
                    "--spark-delay": `${index * 40}ms`,
                    "--spark-x": `${offset}px`,
                    "--spark-y": `${index % 2 ? -18 : 16}px`,
                    "--spark-size": `${index % 3 === 0 ? 7 : 5}px`
                  } as React.CSSProperties
                }
              />
            ))}

            <div className="cart-fly-card" style={motionStyle}>
              <em className="cart-fly-badge">{item.deliveryLabel}</em>
              <div className="cart-fly-media">
                {item.image ? <img src={item.image} alt="" /> : <span className="cart-fly-glyph">{item.glyph}</span>}
              </div>
              <span className="cart-fly-copy">
                <i>{item.categoryName}</i>
                <b>{item.name}</b>
                <small>{item.description}</small>
              </span>
              <span className="cart-fly-meta">
                <i>{item.deliveryLabel}</i>
                <i>{item.stockLabel}</i>
              </span>
              <span className="cart-fly-price">
                <small>{item.price}</small>
              </span>
              <span className="cart-fly-actions">
                <i>{item.actionText}</i>
                <i>{item.buyText}</i>
              </span>
            </div>

            <span className="cart-fly-pop" style={motionStyle}>+1</span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function HomeTab({
  catalog,
  products,
  reviews,
  loading,
  error,
  language,
  onProduct,
  onAddCart,
  onCheckout,
  onShop,
  onWallet
}: {
  catalog: Catalog | null;
  products: Product[];
  reviews: ProductReview[];
  loading: string;
  error: string;
  language: Language;
  onProduct: (product: Product) => void;
  onAddCart: (product: Product, quantity?: number, origin?: Element | null) => void;
  onCheckout: (product: Product, quantity?: number) => void;
  onShop: () => void;
  onWallet: () => void;
}) {
  return (
    <>
      <Hero products={products} loading={loading} error={error} language={language} onShop={onShop} onWallet={onWallet} />
      <CategoryRail catalog={catalog} language={language} onShop={onShop} />
      <FeaturedProducts
        products={products.slice(0, 8)}
        loading={loading}
        error={error}
        language={language}
        onProduct={onProduct}
        onAddCart={onAddCart}
        onCheckout={onCheckout}
        onShop={onShop}
      />
      <BenefitsStats products={products} reviews={reviews} language={language} />
      <ReviewsFaq reviews={reviews} language={language} />
    </>
  );
}

function Hero({
  products,
  loading,
  error,
  language,
  onShop,
  onWallet
}: {
  products: Product[];
  loading: string;
  error: string;
  language: Language;
  onShop: () => void;
  onWallet: () => void;
}) {
  const vi = language === "vi";
  const heroCards = buildHeroCards(products, language);
  const waitingForApi = !heroCards.length && loading !== "" && !error;
  const orbit = useHeroOrbit(heroCards.length);

  return (
    <section className="hero-section">
      <div className="hero-copy reveal">
        <h1>
          {vi ? "Mua tài khoản AI & Premium" : "Buy AI & Premium accounts"}
          <span>{vi ? "Nhanh chóng - An toàn - Giá tốt" : "Fast - Secure - Fair price"}</span>
        </h1>
        <p>
          {vi
            ? "VD AI Shop cung cấp tài khoản AI, phần mềm và dịch vụ số chính hãng, giao tự động 24/7, bảo hành uy tín."
            : "VD AI Shop provides AI accounts, premium software and digital services with 24/7 automated delivery and clear support."}
        </p>
        <div className="hero-actions">
          <button className="primary-button" onClick={onShop}>
            <Zap size={17} />
            {TEXT[language].shopCta}
          </button>
          <button className="secondary-button" onClick={onShop}>
            <ShoppingBag size={17} />
            {TEXT[language].catalogCta}
          </button>
        </div>
        <div className="trust-chips" aria-label={vi ? "Cam kết" : "Trust signals"}>
          <span><TimerReset size={15} /> {vi ? "Giao tự động 24/7" : "24/7 delivery"}</span>
          <span><ShieldCheck size={15} /> {vi ? "Bảo hành theo sản phẩm" : "Product warranty"}</span>
          <span><BadgeCheck size={15} /> {vi ? "Hoàn tiền 100% nếu lỗi" : "Refund if failed"}</span>
        </div>
      </div>

      <div
        className={`hero-showcase${heroCards.length ? "" : " is-empty"}`}
        ref={orbit.containerRef}
        aria-label={vi ? "Sản phẩm nổi bật" : "Featured products"}
      >
        <span className="energy-line" />
        {heroCards.length ? (
          heroCards.map((card, index) => (
            <article
              className={`floating-product-card ${card.tone}`}
              ref={(node) => orbit.setItemRef(node, index)}
              onPointerEnter={() => orbit.setPaused(true)}
              onPointerLeave={() => orbit.setPaused(false)}
              onFocus={() => orbit.setPaused(true)}
              onBlur={() => orbit.setPaused(false)}
              key={card.id}
            >
              <img src={card.image} alt="" loading={index < 2 ? "eager" : "lazy"} />
              <strong>{card.name}</strong>
              <small>{card.meta}</small>
              <b>{card.price}</b>
            </article>
          ))
        ) : (
          <div className="api-sync-card">
            <Loader2 className={waitingForApi ? "spin" : ""} size={24} />
            <strong>{error ? (vi ? "Chưa tải được sản phẩm" : "Products are unavailable") : (vi ? "Đang cập nhật sản phẩm" : "Updating products")}</strong>
            <small>{friendlyCatalogMessage(error, language)}</small>
          </div>
        )}
      </div>
    </section>
  );
}

function CategoryRail({ catalog, language, onShop }: { catalog: Catalog | null; language: Language; onShop: () => void }) {
  const tiles = buildCategoryTiles(catalog, language);

  return (
    <section className="category-rail shell" aria-label={language === "vi" ? "Danh mục" : "Categories"}>
      {tiles.length
        ? tiles.map((category) => (
            <button className={`category-card ${category.tone} reveal`} key={category.id} onClick={onShop}>
              <span>{category.icon}</span>
              <b>{category.name}</b>
              <small>{category.count} {language === "vi" ? "sản phẩm" : "products"}</small>
            </button>
          ))
        : Array.from({ length: 4 }, (_, index) => (
            <div className="category-card category-skeleton reveal" key={index}>
              <span />
              <b />
              <small />
            </div>
          ))}
    </section>
  );
}

function FeaturedProducts({
  products,
  loading,
  error,
  language,
  onProduct,
  onAddCart,
  onCheckout,
  onShop
}: {
  products: Product[];
  loading: string;
  error: string;
  language: Language;
  onProduct: (product: Product) => void;
  onAddCart: (product: Product, quantity?: number, origin?: Element | null) => void;
  onCheckout: (product: Product, quantity?: number) => void;
  onShop: () => void;
}) {
  const vi = language === "vi";
  const [filter, setFilter] = useState("best");
  const shownProducts = useMemo(() => sortProducts(products, filter), [products, filter]);
  const filters = vi
    ? [
        ["best", "Còn hàng nhiều"],
        ["new", "Mới nhất"],
        ["low", "Giá thấp đến cao"],
        ["high", "Giá cao đến thấp"]
      ]
    : [
        ["best", "Most available"],
        ["new", "Newest"],
        ["low", "Low to high"],
        ["high", "High to low"]
      ];

  return (
    <section className="shell product-section" id="featured-products">
      <div className="section-title-row">
        <div>
          <p className="section-kicker reveal"><Zap size={16} /> {vi ? "Sản phẩm nổi bật" : "Featured products"}</p>
          <h2 className="reveal" style={{ "--d": "70ms" } as React.CSSProperties}>{vi ? "Tài khoản AI và dịch vụ premium đang được chọn nhiều" : "Popular AI access and premium digital services"}</h2>
        </div>
        <button className="link-action reveal" onClick={onShop} style={{ "--d": "120ms" } as React.CSSProperties}>
          {vi ? "Xem tất cả" : "View all"} <ArrowRight size={16} />
        </button>
      </div>
      <div className="filter-pills reveal" style={{ "--d": "150ms" } as React.CSSProperties}>
        {filters.map(([id, label]) => (
          <button className={filter === id ? "active" : ""} key={id} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="product-grid featured-grid">
        {shownProducts.length ? (
          shownProducts.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              loading={loading}
              language={language}
              index={index}
              onView={() => onProduct(product)}
              onAddCart={(origin) => onAddCart(product, 1, origin)}
              onCheckout={() => onCheckout(product, 1)}
            />
          ))
        ) : loading ? (
          <SkeletonGrid language={language} />
        ) : (
          <EmptyState
            icon={<RefreshCw size={28} />}
            title={error ? (vi ? "Chưa tải được sản phẩm" : "Products are unavailable") : TEXT[language].noProducts}
            text={error ? friendlyCatalogMessage(error, language) : (vi ? "Sản phẩm sẽ hiển thị tại đây khi cửa hàng được cập nhật." : "Products will appear here when the store is updated.")}
            actionLabel={vi ? "Thử lại" : "Retry"}
            onAction={() => window.location.reload()}
          />
        )}
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
  onAddCart,
  onCheckout,
  language
}: {
  groups: ProductGroup[];
  productCount: number;
  query: string;
  loading: string;
  error: string;
  onQuery: (value: string) => void;
  onView: (product: Product) => void;
  onAddCart: (product: Product, quantity?: number, origin?: Element | null) => void;
  onCheckout: (product: Product, quantity?: number) => void;
  language: Language;
}) {
  const copy = TEXT[language];
  const vi = language === "vi";
  const [sort, setSort] = useState("popular");
  const [delivery, setDelivery] = useState("all");
  const allProducts = useMemo(() => groups.flatMap((group) => group.products), [groups]);
  const visibleProducts = useMemo(() => {
    const filtered = delivery === "all" ? allProducts : allProducts.filter((product) => product.deliveryType === delivery);
    return sortProducts(filtered, sort);
  }, [allProducts, delivery, sort]);

  return (
    <section className="shell catalog-page">
      <div className="catalog-heading reveal">
        <div className="breadcrumb">
          <Home size={14} />
          <span>{copy.navHome}</span>
          <ChevronRight size={13} />
          <b>{copy.navProducts}</b>
        </div>
        <h1>{vi ? "Kho sản phẩm AI & Premium" : "AI & Premium product catalog"}</h1>
        <p>{vi ? "Tìm kiếm, lọc theo kiểu giao hàng và thanh toán bằng ví, VietQR hoặc USDT." : "Search, filter by delivery type and checkout with wallet, VietQR or USDT."}</p>
      </div>

      <div className="catalog-layout">
        <aside className="filter-panel reveal" style={{ "--d": "80ms" } as React.CSSProperties}>
          <h2>{vi ? "Bộ lọc" : "Filters"}</h2>
          <label>
            {vi ? "Tìm kiếm" : "Search"}
            <div className="search-field">
              <Search size={16} />
              <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
            </div>
          </label>
          <label>
            {vi ? "Loại giao hàng" : "Delivery type"}
            <select value={delivery} onChange={(event) => setDelivery(event.target.value)}>
              <option value="all">{vi ? "Tất cả" : "All"}</option>
              <option value="STOCK_ITEM">{vi ? "Giao tự động" : "Auto delivery"}</option>
              <option value="SHARED_CONTENT">{vi ? "Mở nội dung" : "Shared content"}</option>
              <option value="MANUAL">{vi ? "Admin xử lý" : "Manual support"}</option>
            </select>
          </label>
          <label>
            {vi ? "Sắp xếp" : "Sort"}
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="popular">{vi ? "Phổ biến" : "Popular"}</option>
              <option value="new">{vi ? "Mới nhất" : "Newest"}</option>
              <option value="low">{vi ? "Giá tăng dần" : "Price low to high"}</option>
              <option value="high">{vi ? "Giá giảm dần" : "Price high to low"}</option>
            </select>
          </label>
          <div className="filter-stat">
            <b>{productCount}</b>
            <span>{vi ? "sản phẩm phù hợp" : "matching products"}</span>
          </div>
        </aside>

        <div className="catalog-results">
          {error ? <div className="alert">{error}</div> : null}
          <div className="product-grid">
            {visibleProducts.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                loading={loading}
                language={language}
                index={index}
                onView={() => onView(product)}
                onAddCart={(origin) => onAddCart(product, 1, origin)}
                onCheckout={() => onCheckout(product, 1)}
              />
            ))}
          </div>
          {!visibleProducts.length ? (
            <EmptyState
              icon={<Search size={30} />}
              title={copy.noProducts}
              text={vi ? "Thử đổi từ khóa hoặc bỏ bớt bộ lọc để xem thêm sản phẩm." : "Try a different keyword or reset filters to see more products."}
              actionLabel={vi ? "Xóa bộ lọc" : "Reset filters"}
              onAction={() => {
                onQuery("");
                setDelivery("all");
                setSort("popular");
              }}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ProductCard({
  product,
  loading,
  onView,
  onAddCart,
  onCheckout,
  language,
  index = 0
}: {
  product: Product;
  loading: string;
  onView: () => void;
  onAddCart: (origin?: Element | null) => void;
  onCheckout: () => void;
  language: Language;
  index?: number;
}) {
  const stock = availableQuantity(product);
  const disabled = stock <= 0;
  const opening = loading === `product:${product.id}`;
  const actionLoading = loading === `wallet:${product.id}` || loading === `bank:${product.id}` || loading === `usdt:${product.id}`;
  const imageSrc = productArtUrl(product);
  const copy = TEXT[language];
  const stockLabel = product.deliveryType === "SHARED_CONTENT" ? copy.unlimited : `${stock} ${copy.left}`;

  function setPointer(event: React.MouseEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
    event.currentTarget.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
  }

  function handleAddCart(event: React.MouseEvent<HTMLButtonElement>) {
    const card = event.currentTarget.closest(".product-card");
    onAddCart(card ?? event.currentTarget);
  }

  return (
    <article className="product-card reveal" onMouseMove={setPointer} style={{ "--d": `${Math.min(index, 7) * 45}ms` } as React.CSSProperties}>
      <div className="product-badges">
        <span>{postPaymentLabel(product.deliveryType, language)}</span>
        {disabled ? <em>{language === "vi" ? "Hết hàng" : "Sold out"}</em> : null}
      </div>
      <button className="product-image-button" onClick={onView} aria-label={`${copy.detail}: ${localizedName(product, language)}`}>
        {imageSrc ? <img src={imageSrc} alt={`${localizedName(product, language)} - VD AI Shop`} loading="lazy" referrerPolicy="no-referrer" /> : <span>{brandGlyph(product.name)}</span>}
      </button>
      <div className="product-copy">
        <small>{product.category?.name ?? copy.categoryFallback}</small>
        <h3>{localizedName(product, language)}</h3>
        <p>{localizedDescription(product, language) || copy.deliveryFallback}</p>
      </div>
      <div className="product-meta">
        <span><PackageCheck size={14} /> {postPaymentLabel(product.deliveryType, language)}</span>
        <span>{stockLabel}</span>
      </div>
      <div className="product-price-row">
        <b>{formatProductPrice(product, language)}</b>
        <small>{product.category?.name ?? copy.categoryFallback}</small>
      </div>
      <div className="product-card-actions">
        <button className="ghost-small" onClick={handleAddCart} disabled={disabled || opening || actionLoading}>
          <ShoppingCart size={15} />
          {copy.addCart}
        </button>
        <button className="solid-small" onClick={onCheckout} disabled={disabled || opening || actionLoading}>
          {opening || actionLoading ? <Loader2 className="spin" size={15} /> : <Zap size={15} />}
          {copy.buy}
        </button>
      </div>
    </article>
  );
}

function BenefitsStats({ products, reviews, language }: { products: Product[]; reviews: ProductReview[]; language: Language }) {
  const vi = language === "vi";
  const autoDeliveryCount = products.filter((product) => product.deliveryType !== "MANUAL").length;
  const categoryCount = new Set(products.map((product) => product.category?.id).filter(Boolean)).size;
  const averageRating = reviews.length ? (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1) : null;
  const benefits = vi
    ? [
        ["Giao hàng tự động 24/7", "Nhận ngay sau khi thanh toán"],
        ["Sản phẩm chính hãng", "Nguồn gốc rõ ràng, uy tín"],
        ["Giá tốt nhất thị trường", "Luôn cập nhật ưu đãi"],
        ["Bảo hành uy tín", "Hỗ trợ nhanh chóng"],
        ["Thanh toán an toàn", "Đa dạng phương thức"]
      ]
    : [
        ["24/7 auto delivery", "Receive after payment"],
        ["Verified products", "Clear source and support"],
        ["Fair market price", "Updated promotions"],
        ["Trusted warranty", "Responsive assistance"],
        ["Secure checkout", "Multiple payment methods"]
      ];
  const stats = [
    [products.length ? String(products.length) : vi ? "Đa dạng" : "Curated", vi ? "Sản phẩm đang bán" : "Products on sale"],
    [categoryCount ? String(categoryCount) : vi ? "Nổi bật" : "Featured", vi ? "Danh mục nổi bật" : "Featured categories"],
    [autoDeliveryCount ? String(autoDeliveryCount) : vi ? "Nhanh" : "Fast", vi ? "Giao tự động" : "Auto delivery"],
    [averageRating ? `${averageRating}/5` : vi ? "Tốt" : "Positive", vi ? "Phản hồi khách hàng" : "Customer feedback"],
    [vi ? "Mượt" : "Smooth", vi ? "Truy cập ổn định" : "Website experience"]
  ];

  return (
    <section className="shell benefits-section">
      <div className="benefit-head reveal">
        <h2>{vi ? "Vì sao chọn VD AI Shop?" : "Why choose VD AI Shop?"}</h2>
        <div className="benefit-list">
          {benefits.map(([title, text], index) => (
            <article key={title}>
              <span>{index % 2 ? <BadgeCheck size={20} /> : <ShieldCheck size={20} />}</span>
              <b>{title}</b>
              <small>{text}</small>
            </article>
          ))}
        </div>
      </div>
      <div className="stats-panel reveal" style={{ "--d": "110ms" } as React.CSSProperties}>
        {stats.map(([value, label]) => (
          <div key={label}>
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewsFaq({ reviews, language }: { reviews: ProductReview[]; language: Language }) {
  const vi = language === "vi";
  const shownReviews = reviews.slice(0, 3);

  return (
    <section className="shell review-faq-grid" id="faq">
      <div className="review-panel reveal">
        <h2>{vi ? "Khách hàng nói gì về chúng tôi" : "What customers say"}</h2>
        {shownReviews.length ? (
          <div className="review-cards">
            {shownReviews.map((review, index) => <ReviewCard review={review} language={language} index={index} key={review.id} />)}
          </div>
        ) : (
          <div className="api-empty-state">
            <BadgeCheck size={22} />
            <b>{vi ? "Phản hồi đang được cập nhật" : "Feedback is being updated"}</b>
            <p>{vi ? "Cửa hàng ưu tiên giao nhanh, hỗ trợ rõ ràng và xử lý lỗi gọn gàng cho từng đơn." : "The store focuses on fast delivery, clear support and tidy issue handling for every order."}</p>
          </div>
        )}
      </div>
      <FaqAccordion language={language} />
    </section>
  );
}

function ReviewCard({ review, language, index = 0 }: { review: ProductReview; language: Language; index?: number }) {
  const productName = localizedReviewProductName(review, language);
  return (
    <article className="testimonial-card reveal" style={{ "--d": `${index * 70}ms` } as React.CSSProperties}>
      <div>
        <img src={reviewProductArtUrl(review)} alt="" loading="lazy" referrerPolicy="no-referrer" />
        <b>{review.author}</b>
        <small>{productName}</small>
      </div>
      <strong aria-label={`${review.rating}/5`}>{renderStars(review.rating)}</strong>
      {review.title ? <h3>{review.title}</h3> : null}
      <p>{review.content}</p>
    </article>
  );
}

function FaqAccordion({ language }: { language: Language }) {
  const [open, setOpen] = useState(0);
  const vi = language === "vi";
  const items = vi
    ? [
        ["Sản phẩm được giao như thế nào?", "Sản phẩm tự động sẽ mở thông tin sau khi hệ thống xác nhận thanh toán. Sản phẩm thủ công sẽ hiển thị hướng dẫn liên hệ admin."],
        ["Tài khoản có bảo hành không?", "Mỗi sản phẩm có chính sách bảo hành riêng. Nếu lỗi đúng phạm vi bảo hành, đội hỗ trợ sẽ xử lý hoặc hoàn tiền theo chính sách."],
        ["Thanh toán những phương thức nào?", "Website hỗ trợ ví nội bộ, VietQR và USDT nếu sản phẩm có giá USDT."],
        ["Tôi có thể yêu cầu hoàn tiền không?", "Có, nếu đơn hàng không thể giao đúng mô tả hoặc giao dịch cần xử lý theo chính sách hoàn tiền."]
      ]
    : [
        ["How is delivery handled?", "Automatic products unlock delivery details after payment confirmation. Manual products show admin contact instructions."],
        ["Is warranty included?", "Each product has its own warranty policy. If the issue is covered, support will replace or refund according to policy."],
        ["Which payment methods are supported?", "The website supports internal wallet, VietQR and USDT when a product has USDT pricing."],
        ["Can I request a refund?", "Yes, when the order cannot be delivered as described or the transaction falls under the refund policy."]
      ];

  return (
    <div className="faq-panel reveal" style={{ "--d": "100ms" } as React.CSSProperties}>
      <h2>{vi ? "Câu hỏi thường gặp" : "Frequently asked questions"}</h2>
      {items.map(([question, answer], index) => (
        <div className={`faq-item ${open === index ? "open" : ""}`} key={question}>
          <button onClick={() => setOpen(open === index ? -1 : index)}>
            {question}
            <ChevronDown size={17} />
          </button>
          <p>{answer}</p>
        </div>
      ))}
    </div>
  );
}

function CommandPalette({
  products,
  language,
  onClose,
  onOpenProduct,
  onProducts
}: {
  products: Product[];
  language: Language;
  onClose: () => void;
  onOpenProduct: (product: Product) => void;
  onProducts: () => void;
}) {
  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const normalized = search.toLocaleLowerCase("vi-VN").trim();
    const pool = normalized
      ? products.filter((product) => `${localizedName(product, language)} ${localizedDescription(product, language) ?? ""}`.toLocaleLowerCase("vi-VN").includes(normalized))
      : products;
    return pool.slice(0, 8);
  }, [products, search, language]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function pick(product: Product) {
    requestClose();
    window.setTimeout(() => onOpenProduct(product), 230);
  }

  function keyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(matches.length - 1, value + 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(0, value - 1));
    }
    if (event.key === "Enter" && matches[active]) {
      event.preventDefault();
      pick(matches[active]);
    }
  }

  return (
    <div className={`overlay command-overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <section className="command-panel" role="dialog" aria-modal="true" aria-label={language === "vi" ? "Tìm kiếm sản phẩm" : "Product search"}>
        <div className="command-input">
          <Search size={19} />
          <input
            ref={inputRef}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(0);
            }}
            onKeyDown={keyDown}
            placeholder={TEXT[language].searchPlaceholder}
          />
          <button onClick={requestClose}><X size={17} /></button>
        </div>
        <div className="command-suggestions">
          {matches.map((product, index) => (
            <button className={active === index ? "active" : ""} onMouseEnter={() => setActive(index)} onClick={() => pick(product)} key={product.id}>
              <img src={productArtUrl(product)} alt="" loading="lazy" />
              <span>
                <b>{localizedName(product, language)}</b>
                <small>{formatProductPrice(product, language)} · {postPaymentLabel(product.deliveryType, language)}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
          {!matches.length ? (
            <EmptyState
              icon={<Search size={26} />}
              title={language === "vi" ? "Không tìm thấy sản phẩm" : "No products found"}
              text={language === "vi" ? "Thử tìm ChatGPT, Canva, Gemini hoặc YouTube." : "Try ChatGPT, Canva, Gemini or YouTube."}
            />
          ) : null}
        </div>
        <div className="command-footer">
          <button onClick={onProducts}>{language === "vi" ? "Mở trang sản phẩm" : "Open products page"} <ArrowRight size={15} /></button>
        </div>
      </section>
    </div>
  );
}

function ProductDialog({
  product,
  initialQuantity,
  loading,
  onClose,
  onAddCart,
  onCheckout,
  language
}: {
  product: Product;
  initialQuantity: number;
  loading: string;
  onClose: () => void;
  onAddCart: (quantity: number, origin?: Element | null) => void;
  onCheckout: (quantity: number) => void;
  language: Language;
}) {
  const stock = availableQuantity(product);
  const maxQuantity = product.deliveryType === "SHARED_CONTENT" ? 999 : Math.max(0, stock);
  const [quantity, setQuantity] = useState(Math.max(1, Math.min(Math.max(1, maxQuantity), initialQuantity)));
  const [tab, setTab] = useState<"desc" | "flow" | "faq" | "reviews">("desc");
  const imageSrc = productArtUrl(product);
  const copy = TEXT[language];
  const vi = language === "vi";
  const invalidQuantity = quantity < 1 || quantity > maxQuantity || maxQuantity <= 0;
  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: localizedName(product, language),
    image: imageSrc,
    description: localizedDescription(product, language) || copy.deliveryFallback,
    offers: {
      "@type": "Offer",
      price: product.price,
      priceCurrency: "VND",
      availability: stock > 0 || product.deliveryType === "SHARED_CONTENT" ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
    }
  });

  useEffect(() => {
    setQuantity(Math.max(1, Math.min(Math.max(1, maxQuantity), initialQuantity)));
  }, [initialQuantity, maxQuantity, product.id]);

  function handleAddCart(event: React.MouseEvent<HTMLButtonElement>) {
    const dialog = event.currentTarget.closest(".product-detail-modal");
    onAddCart(quantity, dialog?.querySelector(".gallery-main") ?? event.currentTarget);
  }

  return (
    <div className={`overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <section className="dialog product-detail-modal" role="dialog" aria-modal="true" aria-label={localizedName(product, language)}>
        <script type="application/ld+json">{schema}</script>
        <button className="close-button" onClick={requestClose} aria-label="Close"><X size={18} /></button>
        <div className="product-detail-grid">
          <div className="product-gallery">
            <div className="gallery-main">
              {imageSrc ? <img src={imageSrc} alt={`${localizedName(product, language)} - VD AI Shop`} /> : <span>{brandGlyph(product.name)}</span>}
            </div>
            <div className="thumbnail-row">
              {[0, 1, 2, 3].map((item) => (
                <button className={item === 0 ? "active" : ""} key={item}>
                  {imageSrc ? <img src={imageSrc} alt="" /> : <span>{brandGlyph(product.name)}</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="product-info-pane">
            <div className="breadcrumb small">
              <span>{copy.navHome}</span>
              <ChevronRight size={13} />
              <span>{product.category?.name ?? copy.categoryFallback}</span>
            </div>
            <h2>{localizedName(product, language)}</h2>
            <div className="rating-row">
              <span><PackageCheck size={15} /> {product.category?.name ?? copy.categoryFallback}</span>
              <b>{postPaymentLabel(product.deliveryType, language)}</b>
              <b>{product.deliveryType === "SHARED_CONTENT" ? copy.unlimited : `${stock} ${copy.left}`}</b>
            </div>
            <div className="trust-row">
              <span><ShieldCheck size={14} /> {vi ? "Nguồn chính hãng" : "Verified source"}</span>
              <span><Zap size={14} /> {postPaymentLabel(product.deliveryType, language)}</span>
              <span><BadgeCheck size={14} /> {vi ? "Hoàn tiền nếu lỗi" : "Refund if failed"}</span>
            </div>
            <p className="product-description">{localizedDescription(product, language) || copy.deliveryFallback}</p>
            <div className="detail-price">
              <b>{formatProductPrice(product, language)}</b>
            </div>
            <p className="stock-note">
              <Check size={15} />
              {product.deliveryType === "SHARED_CONTENT" ? copy.unlimited : `${stock} ${copy.left}`}
            </p>

            <div className="package-selector api-package">
              <button className="active">
                <b>{localizedName(product, language)}</b>
                <span>{formatProductPrice(product, language)}</span>
              </button>
            </div>

            <QuantityControl value={quantity} max={Math.max(1, maxQuantity)} label={copy.quantity} onChange={setQuantity} />

            <div className="product-tabs">
              {[
                ["desc", vi ? "Mô tả" : "Description"],
                ["flow", vi ? "Quy trình nhận hàng" : "Delivery flow"],
                ["faq", vi ? "Câu hỏi" : "FAQ"],
                ["reviews", vi ? "Đánh giá" : "Reviews"]
              ].map(([id, label]) => (
                <button className={tab === id ? "active" : ""} onClick={() => setTab(id as typeof tab)} key={id}>
                  {label}
                </button>
              ))}
            </div>
            <div className="tab-content">
              {tab === "desc" ? (
                <div className="feature-list">
                  <span><Sparkles size={17} /> GPT-4o, Claude, Gemini hoặc phần mềm premium theo sản phẩm.</span>
                  <span><TimerReset size={17} /> {vi ? "Kích hoạt và giao hàng nhanh sau thanh toán." : "Fast activation after payment."}</span>
                  <span><Headphones size={17} /> {vi ? "Hỗ trợ kỹ thuật trong quá trình sử dụng." : "Technical support during use."}</span>
                </div>
              ) : null}
              {tab === "flow" ? <DeliveryTimeline language={language} /> : null}
              {tab === "faq" ? <FaqAccordion language={language} /> : null}
              {tab === "reviews" ? <p>{vi ? "Đánh giá thật sẽ hiển thị từ dữ liệu khách hàng đã gửi." : "Customer reviews are loaded from submitted product feedback."}</p> : null}
            </div>
          </div>

          <aside className="purchase-summary">
            <div className="summary-product">
              <img src={imageSrc} alt="" />
              <div>
                <b>{localizedName(product, language)}</b>
                <span>{vi ? "Gói hiện tại" : "Current package"}</span>
              </div>
            </div>
            <strong>{formatProductTotal(product, quantity, language)}</strong>
            <ul>
              <li><Check size={14} /> {vi ? "Kích hoạt tự động" : "Automatic activation"}</li>
              <li><Check size={14} /> {vi ? "Bảo hành 100% nếu lỗi" : "Warranty if failed"}</li>
              <li><Check size={14} /> {vi ? "Hỗ trợ 24/7" : "24/7 support"}</li>
              <li><Check size={14} /> {vi ? "Hướng dẫn chi tiết" : "Detailed guide"}</li>
            </ul>
            <button className="primary-button" onClick={() => onCheckout(quantity)} disabled={invalidQuantity || loading.includes(product.id)}>
              <Zap size={17} />
              {copy.buy}
            </button>
            <button className="secondary-button" onClick={handleAddCart} disabled={invalidQuantity}>
              <ShoppingCart size={17} />
              {copy.addCart}
            </button>
            <div className="payment-badges">
              <span>VISA</span><span>MoMo</span><span>ZaloPay</span><span>VietQR</span>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function CheckoutDialog({
  item,
  customer,
  balance,
  loading,
  actionError,
  language,
  onClose,
  onQuantity,
  onWallet,
  onBank,
  onUsdt,
  onWalletOpen,
  onBackToCart
}: {
  item: CartItem;
  customer: Session["customer"] | null;
  balance: number;
  loading: string;
  actionError: string;
  language: Language;
  onClose: () => void;
  onQuantity: (quantity: number) => void;
  onWallet: (quantity: number, voucherCode?: string | null) => Promise<void> | void;
  onBank: (quantity: number, voucherCode?: string | null) => Promise<void> | void;
  onUsdt: (quantity: number, voucherCode?: string | null) => Promise<void> | void;
  onWalletOpen: () => void;
  onBackToCart: () => void;
}) {
  const copy = TEXT[language];
  const vi = language === "vi";
  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);
  const [method, setMethod] = useState<PayMethod>(language === "en" && item.product.usdtPrice ? "usdt" : "bank");
  const [coupon, setCoupon] = useState(customer ? "FIRST20" : "");
  const [couponMessage, setCouponMessage] = useState("");
  const [voucherPreview, setVoucherPreview] = useState<VoucherPreview | null>(null);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [localProcessing, setLocalProcessing] = useState(false);
  const [paymentAttempted, setPaymentAttempted] = useState(false);
  const [contact, setContact] = useState({
    name: customer?.displayName ?? "",
    email: customer?.email ?? "",
    phone: ""
  });
  const subtotal = item.product.price * item.quantity;
  const discountAmount = voucherPreview?.discountAmount ?? 0;
  const amount = voucherPreview?.totalAmount ?? subtotal;
  const walletMissing = Math.max(0, amount - balance);
  const actionLoading = loading === `wallet:${item.product.id}` || loading === `bank:${item.product.id}` || loading === `usdt:${item.product.id}`;
  const busy = actionLoading || localProcessing;
  const canUseUsdt = Boolean(item.product.usdtPrice);
  const checkoutTotalLabel = method === "usdt" ? formatCheckoutTotal(item.product, item.quantity, "en", amount) : formatVnd(amount);
  const processingText =
    method === "bank"
      ? vi ? "Đang tạo mã VietQR..." : "Creating VietQR code..."
      : method === "usdt"
        ? vi ? "Đang tạo invoice Cryptomus..." : "Creating Cryptomus invoice..."
        : vi ? "Đang xử lý thanh toán ví..." : "Processing wallet payment...";
  const paymentFeedback = paymentAttempted && actionError ? actionError : busy ? processingText : "";
  const paymentFeedbackIsError = paymentAttempted && Boolean(actionError);

  useEffect(() => {
    const code = coupon.trim();
    setVoucherPreview(null);
    if (customer && code) void validateCoupon(code, true);
  }, [customer?.id, item.product.id, item.quantity]);

  useEffect(() => {
    if (voucherPreview?.code && coupon.trim().toUpperCase() !== voucherPreview.code) {
      setVoucherPreview(null);
    }
  }, [coupon, voucherPreview?.code]);

  function runPayment(action: () => Promise<void> | void) {
    setCouponMessage("");
    setPaymentAttempted(true);
    setLocalProcessing(true);
    try {
      void Promise.resolve(action()).finally(() => setLocalProcessing(false));
    } catch (err) {
      setLocalProcessing(false);
      setCouponMessage((err as Error).message);
    }
  }

  function pay() {
    if (!contact.email.trim()) {
      setCouponMessage(vi ? "Vui lòng nhập email nhận hàng trước khi thanh toán." : "Please enter a delivery email before checkout.");
      return;
    }
    if (coupon.trim() && !voucherPreview && coupon.trim().toUpperCase() !== "FIRST20") {
      setCouponMessage(vi ? "Vui lòng áp dụng mã ưu đãi trước khi thanh toán." : "Apply the promo code before checkout.");
      return;
    }
    const voucherCode = voucherPreview?.code ?? undefined;
    if (method === "wallet") runPayment(() => onWallet(item.quantity, voucherCode));
    if (method === "bank") runPayment(() => onBank(item.quantity, voucherCode));
    if (method === "usdt") runPayment(() => onUsdt(item.quantity, voucherCode));
  }

  async function validateCoupon(code = coupon, silent = false) {
    const cleanCode = code.trim();
    if (!cleanCode) {
      setVoucherPreview(null);
      setCouponMessage(vi ? "Nhập mã ưu đãi để áp dụng." : "Enter a promo code to apply.");
      return;
    }
    if (!customer) {
      setVoucherPreview(null);
      setCouponMessage(vi ? "Đăng nhập để dùng mã ưu đãi." : "Sign in to use promo codes.");
      return;
    }
    setVoucherLoading(true);
    try {
      const preview = await api.post<VoucherPreview>("/store/vouchers/preview", {
        productId: item.product.id,
        quantity: item.quantity,
        voucherCode: cleanCode
      });
      setVoucherPreview(preview);
      setCoupon(preview.code ?? cleanCode.toUpperCase());
      setCouponMessage(
        vi
          ? `Đã áp dụng mã ${preview.code}: giảm ${formatVnd(preview.discountAmount)}.`
          : `${preview.code} applied: ${formatVnd(preview.discountAmount)} off.`
      );
    } catch (err) {
      setVoucherPreview(null);
      if (silent) {
        if (cleanCode.toUpperCase() === "FIRST20") setCoupon("");
        setCouponMessage("");
      } else {
        setCouponMessage((err as Error).message);
      }
    } finally {
      setVoucherLoading(false);
    }
  }

  function applyCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void validateCoupon();
  }

  return (
    <div className={`overlay checkout-overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <section className="checkout-modal" role="dialog" aria-modal="true" aria-label={copy.checkout}>
        <button className="close-button" onClick={requestClose} aria-label="Close"><X size={18} /></button>
        <div className="checkout-head">
          <div>
            <h2>{copy.checkout}</h2>
            <p>{vi ? "Hoàn tất đơn hàng để nhận sản phẩm ngay lập tức" : "Complete your order to receive the product after payment"}</p>
          </div>
          <CheckoutStepper language={language} />
        </div>

        <div className="checkout-grid">
          <div className="checkout-main">
            <section className="checkout-card">
              <h3>1. {copy.cart}</h3>
              <article className="checkout-item">
                <img src={productArtUrl(item.product)} alt="" />
                <div>
                  <b>{localizedName(item.product, language)}</b>
                  <span>{postPaymentLabel(item.product.deliveryType, language)} · {vi ? "Bảo hành 100%" : "Warranty"}</span>
                </div>
                <QuantityControl value={item.quantity} max={item.product.deliveryType === "SHARED_CONTENT" ? 999 : Math.max(1, availableQuantity(item.product))} label={copy.quantity} onChange={onQuantity} compact />
                <strong>{formatProductTotal(item.product, item.quantity, language)}</strong>
              </article>
              <form className="coupon-row" onSubmit={applyCoupon}>
                <input
                  value={coupon}
                  onChange={(event) => {
                    setCoupon(event.target.value);
                    setVoucherPreview(null);
                    setCouponMessage("");
                  }}
                  placeholder={vi ? "Nhập mã giảm giá" : "Promo code"}
                />
                <button disabled={voucherLoading}>{voucherLoading ? <Loader2 className="spin" size={15} /> : vi ? "Áp dụng" : "Apply"}</button>
              </form>
              {couponMessage ? <p className="inline-message">{couponMessage}</p> : null}
            </section>

            <section className="checkout-card">
              <h3>2. {vi ? "Thông tin khách hàng" : "Customer information"}</h3>
              <div className="form-grid">
                <label>
                  {vi ? "Họ và tên" : "Full name"}
                  <input value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} />
                </label>
                <label>
                  Email
                  <input type="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} />
                </label>
                <label>
                  {vi ? "Số điện thoại" : "Phone"}
                  <input value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} inputMode="tel" />
                </label>
                <label>
                  {vi ? "Phương thức nhận hàng" : "Delivery method"}
                  <select>
                    <option>{vi ? "Nhận qua email" : "Email delivery"}</option>
                    <option>{vi ? "Nhận trong tài khoản" : "Account dashboard"}</option>
                  </select>
                </label>
              </div>
              {!customer ? <p className="inline-message">{vi ? "Đã có tài khoản? Đăng nhập để thanh toán nhanh hơn." : "Have an account? Sign in for faster checkout."}</p> : null}
            </section>

            <section className="checkout-card">
              <h3>3. {vi ? "Phương thức thanh toán" : "Payment method"}</h3>
              <div className="payment-methods">
                <button type="button" className={method === "bank" ? "active" : ""} onClick={() => setMethod("bank")}><QrCode size={17} /> VietQR</button>
                <button type="button" className={method === "wallet" ? "active" : ""} onClick={() => setMethod("wallet")}><Wallet size={17} /> {vi ? "Ví nội bộ" : "Wallet"}</button>
                <button type="button" className={method === "usdt" ? "active" : ""} onClick={() => setMethod("usdt")} disabled={!canUseUsdt}><CreditCard size={17} /> USDT</button>
              </div>
              <div className={`payment-preview ${method}`}>
                {method === "bank" ? (
                  <>
                    <div>
                      <span>{vi ? "Thanh toán qua VietQR" : "Pay with VietQR"}</span>
                      <b>{formatVnd(amount)}</b>
                      <p>{vi ? "Hệ thống sẽ tạo mã QR riêng sau khi bạn bấm thanh toán." : "A unique QR code will be created after you press checkout."}</p>
                    </div>
                    <QrPlaceholder />
                  </>
                ) : null}
                {method === "wallet" ? (
                  <div>
                    <span>{vi ? "Số dư ví" : "Wallet balance"}</span>
                    <b>{formatVnd(balance)}</b>
                    {walletMissing ? (
                      <p>{vi ? `Bạn còn thiếu ${formatVnd(walletMissing)}.` : `You are short ${formatVnd(walletMissing)}.`} <button onClick={onWalletOpen}>{copy.topupTitle}</button></p>
                    ) : (
                      <p>{vi ? "Số dư đủ để thanh toán ngay." : "Your wallet balance is enough."}</p>
                    )}
                  </div>
                ) : null}
                {method === "usdt" ? (
                  <div>
                    <span>{vi ? "Thanh toán USDT" : "USDT checkout"}</span>
                    <b>{formatCheckoutTotal(item.product, item.quantity, "en", amount)}</b>
                    <p>{vi ? "Invoice Cryptomus sẽ mở sau khi bấm thanh toán." : "A Cryptomus invoice opens after checkout."}</p>
                  </div>
                ) : null}
              </div>
              {paymentFeedback ? <p className={`inline-message payment-feedback${paymentFeedbackIsError ? "" : " is-loading"}`}>{paymentFeedback}</p> : null}
            </section>
          </div>

          <aside className="checkout-side">
            <section className="order-summary-card">
              <h3>{vi ? "Tóm tắt đơn hàng" : "Order summary"}</h3>
              <dl>
                <div><dt>{vi ? "Tạm tính" : "Subtotal"}</dt><dd>{formatVnd(subtotal)}</dd></div>
                <div><dt>{vi ? "Giảm giá" : "Discount"}</dt><dd>{discountAmount > 0 ? `-${formatVnd(discountAmount)}` : formatVnd(0)}</dd></div>
                <div><dt>{vi ? "Phí xử lý" : "Processing fee"}</dt><dd>{vi ? "Miễn phí" : "Free"}</dd></div>
              </dl>
              <div className="grand-total">
                <span>{copy.total}</span>
                <b>{checkoutTotalLabel}</b>
              </div>
              <ul>
                <li><ShieldCheck size={16} /> {vi ? "Sản phẩm chính hãng 100%" : "Verified product"}</li>
                <li><Zap size={16} /> {vi ? "Nhận ngay sau thanh toán" : "Delivery after payment"}</li>
                <li><Headphones size={16} /> {vi ? "Hỗ trợ kỹ thuật 24/7" : "24/7 support"}</li>
              </ul>
            </section>
            <section className="order-flow-card">
              <h3>4. {vi ? "Quy trình nhận hàng" : "Delivery process"}</h3>
              <DeliveryTimeline language={language} compact />
            </section>
            <FaqAccordion language={language} />
          </aside>
        </div>

        <div className="checkout-sticky-bar">
          <button type="button" className="secondary-button" onClick={onBackToCart}>
            <ArrowRight size={16} className="back-arrow" />
            {vi ? "Quay lại giỏ hàng" : "Back to cart"}
          </button>
          <div>
            <span>{copy.total}</span>
            <b>{checkoutTotalLabel}</b>
          </div>
          <button type="button" className="primary-button" onClick={pay} disabled={busy || (method === "wallet" && walletMissing > 0) || (method === "usdt" && !canUseUsdt)}>
            {busy ? <Loader2 className="spin" size={17} /> : <ShieldCheck size={17} />}
            {vi ? `Thanh toán ${checkoutTotalLabel}` : "Pay securely"}
          </button>
        </div>
      </section>
    </div>
  );
}

function CartCheckoutDialog({
  items,
  customer,
  balance,
  loading,
  actionError,
  language,
  onClose,
  onWallet,
  onBank,
  onUsdt,
  onWalletOpen,
  onBackToCart
}: {
  items: CartItem[];
  customer: Session["customer"] | null;
  balance: number;
  loading: string;
  actionError: string;
  language: Language;
  onClose: () => void;
  onWallet: (voucherCode?: string | null) => Promise<void> | void;
  onBank: (voucherCode?: string | null) => Promise<void> | void;
  onUsdt: (voucherCode?: string | null) => Promise<void> | void;
  onWalletOpen: () => void;
  onBackToCart: () => void;
}) {
  const vi = language === "vi";
  const copy = TEXT[language];
  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);
  const [method, setMethod] = useState<PayMethod>("bank");
  const [coupon, setCoupon] = useState(customer ? "FIRST20" : "");
  const [couponMessage, setCouponMessage] = useState("");
  const [voucherPreview, setVoucherPreview] = useState<VoucherPreview | null>(null);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [localProcessing, setLocalProcessing] = useState(false);
  const [paymentAttempted, setPaymentAttempted] = useState(false);
  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const discountAmount = voucherPreview?.discountAmount ?? 0;
  const amount = voucherPreview?.totalAmount ?? subtotal;
  const walletMissing = Math.max(0, amount - balance);
  const canUseUsdt = items.every((item) => Boolean(item.product.usdtPrice));
  const actionLoading = loading === "cart-wallet" || loading === "cart-bank" || loading === "cart-usdt";
  const busy = actionLoading || localProcessing;
  const checkoutTotalLabel = method === "usdt" ? formatCartCheckoutTotal(items, amount) : formatVnd(amount);
  const processingText =
    method === "bank"
      ? vi ? "Đang tạo mã VietQR cho toàn bộ giỏ hàng..." : "Creating VietQR code for the full cart..."
      : method === "usdt"
        ? vi ? "Đang tạo invoice Cryptomus cho toàn bộ giỏ hàng..." : "Creating Cryptomus invoice for the full cart..."
        : vi ? "Đang xử lý thanh toán ví cho toàn bộ giỏ hàng..." : "Processing wallet payment for the full cart...";
  const paymentFeedback = paymentAttempted && actionError ? actionError : busy ? processingText : "";
  const paymentFeedbackIsError = paymentAttempted && Boolean(actionError);

  useEffect(() => {
    const code = coupon.trim();
    setVoucherPreview(null);
    if (customer && code) void validateCoupon(code, true);
  }, [customer?.id, items.map((item) => `${item.product.id}:${item.quantity}`).join("|")]);

  async function validateCoupon(code = coupon, silent = false) {
    const cleanCode = code.trim();
    if (!cleanCode) {
      setCouponMessage(vi ? "Nhập mã ưu đãi để áp dụng." : "Enter a promo code to apply.");
      return;
    }
    if (!customer) {
      setCouponMessage(vi ? "Đăng nhập để dùng mã ưu đãi." : "Sign in to use promo codes.");
      return;
    }
    setVoucherLoading(true);
    try {
      const preview = await api.post<VoucherPreview>("/store/cart/vouchers/preview", {
        items: items.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
        voucherCode: cleanCode
      });
      setVoucherPreview(preview);
      setCoupon(preview.code ?? cleanCode.toUpperCase());
      setCouponMessage(vi ? `Đã áp dụng mã ${preview.code}: giảm ${formatVnd(preview.discountAmount)}.` : `${preview.code} applied.`);
    } catch (err) {
      setVoucherPreview(null);
      if (silent) {
        if (cleanCode.toUpperCase() === "FIRST20") setCoupon("");
        setCouponMessage("");
      } else {
        setCouponMessage((err as Error).message);
      }
    } finally {
      setVoucherLoading(false);
    }
  }

  function applyCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void validateCoupon();
  }

  function runPayment(action: () => Promise<void> | void) {
    setCouponMessage("");
    setPaymentAttempted(true);
    setLocalProcessing(true);
    try {
      void Promise.resolve(action()).finally(() => setLocalProcessing(false));
    } catch (err) {
      setLocalProcessing(false);
      setCouponMessage((err as Error).message);
    }
  }

  function pay() {
    if (coupon.trim() && !voucherPreview && coupon.trim().toUpperCase() !== "FIRST20") {
      setCouponMessage(vi ? "Vui lòng áp dụng mã ưu đãi trước khi thanh toán." : "Apply the promo code before checkout.");
      return;
    }
    const voucherCode = voucherPreview?.code ?? undefined;
    if (method === "wallet") runPayment(() => onWallet(voucherCode));
    if (method === "bank") runPayment(() => onBank(voucherCode));
    if (method === "usdt") runPayment(() => onUsdt(voucherCode));
  }

  return (
    <div className={`overlay checkout-overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <section className="cart-checkout-modal" role="dialog" aria-modal="true" aria-label={copy.checkout}>
        <button className="close-button" onClick={requestClose} aria-label="Close"><X size={18} /></button>
        <div className="checkout-head">
          <div>
            <h2>{vi ? "Thanh toán giỏ hàng" : "Cart checkout"}</h2>
            <p>{vi ? `${items.length} sản phẩm sẽ được gom vào một mã thanh toán.` : `${items.length} items will use one payment code.`}</p>
          </div>
        </div>
        <div className="cart-checkout-grid">
          <section className="checkout-card cart-batch-list">
            {items.map((item) => (
              <article className="cart-batch-item" key={item.product.id}>
                <img src={productArtUrl(item.product)} alt="" />
                <div>
                  <b>{localizedName(item.product, language)}</b>
                  <span>{item.quantity} × {formatProductPrice(item.product, language)}</span>
                </div>
                <strong>{formatVnd(item.product.price * item.quantity)}</strong>
              </article>
            ))}
            <form className="coupon-row" onSubmit={applyCoupon}>
              <input
                value={coupon}
                onChange={(event) => {
                  setCoupon(event.target.value);
                  setVoucherPreview(null);
                  setCouponMessage("");
                }}
                placeholder={vi ? "Nhập mã giảm giá" : "Promo code"}
              />
              <button disabled={voucherLoading}>{voucherLoading ? <Loader2 className="spin" size={15} /> : vi ? "Áp dụng" : "Apply"}</button>
            </form>
            {couponMessage ? <p className="inline-message">{couponMessage}</p> : null}
          </section>
          <aside className="checkout-card cart-batch-summary">
            <h3>{vi ? "Tổng thanh toán" : "Summary"}</h3>
            <dl>
              <div><dt>{vi ? "Tạm tính" : "Subtotal"}</dt><dd>{formatVnd(subtotal)}</dd></div>
              <div><dt>{vi ? "Giảm giá" : "Discount"}</dt><dd>{discountAmount > 0 ? `-${formatVnd(discountAmount)}` : formatVnd(0)}</dd></div>
              <div><dt>{vi ? "Phí xử lý" : "Processing fee"}</dt><dd>{vi ? "Miễn phí" : "Free"}</dd></div>
            </dl>
            <div className="payment-methods">
              <button type="button" className={method === "bank" ? "active" : ""} onClick={() => setMethod("bank")}><QrCode size={17} /> VietQR</button>
              <button type="button" className={method === "wallet" ? "active" : ""} onClick={() => setMethod("wallet")}><Wallet size={17} /> {vi ? "Ví" : "Wallet"}</button>
              <button type="button" className={method === "usdt" ? "active" : ""} onClick={() => setMethod("usdt")} disabled={!canUseUsdt}><CreditCard size={17} /> USDT</button>
            </div>
            {method === "wallet" && walletMissing ? (
              <p className="inline-message">{vi ? `Ví còn thiếu ${formatVnd(walletMissing)}.` : `Wallet short ${formatVnd(walletMissing)}.`} <button onClick={onWalletOpen}>{copy.topupTitle}</button></p>
            ) : null}
            {paymentFeedback ? <p className={`inline-message payment-feedback${paymentFeedbackIsError ? "" : " is-loading"}`}>{paymentFeedback}</p> : null}
            <div className="grand-total">
              <span>{copy.total}</span>
              <b>{checkoutTotalLabel}</b>
            </div>
          </aside>
        </div>
        <div className="checkout-sticky-bar">
          <button type="button" className="secondary-button" onClick={onBackToCart}>
            <ArrowRight size={16} className="back-arrow" />
            {vi ? "Quay lại giỏ hàng" : "Back to cart"}
          </button>
          <div>
            <span>{copy.total}</span>
            <b>{checkoutTotalLabel}</b>
          </div>
          <button type="button" className="primary-button" onClick={pay} disabled={busy || (method === "wallet" && walletMissing > 0) || (method === "usdt" && !canUseUsdt)}>
            {busy ? <Loader2 className="spin" size={17} /> : <ShieldCheck size={17} />}
            {vi ? `Thanh toán tất cả` : "Pay all"}
          </button>
        </div>
      </section>
    </div>
  );
}

function CheckoutStepper({ language }: { language: Language }) {
  const labels = language === "vi" ? ["Giỏ hàng", "Thông tin", "Thanh toán", "Hoàn tất"] : ["Cart", "Info", "Payment", "Done"];
  return (
    <ol className="checkout-stepper">
      {labels.map((label, index) => (
        <li className={index < 2 ? "done" : index === 2 ? "active" : ""} key={label}>
          <span>{index < 2 ? <Check size={14} /> : index + 1}</span>
          <b>{label}</b>
        </li>
      ))}
    </ol>
  );
}

function DeliveryTimeline({ language, compact = false }: { language: Language; compact?: boolean }) {
  const steps = language === "vi"
    ? [
        ["Đặt hàng thành công", "Chọn sản phẩm và thanh toán."],
        ["Thanh toán", "Quét QR hoặc thanh toán bằng ví."],
        ["Nhận thông tin", "Thông tin sản phẩm được gửi qua email."],
        ["Kích hoạt & sử dụng", "Đăng nhập và tận hưởng ngay."]
      ]
    : [
        ["Order placed", "Choose product and checkout."],
        ["Payment", "Scan QR or pay by wallet."],
        ["Receive details", "Delivery details are sent by email."],
        ["Activate", "Sign in and start using."]
      ];

  return (
    <div className={`delivery-timeline ${compact ? "compact" : ""}`}>
      {steps.map(([title, text], index) => (
        <article key={title}>
          <span>{index + 1}</span>
          <div>
            <b>{title}</b>
            <small>{text}</small>
          </div>
        </article>
      ))}
    </div>
  );
}

function QuantityControl({
  value,
  max,
  label,
  onChange,
  compact = false
}: {
  value: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={`quantity-control ${compact ? "compact" : ""}`} aria-label={label}>
      {!compact ? <span>{label}</span> : null}
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))} aria-label="Decrease quantity"><Minus size={15} /></button>
      <input inputMode="numeric" min={1} max={max} value={value} onChange={(event) => onChange(Number(event.target.value.replace(/[^\d]/g, "")) || 1)} />
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label="Increase quantity"><Plus size={15} /></button>
    </div>
  );
}

function CartDialog({
  items,
  language,
  total,
  onClose,
  onQuantity,
  onRemove,
  onCheckout,
  onCheckoutAll,
  onShop
}: {
  items: CartItem[];
  language: Language;
  total: number;
  onClose: () => void;
  onQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onCheckout: (item: CartItem) => void;
  onCheckoutAll: () => void;
  onShop: () => void;
}) {
  const copy = TEXT[language];
  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);

  return (
    <div className={`overlay cart-overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <aside className="cart-drawer">
        <button className="close-button" onClick={requestClose} aria-label="Close"><X size={18} /></button>
        <div className="cart-head">
          <span><ShoppingCart size={18} /> {copy.cart}</span>
          <h2>{language === "vi" ? "Giỏ hàng của bạn" : "Your cart"}</h2>
          <p>{items.length ? (language === "vi" ? `${items.length} sản phẩm sẵn sàng thanh toán cùng một lần.` : `${items.length} items ready for one checkout.`) : copy.cartHint}</p>
        </div>

        {items.length ? (
          <div className="cart-list">
            {items.map((item) => {
              const maxQuantity = item.product.deliveryType === "SHARED_CONTENT" ? 999 : Math.max(1, availableQuantity(item.product));
              return (
                <article className="cart-item" key={item.product.id}>
                  <img src={productArtUrl(item.product)} alt="" loading="lazy" />
                  <div>
                    <h3>{localizedName(item.product, language)}</h3>
                    <p>{formatProductPrice(item.product, language)} · {postPaymentLabel(item.product.deliveryType, language)}</p>
                    <div className="cart-line-actions">
                      <QuantityControl value={item.quantity} max={maxQuantity} label={copy.quantity} compact onChange={(quantity) => onQuantity(item.product.id, quantity)} />
                      <div className="cart-line-buttons">
                        <button className="ghost-line-button" onClick={() => onCheckout(item)}>{copy.checkout}</button>
                        <button className="danger-link" onClick={() => onRemove(item.product.id)} aria-label={copy.remove}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={<ShoppingBag size={30} />} title={copy.cartEmpty} text={language === "vi" ? "Khám phá sản phẩm để thêm vào giỏ." : "Browse products to add items to cart."} actionLabel={TEXT[language].shopCta} onAction={onShop} />
        )}

        <div className="cart-summary">
          <div>
            <span>{language === "vi" ? "Tạm tính" : "Subtotal"}</span>
            <b>{formatVnd(total)}</b>
          </div>
          <button className="primary-button cart-checkout-all" onClick={onCheckoutAll} disabled={!items.length}>
            <ShieldCheck size={17} />
            {language === "vi" ? "Thanh toán tất cả" : "Checkout all"}
          </button>
        </div>
      </aside>
    </div>
  );
}

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
  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);

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

  return (
    <div className={`overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <section className="dialog wallet-dialog" role="dialog" aria-modal="true">
        <button className="close-button" onClick={requestClose} aria-label="Close"><X size={18} /></button>
        <p className="section-kicker"><Wallet size={16} /> {language === "vi" ? "Ví VD" : "VD Wallet"}</p>
        <h2>{formatVnd(balance)}</h2>
        <p>{language === "vi" ? "Nạp ví để mua nhanh mà không cần quét QR từng đơn." : "Top up your wallet to buy quickly without scanning a QR every time."}</p>
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
            <input id="custom-amount" inputMode="numeric" min={1000} value={customAmount} onChange={(event) => setCustomAmount(event.target.value)} placeholder="150000" />
            <button className="primary-button" disabled={loading === "topup"}>
              {loading === "topup" ? <Loader2 className="spin" size={17} /> : <QrCode size={17} />}
              {language === "vi" ? "Tạo QR" : "Create QR"}
            </button>
          </div>
          {amountError ? <p className="field-error">{amountError}</p> : null}
        </form>
      </section>
    </div>
  );
}

function AuthDialog({ language, onClose, onSession }: { language: Language; onClose: () => void; onSession: (session: Session) => void }) {
  const copy = TEXT[language];
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);

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
    <div className={`overlay auth-overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <section className="dialog auth-dialog" role="dialog" aria-modal="true">
        <button className="close-button" onClick={requestClose} aria-label="Close"><X size={18} /></button>
        <div className="auth-visual">
          <img src="/logo.png" alt="" />
          <h2>{mode === "login" ? copy.loginTitle : copy.registerTitle}</h2>
          <p>{language === "vi" ? "Đăng nhập để xem lịch sử, ví và nhận hàng sau thanh toán." : "Sign in to view history, wallet and delivery after payment."}</p>
        </div>
        <form onSubmit={submit}>
          {mode === "register" ? (
            <label>
              {copy.displayName}
              <input name="name" autoComplete="name" />
            </label>
          ) : null}
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            {copy.password}
            <input name="password" type="password" minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
          </label>
          {error ? <div className="alert">{error}</div> : null}
          <button className="primary-button" disabled={loading}>
            {loading ? <Loader2 className="spin" size={17} /> : <KeyRound size={17} />}
            {mode === "login" ? copy.login : copy.register}
          </button>
        </form>
        <button className="link-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? copy.noAccount : copy.hasAccount}
        </button>
      </section>
    </div>
  );
}

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
      <section className="dialog qr-dialog" role="dialog" aria-modal="true">
        <button className="close-button" onClick={requestClose} aria-label="Close"><X size={18} /></button>
        <p className="section-kicker"><QrCode size={16} /> {copy.scanQr}</p>
        <h2>{payment.cryptoCurrency === "USDT" ? formatUsdt(payment.cryptoAmount) : formatVnd(payment.amount)}</h2>
        {payment.qrImageUrl ? <img className="qr-image" src={payment.qrImageUrl} alt={`QR ${payment.code}`} /> : null}
        {payment.checkoutUrl ? (
          <a className="primary-button full" href={payment.checkoutUrl} target="_blank" rel="noreferrer">
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
                <b>{payment.address}</b>
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
        <button className="secondary-button full" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={loading ? "spin" : ""} size={17} /> {copy.refreshStatus}
        </button>
      </section>
    </div>
  );
}

function DeliveryDialog({ delivery, language, onClose }: { delivery: DeliveryNotice; language: Language; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const orderCopyText = delivery.order ? buildOrderCopyText(delivery.order) : "";
  const isManualOrder = delivery.order?.product?.deliveryType === "MANUAL";
  const { handleOverlayClick, isClosing, requestClose } = useDialogClose(onClose);

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

  return (
    <div className={`overlay${isClosing ? " is-closing" : ""}`} onClick={handleOverlayClick}>
      <section className="dialog success-dialog" role="dialog" aria-modal="true">
        <button className="close-button" onClick={requestClose} aria-label="Close"><X size={18} /></button>
        <div className="success-mark"><Check size={28} /></div>
        <h2>{delivery.title}</h2>
        {delivery.balanceAfter !== undefined ? <p>{language === "vi" ? "Số dư hiện tại" : "Current balance"}: <b>{formatVnd(delivery.balanceAfter)}</b></p> : null}
        {isManualOrder ? (
          <div className="manual-contact-hint">
            {language === "vi"
              ? "Sản phẩm này cần admin giao thủ công. Hãy bấm Zalo ở góc phải, gửi kèm thông tin đơn hàng để admin kiểm tra và giao hàng."
              : "This product requires manual delivery. Use the support button and include the order details so admin can process it."}
          </div>
        ) : null}
        {delivery.order ? (
          <div className="order-copy-card">
            <div>
              <span>{language === "vi" ? "Thông tin đơn hàng" : "Order information"}</span>
              <button className="secondary-button" onClick={copyOrder}>{copied ? TEXT[language].copied : TEXT[language].copy}</button>
            </div>
            <pre>{orderCopyText}</pre>
          </div>
        ) : null}
        <pre className="delivery-box">{delivery.deliveryText}</pre>
      </section>
    </div>
  );
}

function ReviewTab({
  products,
  reviews,
  customer,
  loading,
  language,
  onLogin,
  onSubmit
}: {
  products: Product[];
  reviews: ProductReview[];
  customer: Session["customer"] | null;
  loading: string;
  language: Language;
  onLogin: () => void;
  onSubmit: (input: { productId: string; rating: number; title?: string; content: string }) => Promise<void> | void;
}) {
  const copy = TEXT[language];
  const vi = language === "vi";
  const [productId, setProductId] = useState("");
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!productId && products[0]) setProductId(products[0].id);
  }, [productId, products]);

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!customer) {
      onLogin();
      return;
    }
    if (!productId) {
      setMessage(copy.reviewPickProduct);
      return;
    }
    if (content.trim().length < 8) {
      setMessage(vi ? "Nội dung đánh giá tối thiểu 8 ký tự." : "Review content must be at least 8 characters.");
      return;
    }
    await Promise.resolve(onSubmit({ productId, rating, title: title.trim() || undefined, content: content.trim() }));
    setTitle("");
    setContent("");
    setRating(5);
    setMessage(copy.reviewThanks);
  }

  return (
    <div className="review-tab-grid">
      <section className="review-form-card reveal">
        <p className="section-kicker"><Star size={16} /> {copy.reviewTitle}</p>
        <h1>{vi ? "Chia sẻ trải nghiệm mua hàng của bạn" : "Share your purchase experience"}</h1>
        <p>{copy.reviewSub}</p>
        <form onSubmit={submitReview}>
          <label>
            {copy.reviewProduct}
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">{copy.reviewPickProduct}</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{localizedName(product, language)}</option>
              ))}
            </select>
          </label>
          <label>
            {copy.reviewRating}
            <div className="rating-picker" role="radiogroup" aria-label={copy.reviewRating}>
              {[1, 2, 3, 4, 5].map((value) => (
                <button type="button" className={value <= rating ? "active" : ""} aria-pressed={value === rating} key={value} onClick={() => setRating(value)}>
                  <Star size={16} fill="currentColor" />
                </button>
              ))}
            </div>
          </label>
          <label>
            {copy.reviewHeadline}
            <input maxLength={90} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={copy.reviewHeadlinePlaceholder} />
          </label>
          <label>
            {copy.reviewContent}
            <textarea maxLength={800} value={content} onChange={(event) => setContent(event.target.value)} placeholder={copy.reviewPlaceholder} />
          </label>
          {message ? <p className="inline-message">{message}</p> : null}
          <button className="primary-button" disabled={loading === "review"}>
            {loading === "review" ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
            {customer ? copy.reviewSubmit : copy.reviewLogin}
          </button>
        </form>
      </section>
      <section className="review-live-wall reveal" style={{ "--d": "120ms" } as React.CSSProperties}>
        <h2>{vi ? "Đánh giá mới nhất" : "Latest reviews"}</h2>
        {reviews.length ? reviews.slice(0, 8).map((review, index) => <ReviewCard review={review} language={language} index={index} key={review.id} />) : <EmptyState icon={<Star size={28} />} title={vi ? "Chưa có đánh giá" : "No reviews yet"} text={vi ? "Hãy là người đầu tiên chia sẻ trải nghiệm." : "Be the first to share your experience."} />}
      </section>
    </div>
  );
}

function HistoryPanel({ language, history, onRefresh, loading }: { language: Language; history: StoreHistory | null; onRefresh: () => void; loading: boolean }) {
  const copy = TEXT[language];
  return (
    <section className="history-panel reveal">
      <div className="history-head">
        <div>
          <p className="section-kicker"><History size={16} /> {copy.historyTitle}</p>
          <h1>{language === "vi" ? "Theo dõi đơn hàng và ví" : "Track orders and wallet"}</h1>
          <p>{copy.historySub}</p>
        </div>
        <button className="secondary-button" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={loading ? "spin" : ""} size={17} />
          {language === "vi" ? "Làm mới" : "Refresh"}
        </button>
      </div>
      <div className="history-list">
        {history?.orders.length ? (
          history.orders.slice(0, 10).map((order) => (
            <article className="history-row" key={order.code}>
              <div>
                <h3>{order.product.name}</h3>
                <p>{copy.orderCode}: <b>{order.code}</b> · SL: {order.quantity} · {new Date(order.createdAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}</p>
                {order.deliveryText ? <pre>{order.deliveryText}</pre> : null}
              </div>
              <strong>{formatVnd(order.totalAmount)}</strong>
              <span>{order.status}</span>
            </article>
          ))
        ) : (
          <EmptyState icon={<History size={30} />} title={copy.historyLogin} text={language === "vi" ? "Sau khi đăng nhập, các đơn gần nhất sẽ hiển thị tại đây." : "After signing in, recent orders will appear here."} />
        )}
      </div>
    </section>
  );
}

function Footer({ language, onTab, onSection }: { language: Language; onTab: (tab: Tab) => void; onSection: (sectionId: string) => void }) {
  const vi = language === "vi";
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <img src="/logo.png" alt="" />
        <b>VD AI Shop</b>
        <span>AI. Premium. Software.</span>
        <p>{vi ? "Cung cấp tài khoản AI, phần mềm và dịch vụ số uy tín - Nhanh chóng - An toàn - Giá tốt." : "Trusted AI accounts, software and digital services with fast, safe checkout."}</p>
        <div className="social-row">
          <a href="https://www.facebook.com/vanh.dao.735/" target="_blank" rel="noreferrer">f</a>
          <a href="https://zalo.me/0377952999" target="_blank" rel="noreferrer">Z</a>
          <a href="https://t.me/vanhdao99" target="_blank" rel="noreferrer">T</a>
        </div>
      </div>
      <div>
        <h3>{vi ? "Về chúng tôi" : "About"}</h3>
        <button onClick={() => onSection("featured-products")}>{vi ? "Giới thiệu" : "Introduction"}</button>
        <button onClick={() => onTab("products")}>{vi ? "Sản phẩm" : "Products"}</button>
        <button onClick={() => onSection("faq")}>{vi ? "Câu hỏi thường gặp" : "FAQ"}</button>
      </div>
      <div>
        <h3>{vi ? "Hỗ trợ khách hàng" : "Customer support"}</h3>
        <button onClick={() => onSection("faq")}>{vi ? "Hướng dẫn mua hàng" : "Buying guide"}</button>
        <button onClick={() => onSection("faq")}>{vi ? "Chính sách bảo hành" : "Warranty"}</button>
        <button onClick={() => onSection("faq")}>{vi ? "Chính sách hoàn tiền" : "Refund policy"}</button>
      </div>
      <div>
        <h3>{vi ? "Thanh toán" : "Payment"}</h3>
        <div className="payment-grid">
          <span>MoMo</span><span>ZaloPay</span><span>VietQR</span><span>Napas</span><span>Bank</span><span>PayPal</span>
        </div>
      </div>
      <div>
        <h3>{vi ? "Liên hệ" : "Contact"}</h3>
        <a href="mailto:vietanh.dao99@gmail.com"><Mail size={14} /> vietanh.dao99@gmail.com</a>
        <a href="https://zalo.me/0377952999" target="_blank" rel="noreferrer"><Phone size={14} /> 0377952999</a>
        <a href="https://t.me/vanhdao99" target="_blank" rel="noreferrer"><Send size={14} /> @vanhdao99</a>
      </div>
      <small className="copyright">© 2026 VD AI Shop. All rights reserved.</small>
    </footer>
  );
}

function FloatingCtas({ language }: { language: Language }) {
  return (
    <div className="floating-chat" aria-label={language === "vi" ? "Liên hệ nhanh" : "Quick contact"}>
      <a href="https://zalo.me/0377952999" target="_blank" rel="noreferrer"><MessageCircle size={21} /></a>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  text,
  actionLabel,
  onAction
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <b>{title}</b>
      <p>{text}</p>
      {actionLabel && onAction ? <button className="primary-button" onClick={onAction}>{actionLabel}</button> : null}
    </div>
  );
}

function SkeletonGrid({ language }: { language: Language }) {
  return (
    <>
      {[0, 1, 2, 3].map((item) => (
        <div className="skeleton-card" aria-label={language === "vi" ? "Đang tải sản phẩm" : "Loading product"} key={item}>
          <span />
          <b />
          <p />
          <p />
        </div>
      ))}
    </>
  );
}

function QrPlaceholder() {
  return (
    <div className="qr-placeholder" aria-hidden="true">
      {Array.from({ length: 49 }).map((_, index) => <span key={index} />)}
    </div>
  );
}

function postPaymentLabel(type: Product["deliveryType"], language: Language = "vi") {
  if (language === "en") {
    if (type === "STOCK_ITEM") return "Delivered after payment";
    if (type === "SHARED_CONTENT") return "Unlocked after payment";
    return "Manual after payment";
  }
  if (type === "STOCK_ITEM") return "Nhận sau thanh toán";
  if (type === "SHARED_CONTENT") return "Mở sau thanh toán";
  return "Admin xử lý";
}

function groupCatalogProducts(catalog: Catalog | null, query: string, language: Language): ProductGroup[] {
  if (!catalog) return [];
  const normalized = query.toLocaleLowerCase("vi-VN").trim();
  const matches = (product: Product) => {
    if (!normalized) return true;
    return `${localizedName(product, language)} ${localizedDescription(product, language) ?? ""}`.toLocaleLowerCase("vi-VN").includes(normalized);
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
  const labels: Record<PaymentStatusResult["status"], string> =
    language === "en"
      ? {
          PENDING: "Pending payment",
          SUCCEEDED: "Paid",
          EXPIRED: "Expired",
          FAILED: "Failed",
          CREDITED_TO_WALLET: "Credited to wallet",
          MANUAL_REVIEW: "Manual review"
        }
      : {
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
  return tab === "products" || tab === "reviews" || tab === "history" ? tab : "home";
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

function localizedReviewProductName(review: ProductReview, language: Language) {
  return language === "en" ? review.product.nameEn?.trim() || review.product.name : review.product.name;
}

function reviewProductArtUrl(review: ProductReview) {
  if (review.product.imageUrl) return review.product.imageUrl;
  const brand = brandTone(review.product.name || review.product.nameEn || "Digital product");
  return `/product-art/${brand}.svg?v=20260529b`;
}

function renderStars(rating: number) {
  const normalized = Math.max(1, Math.min(5, Math.round(rating)));
  return `${"★".repeat(normalized)}${"☆".repeat(5 - normalized)}`;
}

function formatProductPrice(product: Product, language: Language) {
  return language === "en" && product.usdtPrice ? formatUsdt(product.usdtPrice) : formatVnd(product.price);
}

function formatProductTotal(product: Product, quantity: number, language: Language) {
  return language === "en" && product.usdtPrice ? formatUsdt(Number(product.usdtPrice) * quantity) : formatVnd(product.price * quantity);
}

function formatCheckoutTotal(product: Product, quantity: number, language: Language, payableAmount: number) {
  if (language !== "en" || !product.usdtPrice) return formatVnd(payableAmount);
  const subtotal = product.price * quantity;
  const ratio = subtotal > 0 ? payableAmount / subtotal : 1;
  return formatUsdt(Number(product.usdtPrice) * quantity * ratio);
}

function formatCartCheckoutTotal(items: CartItem[], payableAmount: number) {
  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const rawUsdt = items.reduce((sum, item) => sum + Number(item.product.usdtPrice ?? 0) * item.quantity, 0);
  const ratio = subtotal > 0 ? payableAmount / subtotal : 1;
  return formatUsdt(rawUsdt * ratio);
}

function friendlyCatalogMessage(error: string, language: Language) {
  if (error) {
    return language === "vi"
      ? "Cửa hàng đang cập nhật dữ liệu. Vui lòng thử lại sau ít phút."
      : "The store is refreshing its data. Please try again in a few minutes.";
  }

  return language === "vi"
    ? "Sản phẩm và giá sẽ tự động hiển thị khi cửa hàng được cập nhật."
    : "Products and prices will appear automatically when the store is updated.";
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
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "VD";
}

function sortProducts(products: Product[], sort: string) {
  const copy = [...products];
  if (sort === "low") return copy.sort((a, b) => a.price - b.price);
  if (sort === "high") return copy.sort((a, b) => b.price - a.price);
  if (sort === "new") return copy.reverse();
  return copy.sort((a, b) => availableQuantity(b) - availableQuantity(a));
}

function buildCategoryTiles(catalog: Catalog | null, language: Language) {
  if (!catalog) return [];
  const apiCategories = catalog.categories
    .filter((category) => category.products.length)
    .map((category, index) => {
      const visual = categoryVisuals[index % categoryVisuals.length];
      return {
        id: category.id,
        name: category.name,
        count: category.products.length,
        tone: visual.tone,
        icon: visual.icon
      };
    });

  if (catalog.uncategorized.length) {
    const visual = categoryVisuals[apiCategories.length % categoryVisuals.length];
    apiCategories.push({
      id: "uncategorized",
      name: language === "vi" ? "Chưa phân loại" : "Uncategorized",
      count: catalog.uncategorized.length,
      tone: visual.tone,
      icon: visual.icon
    });
  }

  return apiCategories.slice(0, 6);
}

function buildHeroCards(products: Product[], language: Language) {
  const tones = ["violet", "cyan", "blue", "cyan small", "orange small", "red small"];
  return sortProducts(products, "best").slice(0, 6).map((product, index) => ({
    id: product.id,
    name: localizedName(product, language),
    meta: postPaymentLabel(product.deliveryType, language),
    price: formatProductPrice(product, language),
    image: productArtUrl(product),
    tone: tones[index] ?? "cyan"
  }));
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
