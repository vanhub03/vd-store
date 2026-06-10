import { FormEvent, useEffect, useMemo, useState } from "react";
import { Ban, Bell, Boxes, CheckCircle2, Download, KeyRound, LogOut, PackagePlus, Pencil, RefreshCw, Save, Send, ShoppingCart, TicketPercent, Trash2, UserPlus, Users, Wallet, X } from "lucide-react";
import { AdminSession, Api, formatVnd } from "./api";

type Tab = "overview" | "products" | "users" | "collaborators" | "orders" | "vouchers" | "broadcasts";

type RevenuePoint = { key: string; label: string; revenue: number; orders: number };
type Dashboard = {
  users: number;
  products: number;
  orders: number;
  pendingPayments: number;
  revenue: number;
  todayRevenue: number;
  monthRevenue: number;
  totalWalletBalance: number;
  totalWalletCredit: number;
  totalWalletDebit: number;
  revenueByDay: RevenuePoint[];
  revenueByMonth: RevenuePoint[];
  topWallets: Array<{ balance: number; user?: User }>;
  recentWalletEntries: Array<{ id: string; amount: number; type: string; note?: string; createdAt: string; user?: User }>;
  manualOrderAlerts: Order[];
};
type Category = { id: string; name: string; sortOrder?: number };
type Product = {
  id: string;
  categoryId?: string | null;
  name: string;
  nameEn?: string | null;
  description?: string;
  descriptionEn?: string | null;
  imageUrl?: string | null;
  buttonIcon?: string | null;
  price: number;
  botPrice: number;
  webPrice: number;
  usdtPrice?: number | string | null;
  collaboratorDiscountPercent: number;
  showInBot: boolean;
  showInWeb: boolean;
  manualStock?: number;
  status: string;
  deliveryType: string;
  sharedContent?: string;
  sharedFilePath?: string;
  manualInstructions?: string;
  category?: Category;
  _count?: { inventoryItems: number };
};
type User = {
  id: string;
  telegramId: string;
  email?: string | null;
  displayName?: string | null;
  username?: string;
  firstName?: string;
  role: "CUSTOMER" | "COLLABORATOR";
  isBlocked: boolean;
  balance: number;
  createdAt: string;
  orders?: Order[];
};
type Order = {
  id: string;
  code: string;
  quantity: number;
  subtotalAmount: number;
  discountAmount: number;
  collaboratorDiscountAmount: number;
  voucherDiscountAmount: number;
  customerRoleSnapshot: "CUSTOMER" | "COLLABORATOR";
  totalAmount: number;
  status: string;
  manualStatus?: "PENDING" | "COMPLETED" | "CANCELLED";
  deliveryText?: string | null;
  createdAt: string;
  user: User;
  product: Product;
};
type Payment = {
  id: string;
  code: string;
  amount: number;
  status: string;
  kind: string;
  createdAt: string;
  user?: User;
  order?: { product?: Product };
};
type Broadcast = { id: string; title: string; message: string; status: string; sentCount: number; failedCount: number; createdAt: string };
type Voucher = {
  id: string;
  code: string;
  discountPercent: number;
  maxDiscountAmount?: number | null;
  maxDiscountUsdt?: number | string | null;
  active: boolean;
  firstOrderOnly: boolean;
  allowCollaboratorStacking: boolean;
  maxUses?: number | null;
  usedCount: number;
  startsAt: string;
  expiresAt: string;
  createdAt: string;
  _count?: { redemptions: number; assignments: number };
};
type VoucherAssignment = {
  id: string;
  voucherId: string;
  userId: string;
  revokedAt?: string | null;
  usedAt?: string | null;
  createdAt: string;
  user: User;
  assignedByAdmin?: { id: string; email: string; name?: string | null } | null;
};
type ProductForm = {
  name: string;
  nameEn: string;
  botPrice: number;
  webPrice: number;
  usdtPrice: string;
  collaboratorDiscountPercent: number;
  showInBot: boolean;
  showInWeb: boolean;
  categoryId: string;
  deliveryType: string;
  status: string;
  manualStock: number;
  description: string;
  descriptionEn: string;
  imageUrl: string;
  buttonIcon: string;
  sharedContent: string;
  sharedFilePath: string;
  manualInstructions: string;
};

const defaultProductIcon = "🛍️";
const brandIconOptions = [
  { label: "ChatGPT", value: "🤖", keywords: ["chatgpt", "openai", "gpt"] },
  { label: "Claude", value: "🟫", keywords: ["claude", "anthropic"] },
  { label: "Gemini", value: "✦", keywords: ["gemini"] },
  { label: "Adobe", value: "🅰️", keywords: ["adobe", "photoshop", "premiere", "after effect", "illustrator"] },
  { label: "CapCut", value: "🎬", keywords: ["capcut"] },
  { label: "YouTube", value: "▶️", keywords: ["youtube", "yt"] },
  { label: "Canva", value: "🟣", keywords: ["canva"] },
  { label: "Grok/X", value: "𝕏", keywords: ["grok", "twitter", "x premium"] },
  { label: "Google", value: "🌐", keywords: ["google", "drive", "gmail"] },
  { label: "Microsoft", value: "🪟", keywords: ["microsoft", "office", "copilot", "onedrive"] },
  { label: "Cursor", value: "⌘", keywords: ["cursor"] },
  { label: "Midjourney", value: "🎨", keywords: ["midjourney", "mj"] },
  { label: "Notion", value: "▣", keywords: ["notion"] },
  { label: "Spotify", value: "🎧", keywords: ["spotify"] },
  { label: "Netflix", value: "🎞️", keywords: ["netflix"] },
  { label: "AI chung", value: "🧠", keywords: ["ai"] },
  { label: "API", value: "🔗", keywords: ["api"] },
  { label: "Mặc định", value: defaultProductIcon, keywords: [] }
];

const tokenKey = "vd-store-admin-token";

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey));
  const [session, setSession] = useState<AdminSession["admin"] | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);
  const api = useMemo(() => new Api(token), [token]);

  useEffect(() => {
    api.setToken(token);
    if (!token) return;
    api
      .get<{ admin: AdminSession["admin"] }>("/auth/me")
      .then((data) => setSession(data.admin))
      .catch(() => {
        localStorage.removeItem(tokenKey);
        setToken(null);
      });
  }, [api, token]);

  function onLogin(next: AdminSession) {
    localStorage.setItem(tokenKey, next.token);
    setToken(next.token);
    setSession(next.admin);
  }

  if (!token || !session) {
    return <Login onLogin={onLogin} api={api} />;
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">VD</div>
          <div>
            <strong>VD Store</strong>
            <span>{session.email}</span>
          </div>
        </div>
        <nav>
          <NavButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<ShoppingCart />}>
            Tổng quan
          </NavButton>
          <NavButton active={tab === "products"} onClick={() => setTab("products")} icon={<Boxes />}>
            Sản phẩm
          </NavButton>
          <NavButton active={tab === "users"} onClick={() => setTab("users")} icon={<Users />}>
            User
          </NavButton>
          <NavButton active={tab === "collaborators"} onClick={() => setTab("collaborators")} icon={<UserPlus />}>
            Cộng tác viên
          </NavButton>
          <NavButton active={tab === "orders"} onClick={() => setTab("orders")} icon={<Wallet />}>
            Đơn & tiền
          </NavButton>
          <NavButton active={tab === "vouchers"} onClick={() => setTab("vouchers")} icon={<TicketPercent />}>
            Voucher
          </NavButton>
          <NavButton active={tab === "broadcasts"} onClick={() => setTab("broadcasts")} icon={<Bell />}>
            Thông báo
          </NavButton>
        </nav>
        <button
          className="ghostButton"
          onClick={() => {
            localStorage.removeItem(tokenKey);
            setToken(null);
            setSession(null);
          }}
        >
          <LogOut size={16} /> Đăng xuất
        </button>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <h1>{tabTitle(tab)}</h1>
            <p>Quản lý bot bán hàng, số dư ví và giao dịch VietQR/SePay.</p>
          </div>
          <button className="iconButton" onClick={() => location.reload()} title="Tải lại">
            <RefreshCw size={18} />
          </button>
        </header>
        {error && <div className="alert">{error}</div>}
        {tab === "overview" && <Overview api={api} onError={setError} />}
        {tab === "products" && <Products api={api} onError={setError} />}
        {tab === "users" && <UsersView api={api} onError={setError} />}
        {tab === "collaborators" && <CollaboratorsView api={api} onError={setError} />}
        {tab === "orders" && <OrdersView api={api} onError={setError} />}
        {tab === "vouchers" && <Vouchers api={api} onError={setError} />}
        {tab === "broadcasts" && <Broadcasts api={api} onError={setError} />}
      </main>
    </div>
  );
}

function Login({ api, onLogin }: { api: Api; onLogin: (session: AdminSession) => void }) {
  const [email, setEmail] = useState("admin@vd-store.local");
  const [password, setPassword] = useState("admin123456");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      onLogin(await api.post<AdminSession>("/auth/login", { email, password }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="loginPage">
      <form className="loginBox" onSubmit={submit}>
        <div className="brandMark large">VD</div>
        <h1>VD Store Admin</h1>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
        </label>
        <label>
          Mật khẩu
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
        </label>
        {error && <div className="alert">{error}</div>}
        <button className="primaryButton" disabled={loading}>
          {loading ? <RefreshCw className="spin" size={16} /> : <Save size={16} />} {loading ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </main>
  );
}

function Overview({ api, onError }: { api: Api; onError: (error: string | null) => void }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  async function loadDashboard() {
    setLoading(true);
    try {
      setDashboard(await api.get<Dashboard>("/admin/dashboard"));
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, [api, onError]);

  return (
    <div className="stack">
      {loading && <LoadingBlock label="Đang tải tổng quan..." />}
      <ManualOrderAlerts api={api} orders={dashboard?.manualOrderAlerts ?? []} onResolved={loadDashboard} onError={onError} />
      <section className="metricsGrid">
        <Metric label="Doanh thu hôm nay" value={formatVnd(dashboard?.todayRevenue ?? 0)} />
        <Metric label="Doanh thu tháng này" value={formatVnd(dashboard?.monthRevenue ?? 0)} />
        <Metric label="Tổng doanh thu" value={formatVnd(dashboard?.revenue ?? 0)} />
        <Metric label="Tổng số dư ví user" value={formatVnd(dashboard?.totalWalletBalance ?? 0)} />
        <Metric label="User Telegram" value={dashboard?.users ?? 0} />
        <Metric label="Payment pending" value={dashboard?.pendingPayments ?? 0} />
      </section>

      <section className="dashboardGrid">
        <BarSeries title="Doanh thu 14 ngày gần nhất" points={dashboard?.revenueByDay ?? []} compactLabel />
        <BarSeries title="Doanh thu 12 tháng gần nhất" points={dashboard?.revenueByMonth ?? []} />
      </section>

      <section className="dashboardGrid">
        <WalletPanel
          title="Top ví user"
          rows={(dashboard?.topWallets ?? []).map((wallet) => ({
            name: displayUser(wallet.user),
            detail: wallet.user?.telegramId ?? "",
            amount: wallet.balance
          }))}
        />
        <WalletPanel
          title="Biến động ví gần đây"
          rows={(dashboard?.recentWalletEntries ?? []).map((entry) => ({
            name: displayUser(entry.user),
            detail: `${entry.type}${entry.note ? ` - ${entry.note}` : ""}`,
            amount: entry.amount
          }))}
        />
      </section>

      <section className="metricsGrid">
        <Metric label="Tổng tiền đã cộng ví" value={formatVnd(dashboard?.totalWalletCredit ?? 0)} />
        <Metric label="Tổng tiền đã trừ ví" value={formatVnd(dashboard?.totalWalletDebit ?? 0)} />
        <Metric label="Sản phẩm" value={dashboard?.products ?? 0} />
        <Metric label="Đơn hàng" value={dashboard?.orders ?? 0} />
      </section>
    </div>
  );
}

function Products({ api, onError }: { api: Api; onError: (error: string | null) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categorySortOrder, setCategorySortOrder] = useState(0);
  const [importing, setImporting] = useState(false);
  const [inventoryProductId, setInventoryProductId] = useState("");
  const [inventoryContent, setInventoryContent] = useState("");
  const [form, setForm] = useState<ProductForm>(() => emptyProductForm());

  async function load() {
    setLoading(true);
    try {
      const [nextProducts, nextCategories] = await Promise.all([api.get<Product[]>("/admin/products"), api.get<Category[]>("/admin/categories")]);
      setProducts(nextProducts);
      setCategories(nextCategories);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((err) => onError((err as Error).message));
  }, []);

  async function submitProduct(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const payload = serializeProductForm(form);
      if (editingProductId) {
        await api.put(`/admin/products/${editingProductId}`, payload);
      } else {
        await api.post("/admin/products", payload);
      }
      resetProductForm();
      await load();
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function submitCategory(event: FormEvent) {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) return;
    setCreatingCategory(true);
    try {
      await api.post("/admin/categories", { name, sortOrder: Number(categorySortOrder) || 0 });
      setCategoryName("");
      setCategorySortOrder(0);
      await load();
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setCreatingCategory(false);
    }
  }

  function editProduct(product: Product) {
    setEditingProductId(product.id);
    setForm({
      name: product.name,
      nameEn: product.nameEn ?? "",
      botPrice: product.botPrice || product.price,
      webPrice: product.webPrice || product.price,
      usdtPrice: product.usdtPrice ? String(product.usdtPrice) : "",
      collaboratorDiscountPercent: product.collaboratorDiscountPercent ?? 0,
      showInBot: product.showInBot,
      showInWeb: product.showInWeb,
      categoryId: product.categoryId ?? product.category?.id ?? "",
      deliveryType: product.deliveryType,
      status: product.status,
      manualStock: product.manualStock ?? 0,
      description: product.description ?? "",
      descriptionEn: product.descriptionEn ?? "",
      imageUrl: product.imageUrl ?? "",
      buttonIcon: product.buttonIcon ?? defaultProductIcon,
      sharedContent: product.sharedContent ?? "",
      sharedFilePath: product.sharedFilePath ?? "",
      manualInstructions: product.manualInstructions ?? "Vui lòng ib admin @vanhdao99 để nhận hàng."
    });
    onError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetProductForm() {
    setEditingProductId(null);
    setForm(emptyProductForm());
  }

  async function deleteProduct(product: Product) {
    if (!confirm(`Xóa sản phẩm "${product.name}" khỏi danh sách bán?`)) return;
    setDeletingProductId(product.id);
    try {
      await api.delete(`/admin/products/${product.id}`);
      if (editingProductId === product.id) resetProductForm();
      await load();
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setDeletingProductId(null);
    }
  }

  async function importInventory(event: FormEvent) {
    event.preventDefault();
    if (!inventoryProductId) return;
    setImporting(true);
    try {
      await api.post(`/admin/products/${inventoryProductId}/inventory/import`, { content: inventoryContent });
      setInventoryContent("");
      await load();
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="stack">
      {loading && <LoadingBlock label="Đang tải sản phẩm..." />}
      <section className="panel">
        <div className="panelHeader">
          <h2>Nhóm sản phẩm</h2>
          <span className="mutedText">{categories.length} nhóm</span>
        </div>
        <form className="formGrid compactForm" onSubmit={submitCategory}>
          <label>
            Tên nhóm
            <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="VD: AI Accounts, YouTube, Canva..." />
          </label>
          <label>
            Thứ tự
            <input type="number" value={categorySortOrder} onChange={(event) => setCategorySortOrder(Number(event.target.value))} />
          </label>
          <button className="primaryButton" disabled={creatingCategory || !categoryName.trim()}>
            {creatingCategory ? <RefreshCw className="spin" size={16} /> : <PackagePlus size={16} />} {creatingCategory ? "Đang tạo..." : "Tạo nhóm"}
          </button>
        </form>
        <div className="categoryPills">
          {categories.map((category) => (
            <span key={category.id}>{category.name}</span>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panelHeader">
          <h2>{editingProductId ? "Cập nhật sản phẩm" : "Tạo sản phẩm"}</h2>
          {editingProductId && (
            <button className="smallButton secondaryButton" type="button" onClick={resetProductForm}>
              <X size={14} /> Hủy sửa
            </button>
          )}
        </div>
        <form className="formGrid" onSubmit={submitProduct}>
          <label>
            Tên
            <input
              value={form.name}
              onChange={(event) => {
                const name = event.target.value;
                const buttonIcon = shouldAutoIcon(form.buttonIcon) ? inferBrandIcon(name) : form.buttonIcon;
                setForm({ ...form, name, buttonIcon });
              }}
              required
            />
          </label>
          <label>
            Ten tieng Anh
            <input value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} placeholder="English product name" />
          </label>
          <label>
            Logo URL
            <input
              type="url"
              value={form.imageUrl}
              onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
              placeholder="https://example.com/logo.png"
            />
          </label>
          <div className="fieldBlock wide">
            <label>
              Icon button
              <input value={form.buttonIcon} onChange={(event) => setForm({ ...form, buttonIcon: event.target.value })} placeholder={defaultProductIcon} />
            </label>
            <div className="iconPresetGrid">
              {brandIconOptions.map((option) => (
                <button
                  className={form.buttonIcon === option.value ? "iconPreset active" : "iconPreset"}
                  key={option.label}
                  type="button"
                  onClick={() => setForm({ ...form, buttonIcon: option.value })}
                  title={option.label}
                >
                  <span>{option.value}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <label>
            Giá ở bot VND
            <input type="number" value={form.botPrice} onChange={(event) => setForm({ ...form, botPrice: Number(event.target.value) })} min={1} />
          </label>
          <label>
            Giá ở web VND
            <input type="number" value={form.webPrice} onChange={(event) => setForm({ ...form, webPrice: Number(event.target.value) })} min={1} />
          </label>
          <label>
            Gia USDT
            <input type="number" value={form.usdtPrice} onChange={(event) => setForm({ ...form, usdtPrice: event.target.value })} min={0} step="0.00000001" placeholder="0.00" />
          </label>
          <label>
            Mức giảm cho CTV (%)
            <input
              type="number"
              value={form.collaboratorDiscountPercent}
              onChange={(event) => setForm({ ...form, collaboratorDiscountPercent: Number(event.target.value) })}
              min={0}
              max={90}
            />
            <span className="fieldHint">
              Giá CTV: {formatVnd(Math.max(1, Math.floor(form.webPrice * (1 - form.collaboratorDiscountPercent / 100))))}
              {form.usdtPrice ? ` · ${(Number(form.usdtPrice) * (1 - form.collaboratorDiscountPercent / 100)).toFixed(4)} USDT` : ""}
            </span>
          </label>
          <div className="checkboxGroup wide">
            <label className="checkboxLabel">
              <input type="checkbox" checked={form.showInBot} onChange={(event) => setForm({ ...form, showInBot: event.target.checked })} />
              Hiển thị ở bot
            </label>
            <label className="checkboxLabel">
              <input type="checkbox" checked={form.showInWeb} onChange={(event) => setForm({ ...form, showInWeb: event.target.checked })} />
              Hiển thị ở web
            </label>
          </div>
          <label>
            Danh mục
            <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
              <option value="">Không có</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Loại giao hàng
            <select value={form.deliveryType} onChange={(event) => setForm({ ...form, deliveryType: event.target.value })}>
              <option value="STOCK_ITEM">Mã/account từng dòng</option>
              <option value="SHARED_CONTENT">Nội dung/file dùng chung</option>
              <option value="MANUAL">Liên hệ admin</option>
            </select>
          </label>
          <label>
            Trạng thái
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="ACTIVE">Đang bán</option>
              <option value="INACTIVE">Tạm ẩn</option>
            </select>
          </label>
          {form.deliveryType === "MANUAL" && (
            <label>
              Số lượng manual
              <input
                type="number"
                value={form.manualStock}
                onChange={(event) => setForm({ ...form, manualStock: Number(event.target.value) })}
                min={0}
              />
            </label>
          )}
          <label className="wide">
            Mô tả
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} />
          </label>
          <label className="wide">
            Mo ta tieng Anh
            <textarea value={form.descriptionEn} onChange={(event) => setForm({ ...form, descriptionEn: event.target.value })} rows={3} />
          </label>
          <label className="wide">
            Nội dung giao chung
            <textarea value={form.sharedContent} onChange={(event) => setForm({ ...form, sharedContent: event.target.value })} rows={3} />
          </label>
          <label className="wide">
            Đường dẫn file
            <input value={form.sharedFilePath} onChange={(event) => setForm({ ...form, sharedFilePath: event.target.value })} />
          </label>
          <label className="wide">
            Hướng dẫn manual
            <input value={form.manualInstructions} onChange={(event) => setForm({ ...form, manualInstructions: event.target.value })} />
          </label>
          <button className="primaryButton" disabled={creating}>
            {creating ? <RefreshCw className="spin" size={16} /> : editingProductId ? <Save size={16} /> : <PackagePlus size={16} />}{" "}
            {creating ? "Đang lưu..." : editingProductId ? "Cập nhật sản phẩm" : "Tạo sản phẩm"}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Nhập tồn kho dạng từng dòng</h2>
        <form className="formGrid" onSubmit={importInventory}>
          <label>
            Sản phẩm
            <select value={inventoryProductId} onChange={(event) => setInventoryProductId(event.target.value)}>
              <option value="">Chọn sản phẩm</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Dữ liệu
            <textarea value={inventoryContent} onChange={(event) => setInventoryContent(event.target.value)} rows={5} />
          </label>
          <button className="primaryButton" disabled={importing || !inventoryProductId}>
            {importing ? <RefreshCw className="spin" size={16} /> : <Save size={16} />} {importing ? "Đang nhập..." : "Nhập kho"}
          </button>
        </form>
      </section>

      <DataTable
        columns={["Tên", "Giá bot", "Giá web", "% CTV", "Giá CTV", "USDT", "Hiển thị", "Loại", "Tồn", "Trạng thái", "Thao tác"]}
        rows={products.map((product) => [
          <ProductNameCell product={product} />,
          formatVnd(product.botPrice || product.price),
          formatVnd(product.webPrice || product.price),
          `${product.collaboratorDiscountPercent ?? 0}%`,
          formatVnd(Math.floor((product.webPrice || product.price) * (1 - (product.collaboratorDiscountPercent ?? 0) / 100))),
          product.usdtPrice ? `${product.usdtPrice} USDT` : "-",
          channelVisibilityLabel(product),
          product.deliveryType,
          productQuantityLabel(product),
          product.status,
          <div className="rowActions">
            <button className="smallButton" type="button" onClick={() => editProduct(product)} disabled={creating || deletingProductId === product.id}>
              <Pencil size={14} /> Sửa
            </button>
            <button
              className="smallButton dangerButton"
              type="button"
              onClick={() => deleteProduct(product)}
              disabled={deletingProductId === product.id || product.status === "INACTIVE"}
            >
              {deletingProductId === product.id ? <RefreshCw className="spin" size={14} /> : <Trash2 size={14} />}
              {deletingProductId === product.id ? "Đang xóa..." : product.status === "INACTIVE" ? "Đã xóa" : "Xóa"}
            </button>
          </div>
        ])}
      />
    </div>
  );
}

function ProductNameCell({ product }: { product: Product }) {
  return (
    <div className="productNameCell">
      {product.imageUrl ? (
        <img className="productLogo" src={product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <div className="productLogo productLogoPlaceholder">VD</div>
      )}
      <span className="productButtonIcon">{product.buttonIcon || defaultProductIcon}</span>
      <div>
        <strong>{product.name}</strong>
        {product.category?.name && <span>{product.category.name}</span>}
      </div>
    </div>
  );
}

function emptyProductForm(): ProductForm {
  return {
    name: "",
    nameEn: "",
    botPrice: 10000,
    webPrice: 10000,
    usdtPrice: "",
    collaboratorDiscountPercent: 0,
    showInBot: true,
    showInWeb: true,
    categoryId: "",
    deliveryType: "STOCK_ITEM",
    status: "ACTIVE",
    manualStock: 0,
    description: "",
    descriptionEn: "",
    imageUrl: "",
    buttonIcon: defaultProductIcon,
    sharedContent: "",
    sharedFilePath: "",
    manualInstructions: "Vui lòng ib admin @vanhdao99 để nhận hàng."
  };
}

function serializeProductForm(form: ProductForm) {
  return {
    ...form,
    categoryId: form.categoryId || null,
    botPrice: Number(form.botPrice),
    webPrice: Number(form.webPrice),
    price: Number(form.webPrice),
    nameEn: form.nameEn || null,
    usdtPrice: form.usdtPrice === "" ? null : Number(form.usdtPrice),
    collaboratorDiscountPercent: Number(form.collaboratorDiscountPercent),
    showInBot: Boolean(form.showInBot),
    showInWeb: Boolean(form.showInWeb),
    manualStock: Number(form.manualStock) || 0,
    imageUrl: form.imageUrl || null,
    buttonIcon: form.buttonIcon.trim() || defaultProductIcon,
    sharedContent: form.sharedContent || null,
    sharedFilePath: form.sharedFilePath || null,
    description: form.description || null,
    descriptionEn: form.descriptionEn || null,
    manualInstructions: form.manualInstructions || null
  };
}

function productQuantityLabel(product: Product) {
  if (product.deliveryType === "STOCK_ITEM") return String(product._count?.inventoryItems ?? 0);
  if (product.deliveryType === "MANUAL") return String(product.manualStock ?? 0);
  return "Không giới hạn";
}

function channelVisibilityLabel(product: Product) {
  if (product.showInBot && product.showInWeb) return "Bot + Web";
  if (product.showInBot) return "Bot";
  if (product.showInWeb) return "Web";
  return "Ẩn cả hai";
}

function shouldAutoIcon(currentIcon: string) {
  return !currentIcon.trim() || currentIcon === defaultProductIcon;
}

function inferBrandIcon(name: string) {
  const normalizedName = name.toLocaleLowerCase("vi-VN");
  const matched = brandIconOptions.find((option) => option.keywords.some((keyword) => normalizedName.includes(keyword)));
  return matched?.value ?? defaultProductIcon;
}

function UsersView({ api, onError }: { api: Api; onError: (error: string | null) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [adjustingUserId, setAdjustingUserId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setUsers(await api.get<User[]>("/admin/users"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((err) => onError((err as Error).message));
  }, []);

  async function adjust(userId: string) {
    setAdjustingUserId(userId);
    try {
      await api.post(`/admin/users/${userId}/wallet-adjustments`, { amount: Number(amounts[userId] ?? 0), note: notes[userId] });
      await load();
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setAdjustingUserId(null);
    }
  }

  return (
    <section className="panel">
      <h2>User Telegram</h2>
      {loading && <LoadingBlock label="Đang tải user..." />}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Telegram ID</th>
              <th>Số dư</th>
              <th>Điều chỉnh ví</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.username ? `@${user.username}` : user.firstName || "Không tên"}</td>
                <td>{user.telegramId}</td>
                <td>{formatVnd(user.balance)}</td>
                <td className="inlineControls">
                  <input
                    type="number"
                    value={amounts[user.id] ?? 0}
                    onChange={(event) => setAmounts({ ...amounts, [user.id]: Number(event.target.value) })}
                  />
                  <input value={notes[user.id] ?? ""} onChange={(event) => setNotes({ ...notes, [user.id]: event.target.value })} placeholder="Ghi chú" />
                  <button className="smallButton" onClick={() => adjust(user.id)} disabled={adjustingUserId === user.id}>
                    {adjustingUserId === user.id ? <RefreshCw className="spin" size={14} /> : <Wallet size={14} />}{" "}
                    {adjustingUserId === user.id ? "Đang lưu..." : "Lưu"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type CollaboratorReport = {
  total: number;
  active: number;
  orderCount: number;
  revenue: number;
  discountGranted: number;
  topProducts: Array<{ productId: string; _sum: { quantity?: number | null; totalAmount?: number | null }; product?: { name: string } }>;
  recentOrders: Order[];
};

function CollaboratorsView({ api, onError }: { api: Api; onError: (error: string | null) => void }) {
  const [collaborators, setCollaborators] = useState<User[]>([]);
  const [customers, setCustomers] = useState<User[]>([]);
  const [report, setReport] = useState<CollaboratorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState({ search: "", status: "all", createdFrom: "", createdTo: "" });
  const [form, setForm] = useState({ email: "", displayName: "", password: "" });
  const [promoteUserId, setPromoteUserId] = useState("");

  async function load() {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (filters.search.trim()) query.set("search", filters.search.trim());
      if (filters.status !== "all") query.set("status", filters.status);
      if (filters.createdFrom) query.set("createdFrom", filters.createdFrom);
      if (filters.createdTo) query.set("createdTo", filters.createdTo);
      const [nextCollaborators, nextUsers, nextReport] = await Promise.all([
        api.get<User[]>(`/admin/collaborators${query.size ? `?${query}` : ""}`),
        api.get<User[]>("/admin/users"),
        api.get<CollaboratorReport>("/admin/collaborators/report")
      ]);
      setCollaborators(nextCollaborators);
      setCustomers(nextUsers.filter((user) => user.role === "CUSTOMER" && user.email));
      setReport(nextReport);
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setSavingId("create");
    try {
      await api.post("/admin/collaborators", form);
      setForm({ email: "", displayName: "", password: "" });
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function promote() {
    if (!promoteUserId || !confirm("Chuyển tài khoản khách hàng này thành cộng tác viên?")) return;
    setSavingId(promoteUserId);
    try {
      await api.put(`/admin/collaborators/${promoteUserId}`, { role: "COLLABORATOR" });
      setPromoteUserId("");
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function toggleBlocked(user: User) {
    const action = user.isBlocked ? "mở khóa" : "khóa";
    if (!confirm(`Xác nhận ${action} tài khoản ${user.email ?? displayUser(user)}?`)) return;
    setSavingId(user.id);
    try {
      await api.put(`/admin/collaborators/${user.id}`, { isBlocked: !user.isBlocked });
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function revoke(user: User) {
    if (!confirm(`Thu hồi quyền cộng tác viên của ${user.email ?? displayUser(user)}? Tài khoản sẽ trở về khách hàng thường.`)) return;
    setSavingId(user.id);
    try {
      await api.put(`/admin/collaborators/${user.id}`, { role: "CUSTOMER" });
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function resetPassword(user: User) {
    const password = passwords[user.id]?.trim();
    if (!password || password.length < 6) {
      onError("Mật khẩu mới phải có ít nhất 6 ký tự.");
      return;
    }
    setSavingId(user.id);
    try {
      await api.put(`/admin/collaborators/${user.id}`, { password });
      setPasswords({ ...passwords, [user.id]: "" });
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  function exportCollaborators() {
    downloadCsv(
      "cong-tac-vien.csv",
      ["Tên,Email,Trạng thái,Số dư,Ngày tạo", ...collaborators.map((user) =>
        [user.displayName ?? "", user.email ?? "", user.isBlocked ? "Đã khóa" : "Hoạt động", user.balance, new Date(user.createdAt).toLocaleString("vi-VN")]
          .map(csvCell)
          .join(",")
      )]
    );
  }

  function exportOrders() {
    downloadCsv(
      "don-hang-ctv.csv",
      ["Mã đơn,CTV,Sản phẩm,Số lượng,Giá gốc,Ưu đãi CTV,Voucher,Thực thu,Ngày tạo", ...(report?.recentOrders ?? []).map((order) =>
        [
          order.code,
          order.user?.email ?? displayUser(order.user),
          order.product?.name ?? "",
          order.quantity,
          order.subtotalAmount,
          order.collaboratorDiscountAmount,
          order.voucherDiscountAmount,
          order.totalAmount,
          new Date(order.createdAt).toLocaleString("vi-VN")
        ].map(csvCell).join(",")
      )]
    );
  }

  return (
    <div className="stack">
      {loading && <LoadingBlock label="Đang tải cộng tác viên..." />}
      <section className="metricsGrid">
        <Metric label="Tổng cộng tác viên" value={report?.total ?? 0} />
        <Metric label="Đang hoạt động" value={report?.active ?? 0} />
        <Metric label="Đơn hàng CTV" value={report?.orderCount ?? 0} />
        <Metric label="Doanh thu thực nhận" value={formatVnd(report?.revenue ?? 0)} />
        <Metric label="Ưu đãi đã cấp" value={formatVnd(report?.discountGranted ?? 0)} />
      </section>

      <section className="dashboardGrid">
        <div className="panel">
          <h2>Tạo tài khoản CTV</h2>
          <form className="formGrid collaboratorForm" onSubmit={create}>
            <label>Tên hiển thị<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
            <label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
            <label>Mật khẩu<input type="password" minLength={6} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label>
            <button className="primaryButton" disabled={savingId === "create"}><UserPlus size={16} /> Tạo cộng tác viên</button>
          </form>
        </div>
        <div className="panel">
          <h2>Chuyển khách hàng hiện có</h2>
          <div className="promotionRow">
            <select value={promoteUserId} onChange={(event) => setPromoteUserId(event.target.value)}>
              <option value="">Chọn tài khoản khách hàng</option>
              {customers.map((user) => <option key={user.id} value={user.id}>{user.email} · {user.displayName ?? "Chưa có tên"}</option>)}
            </select>
            <button className="primaryButton" type="button" onClick={promote} disabled={!promoteUserId || savingId === promoteUserId}>Chuyển thành CTV</button>
          </div>
          <div className="topProductList">
            {(report?.topProducts ?? []).slice(0, 5).map((item) => (
              <div key={item.productId}><span>{item.product?.name ?? item.productId}</span><strong>{item._sum.quantity ?? 0} sản phẩm</strong></div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h2>Danh sách cộng tác viên</h2>
          <div className="rowActions">
            <button className="smallButton" type="button" onClick={exportCollaborators}><Download size={14} /> CTV CSV</button>
            <button className="smallButton" type="button" onClick={exportOrders}><Download size={14} /> Đơn hàng CSV</button>
          </div>
        </div>
        <div className="collaboratorFilters">
          <input placeholder="Tìm tên hoặc email" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="all">Mọi trạng thái</option><option value="active">Hoạt động</option><option value="blocked">Đã khóa</option>
          </select>
          <input type="date" value={filters.createdFrom} onChange={(event) => setFilters({ ...filters, createdFrom: event.target.value })} />
          <input type="date" value={filters.createdTo} onChange={(event) => setFilters({ ...filters, createdTo: event.target.value })} />
          <button className="smallButton" type="button" onClick={() => void load()}><RefreshCw size={14} /> Lọc</button>
        </div>
        <div className="tableWrap">
          <table>
            <thead><tr><th>CTV</th><th>Trạng thái</th><th>Số dư</th><th>Đơn gần đây</th><th>Đặt lại mật khẩu</th><th>Thao tác</th></tr></thead>
            <tbody>
              {collaborators.map((user) => (
                <tr key={user.id}>
                  <td><strong>{user.displayName ?? "Chưa có tên"}</strong><span className="tableSubtext">{user.email}</span></td>
                  <td><span className={user.isBlocked ? "statusBadge blocked" : "statusBadge active"}>{user.isBlocked ? "Đã khóa" : "Hoạt động"}</span></td>
                  <td>{formatVnd(user.balance)}</td>
                  <td>{user.orders?.length ?? 0}</td>
                  <td><div className="passwordReset"><input type="password" placeholder="Mật khẩu mới" value={passwords[user.id] ?? ""} onChange={(event) => setPasswords({ ...passwords, [user.id]: event.target.value })} /><button className="smallButton" type="button" onClick={() => void resetPassword(user)}><KeyRound size={14} /></button></div></td>
                  <td><div className="rowActions"><button className={user.isBlocked ? "smallButton successButton" : "smallButton dangerButton"} type="button" onClick={() => void toggleBlocked(user)}>{user.isBlocked ? "Mở khóa" : "Khóa"}</button><button className="smallButton secondaryButton" type="button" onClick={() => void revoke(user)}>Thu hồi quyền</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OrdersView({ api, onError }: { api: Api; onError: (error: string | null) => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.get<Order[]>("/admin/orders"), api.get<Payment[]>("/admin/payments")])
      .then(([nextOrders, nextPayments]) => {
        setOrders(nextOrders);
        setPayments(nextPayments);
      })
      .catch((err) => onError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="stack">
      {loading && <LoadingBlock label="Đang tải đơn hàng và thanh toán..." />}
      <DataTable
        title="Đơn hàng"
        columns={["Mã", "User", "Loại", "Sản phẩm", "SL", "Giá gốc", "Ưu đãi CTV", "Voucher", "Thực thu", "Trạng thái", "Thời gian"]}
        rows={orders.map((order) => [
          order.code,
          order.user?.username ? `@${order.user.username}` : order.user?.telegramId,
          order.customerRoleSnapshot === "COLLABORATOR" ? "CTV" : "Khách",
          order.product?.name,
          order.quantity,
          formatVnd(order.subtotalAmount ?? order.totalAmount),
          formatVnd(order.collaboratorDiscountAmount ?? 0),
          formatVnd(order.voucherDiscountAmount ?? 0),
          formatVnd(order.totalAmount),
          order.status,
          new Date(order.createdAt).toLocaleString("vi-VN")
        ])}
      />
      <DataTable
        title="Thanh toán"
        columns={["Mã", "Loại", "User", "Số tiền", "Trạng thái"]}
        rows={payments.map((payment) => [
          payment.code,
          payment.kind,
          payment.user?.username ? `@${payment.user.username}` : payment.user?.telegramId ?? "",
          formatVnd(payment.amount),
          payment.status
        ])}
      />
    </div>
  );
}

function ManualOrderAlerts({
  api,
  orders,
  onResolved,
  onError
}: {
  api: Api;
  orders: Order[];
  onResolved: () => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  async function resolveOrder(order: Order, status: "COMPLETED" | "CANCELLED") {
    const label = status === "COMPLETED" ? "hoàn thành" : "cancel";
    if (!confirm(`Xác nhận ${label} đơn ${order.code}? Đơn sẽ ẩn khỏi danh sách cần theo dõi.`)) return;
    setResolvingId(order.id);
    try {
      await api.post(`/admin/orders/${order.id}/manual-status`, { status });
      await onResolved();
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <section className="manualAlerts panel">
      <div className="panelHeader">
        <h2>Đơn liên hệ admin mới</h2>
        <span>{orders.length} đơn cần theo dõi</span>
      </div>
      {orders.length === 0 ? (
        <p className="emptyText">Chưa có đơn liên hệ admin đã thanh toán.</p>
      ) : (
        <div className="manualAlertGrid">
          {orders.map((order) => (
            <article className="manualAlertCard" key={order.id}>
              <div>
                <strong>{order.code}</strong>
                <span>{new Date(order.createdAt).toLocaleString("vi-VN")}</span>
              </div>
              <b>{order.product?.name}</b>
              <p>
                {displayUser(order.user)} mua {order.quantity} sản phẩm, tổng {formatVnd(order.totalAmount)}.
              </p>
              <code>
                Mã đơn: {order.code}
                {"\n"}Sản phẩm: {order.product?.name}
                {"\n"}Số lượng: {order.quantity}
                {"\n"}Khách: {displayUser(order.user)}
              </code>
              <div className="manualAlertActions">
                <button className="smallButton successButton" type="button" onClick={() => resolveOrder(order, "COMPLETED")} disabled={resolvingId === order.id}>
                  {resolvingId === order.id ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />}
                  Hoàn thành
                </button>
                <button className="smallButton dangerButton" type="button" onClick={() => resolveOrder(order, "CANCELLED")} disabled={resolvingId === order.id}>
                  {resolvingId === order.id ? <RefreshCw className="spin" size={14} /> : <Ban size={14} />}
                  Cancel
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Vouchers({ api, onError }: { api: Api; onError: (error: string | null) => void }) {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<VoucherAssignment[]>([]);
  const [selectedVoucherId, setSelectedVoucherId] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingVoucherId, setEditingVoucherId] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    code: generateVoucherCode(20),
    discountPercent: 20,
    maxDiscountAmount: "50000",
    maxDiscountUsdt: "2",
    maxUses: "",
    expiresAt: defaultVoucherDate(),
    active: true,
    firstOrderOnly: false,
    allowCollaboratorStacking: false
  }));

  async function load() {
    setLoading(true);
    try {
      const [nextVouchers, nextUsers] = await Promise.all([
        api.get<Voucher[]>("/admin/vouchers"),
        api.get<User[]>("/admin/users")
      ]);
      setVouchers(nextVouchers);
      setUsers(nextUsers);
      if (!selectedVoucherId && nextVouchers[0]) setSelectedVoucherId(nextVouchers[0].id);
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (selectedVoucherId) void loadAssignments(selectedVoucherId);
  }, [selectedVoucherId]);

  async function loadAssignments(voucherId = selectedVoucherId) {
    if (!voucherId) return;
    setAssignmentLoading(true);
    try {
      setAssignments(await api.get<VoucherAssignment[]>(`/admin/vouchers/${voucherId}/assignments`));
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setAssignmentLoading(false);
    }
  }

  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!selectedVoucherId || !selectedUserIds.length) return;
    setAssigning(true);
    try {
      setAssignments(await api.post<VoucherAssignment[]>(`/admin/vouchers/${selectedVoucherId}/assignments`, { userIds: selectedUserIds }));
      setSelectedUserIds([]);
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setAssigning(false);
    }
  }

  async function revoke(assignment: VoucherAssignment) {
    if (!confirm(`Thu hồi voucher của ${assignment.user.email ?? displayUser(assignment.user)}?`)) return;
    setRevokingId(assignment.id);
    try {
      await api.delete(`/admin/vouchers/${assignment.voucherId}/assignments/${assignment.id}`);
      await loadAssignments(assignment.voucherId);
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setRevokingId(null);
    }
  }

  function resetVoucherForm(discountPercent = form.discountPercent) {
    setEditingVoucherId(null);
    setForm({
      code: generateVoucherCode(discountPercent),
      discountPercent,
      maxDiscountAmount: "50000",
      maxDiscountUsdt: "2",
      maxUses: "",
      expiresAt: defaultVoucherDate(),
      active: true,
      firstOrderOnly: false,
      allowCollaboratorStacking: false
    });
  }

  function editVoucher(voucher: Voucher) {
    setEditingVoucherId(voucher.id);
    setForm({
      code: voucher.code,
      discountPercent: voucher.discountPercent,
      maxDiscountAmount: voucher.maxDiscountAmount ? String(voucher.maxDiscountAmount) : "",
      maxDiscountUsdt: voucher.maxDiscountUsdt ? String(voucher.maxDiscountUsdt) : "",
      maxUses: voucher.maxUses ? String(voucher.maxUses) : "",
      expiresAt: voucher.expiresAt ? voucher.expiresAt.slice(0, 10) : "",
      active: voucher.active,
      firstOrderOnly: voucher.firstOrderOnly,
      allowCollaboratorStacking: voucher.allowCollaboratorStacking
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveVoucher(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const payload = {
        code: form.code,
        discountPercent: Number(form.discountPercent),
        maxDiscountAmount: form.maxDiscountAmount ? Number(form.maxDiscountAmount) : null,
        maxDiscountUsdt: form.maxDiscountUsdt ? Number(form.maxDiscountUsdt) : null,
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        expiresAt: form.expiresAt || null,
        active: form.active,
        firstOrderOnly: form.firstOrderOnly,
        allowCollaboratorStacking: form.allowCollaboratorStacking
      };
      if (editingVoucherId) {
        await api.put(`/admin/vouchers/${editingVoucherId}`, payload);
      } else {
        await api.post("/admin/vouchers", payload);
      }
      resetVoucherForm(form.discountPercent);
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function toggle(voucher: Voucher) {
    setUpdatingId(voucher.id);
    try {
      await api.put(`/admin/vouchers/${voucher.id}`, { active: !voucher.active });
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setUpdatingId(null);
    }
  }

  const selectedVoucher = vouchers.find((voucher) => voucher.id === selectedVoucherId);
  const assignedUserIds = new Set(assignments.filter((assignment) => !assignment.revokedAt).map((assignment) => assignment.userId));
  const normalizedAssignmentSearch = assignmentSearch.trim().toLowerCase();
  const assignableUsers = users
    .filter((user) => !assignedUserIds.has(user.id))
    .filter((user) => {
      if (!normalizedAssignmentSearch) return true;
      return `${user.email ?? ""} ${user.displayName ?? ""} ${user.username ?? ""} ${user.firstName ?? ""}`.toLowerCase().includes(normalizedAssignmentSearch);
    })
    .slice(0, 30);

  return (
    <div className="stack">
      {loading && <LoadingBlock label="Đang tải voucher..." />}
      <section className="panel">
        <div className="panelHeader">
          <h2>{editingVoucherId ? "Sửa voucher" : "Tạo voucher"}</h2>
          <span className="mutedText">{editingVoucherId ? "Cập nhật thông tin mã giảm giá đang chọn." : "Mặc định hết hạn sau 1 tháng"}</span>
        </div>
        <form className="formGrid compactForm voucherForm" onSubmit={saveVoucher}>
          <label>
            Mã
            <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} required />
          </label>
          <label>
            Giảm %
            <input
              type="number"
              value={form.discountPercent}
              min={1}
              max={90}
              onChange={(event) => setForm({ ...form, discountPercent: Number(event.target.value) })}
            />
          </label>
          <label>
            Số lượt
            <input value={form.maxUses} onChange={(event) => setForm({ ...form, maxUses: event.target.value })} inputMode="numeric" placeholder="Không giới hạn" />
          </label>
          <label>
            Giảm tối đa VND
            <input value={form.maxDiscountAmount} onChange={(event) => setForm({ ...form, maxDiscountAmount: event.target.value })} inputMode="numeric" placeholder="Không giới hạn" />
          </label>
          <label>
            Giảm tối đa USDT
            <input value={form.maxDiscountUsdt} onChange={(event) => setForm({ ...form, maxDiscountUsdt: event.target.value })} inputMode="decimal" placeholder="Không giới hạn" />
          </label>
          <label>
            Hết hạn
            <input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} />
          </label>
          <div className="checkboxGroup wide">
            <label className="checkboxLabel">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
              Đang bật
            </label>
            <label className="checkboxLabel">
              <input type="checkbox" checked={form.firstOrderOnly} onChange={(event) => setForm({ ...form, firstOrderOnly: event.target.checked })} />
              Chỉ đơn đầu
            </label>
            <label className="checkboxLabel">
              <input
                type="checkbox"
                checked={form.allowCollaboratorStacking}
                onChange={(event) => setForm({ ...form, allowCollaboratorStacking: event.target.checked })}
              />
              Cộng dồn giá CTV
            </label>
          </div>
          <div className="rowActions wide">
            {editingVoucherId ? (
              <button className="smallButton secondaryButton" type="button" onClick={() => resetVoucherForm()}>
                <X size={14} /> Hủy sửa
              </button>
            ) : null}
            <button className="smallButton secondaryButton" type="button" onClick={() => setForm({ ...form, code: generateVoucherCode(form.discountPercent) })}>
              <TicketPercent size={14} /> Generate
            </button>
            <button className="primaryButton" disabled={creating}>
              {creating ? <RefreshCw className="spin" size={16} /> : <Save size={16} />} {creating ? "Đang lưu..." : editingVoucherId ? "Lưu thay đổi" : "Tạo voucher"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h2>Cấp voucher cho account</h2>
          <span className="mutedText">Voucher đã cấp riêng chỉ account được chọn mới dùng được.</span>
        </div>
        <form className="formGrid compactForm voucherAssignForm" onSubmit={assign}>
          <label>
            Voucher
            <select value={selectedVoucherId} onChange={(event) => setSelectedVoucherId(event.target.value)}>
              {vouchers.map((voucher) => (
                <option key={voucher.id} value={voucher.id}>
                  {voucher.code} - {voucher.discountPercent}%
                </option>
              ))}
            </select>
          </label>
          <label>
            Tìm account
            <input value={assignmentSearch} onChange={(event) => setAssignmentSearch(event.target.value)} placeholder="Email, tên hiển thị, username" />
          </label>
          <div className="checkboxGroup wide userPickList">
            {assignableUsers.map((user) => (
              <label className="checkboxLabel" key={user.id}>
                <input
                  type="checkbox"
                  checked={selectedUserIds.includes(user.id)}
                  onChange={(event) =>
                    setSelectedUserIds((current) =>
                      event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id)
                    )
                  }
                />
                {user.email ?? displayUser(user)} <span className="mutedText">({user.role === "COLLABORATOR" ? "CTV" : "Khách"})</span>
              </label>
            ))}
            {!assignableUsers.length ? <span className="mutedText">Không còn account phù hợp để cấp.</span> : null}
          </div>
          <div className="rowActions wide">
            <button className="smallButton secondaryButton" type="button" onClick={() => void loadAssignments()}>
              <RefreshCw size={14} /> Tải lại danh sách cấp
            </button>
            <button className="primaryButton" disabled={assigning || !selectedVoucherId || !selectedUserIds.length}>
              {assigning ? <RefreshCw className="spin" size={16} /> : <UserPlus size={16} />}
              {assigning ? "Đang cấp..." : `Cấp cho ${selectedUserIds.length || 0} account`}
            </button>
          </div>
        </form>

        <DataTable
          title={selectedVoucher ? `Account đã cấp: ${selectedVoucher.code}` : "Account đã cấp"}
          columns={["Account", "Role", "Trạng thái", "Ngày cấp", "Người cấp", ""]}
          rows={assignments.map((assignment) => {
            const status = assignment.revokedAt ? "Đã thu hồi" : assignment.usedAt ? "Đã dùng" : "Chưa dùng";
            return [
              assignment.user.email ?? displayUser(assignment.user),
              assignment.user.role === "COLLABORATOR" ? "CTV" : "Khách",
              status,
              new Date(assignment.createdAt).toLocaleDateString("vi-VN"),
              assignment.assignedByAdmin?.email ?? "-",
              assignment.usedAt || assignment.revokedAt ? (
                <span className="mutedText">-</span>
              ) : (
                <button className="smallButton dangerButton" onClick={() => revoke(assignment)} disabled={revokingId === assignment.id}>
                  {revokingId === assignment.id ? <RefreshCw className="spin" size={14} /> : <X size={14} />}
                  Thu hồi
                </button>
              )
            ];
          })}
        />
        {assignmentLoading ? <LoadingBlock label="Đang tải account đã cấp..." /> : null}
      </section>

      <DataTable
        title="Danh sách voucher"
        columns={["Mã", "Giảm", "Trần VND / USDT", "Đã dùng", "Đã cấp", "Giới hạn", "Hết hạn", "CTV", "Loại", "Trạng thái", "Sửa", ""]}
        rows={vouchers.map((voucher) => [
          <strong>{voucher.code}</strong>,
          `${voucher.discountPercent}%`,
          `${voucher.maxDiscountAmount ? formatVnd(voucher.maxDiscountAmount) : "∞"} / ${voucher.maxDiscountUsdt ? `${voucher.maxDiscountUsdt} USDT` : "∞"}`,
          voucher.usedCount ?? voucher._count?.redemptions ?? 0,
          voucher._count?.assignments ?? 0,
          voucher.maxUses ?? "Không giới hạn",
          new Date(voucher.expiresAt).toLocaleDateString("vi-VN"),
          voucher.allowCollaboratorStacking ? "Được cộng dồn" : "Không cộng dồn",
          voucher.firstOrderOnly ? "Đơn đầu" : "Thường",
          voucher.active ? "Đang bật" : "Đã tắt",
          <button className="smallButton secondaryButton" onClick={() => editVoucher(voucher)}>
            <Pencil size={14} /> Sửa
          </button>,
          <button className={voucher.active ? "smallButton dangerButton" : "smallButton successButton"} onClick={() => toggle(voucher)} disabled={updatingId === voucher.id}>
            {updatingId === voucher.id ? <RefreshCw className="spin" size={14} /> : voucher.active ? <X size={14} /> : <CheckCircle2 size={14} />}
            {voucher.active ? "Tắt" : "Bật"}
          </button>
        ])}
      />
    </div>
  );
}

function Broadcasts({ api, onError }: { api: Api; onError: (error: string | null) => void }) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setBroadcasts(await api.get<Broadcast[]>("/admin/broadcasts"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((err) => onError((err as Error).message));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      await api.post("/admin/broadcasts", { title, message });
      setTitle("");
      setMessage("");
      await load();
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function send(id: string) {
    setSendingId(id);
    try {
      await api.post(`/admin/broadcasts/${id}/send`);
      await load();
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div className="stack">
      {loading && <LoadingBlock label="Đang tải thông báo..." />}
      <section className="panel">
        <h2>Tạo thông báo</h2>
        <form className="formGrid" onSubmit={create}>
          <label>
            Tiêu đề
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label className="wide">
            Nội dung gửi bot
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={5} required />
          </label>
          <button className="primaryButton" disabled={creating}>
            {creating ? <RefreshCw className="spin" size={16} /> : <Save size={16} />} {creating ? "Đang lưu..." : "Lưu nháp"}
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>Danh sách thông báo</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Tiêu đề</th>
                <th>Trạng thái</th>
                <th>Đã gửi</th>
                <th>Lỗi</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{item.status}</td>
                  <td>{item.sentCount}</td>
                  <td>{item.failedCount}</td>
                  <td>
                    <button className="smallButton" onClick={() => send(item.id)} disabled={sendingId === item.id}>
                      {sendingId === item.id ? <RefreshCw className="spin" size={14} /> : <Send size={14} />} {sendingId === item.id ? "Đang gửi..." : "Gửi"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="loadingBlock">
      <RefreshCw className="spin" size={16} />
      {label}
    </div>
  );
}

function BarSeries({ title, points, compactLabel = false }: { title: string; points: RevenuePoint[]; compactLabel?: boolean }) {
  const max = Math.max(...points.map((point) => point.revenue), 1);
  return (
    <section className="panel chartPanel">
      <div className="panelHeader">
        <h2>{title}</h2>
      </div>
      <div className="barChart">
        {points.map((point) => (
          <div className="barItem" key={point.key} title={`${point.label}: ${formatVnd(point.revenue)} (${point.orders} đơn)`}>
            <div className="barValue">{point.revenue > 0 ? formatCompactVnd(point.revenue) : ""}</div>
            <div className="barTrack">
              <div className="barFill" style={{ height: `${Math.max(4, (point.revenue / max) * 100)}%` }} />
            </div>
            <span>{compactLabel ? point.label.slice(0, 5) : point.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function WalletPanel({ title, rows }: { title: string; rows: Array<{ name: string; detail: string; amount: number }> }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="walletList">
        {rows.length === 0 && <p className="emptyText">Chưa có dữ liệu.</p>}
        {rows.map((row, index) => (
          <div className="walletRow" key={`${row.name}-${index}`}>
            <div>
              <strong>{row.name}</strong>
              <span>{row.detail}</span>
            </div>
            <b className={row.amount < 0 ? "negativeAmount" : "positiveAmount"}>{formatVnd(row.amount)}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function displayUser(user?: User) {
  if (!user) return "User không xác định";
  if (user.username) return `@${user.username}`;
  return user.firstName || user.telegramId;
}

function formatCompactVnd(amount: number) {
  if (amount >= 1_000_000_000) return `${Math.round(amount / 100_000_000) / 10} tỷ`;
  if (amount >= 1_000_000) return `${Math.round(amount / 100_000) / 10}tr`;
  if (amount >= 1_000) return `${Math.round(amount / 1000)}k`;
  return String(amount);
}

function defaultVoucherDate() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function generateVoucherCode(percent: number) {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `VD${Math.max(1, Math.min(90, Math.round(percent || 20)))}-${suffix}`;
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button className={active ? "navButton active" : "navButton"} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

function DataTable({ title, columns, rows }: { title?: string; columns: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <section className="panel">
      {title && <h2>{title}</h2>}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function tabTitle(tab: Tab) {
  const titles: Record<string, string> = {
    overview: "Tổng quan",
    products: "Sản phẩm",
    users: "User Telegram",
    collaborators: "Cộng tác viên",
    orders: "Đơn hàng & thanh toán",
    broadcasts: "Thông báo bot"
  };
  return titles[tab] ?? "Voucher";
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: string[]) {
  const blob = new Blob([`\uFEFF${rows.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
