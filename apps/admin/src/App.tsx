import { FormEvent, useEffect, useMemo, useState } from "react";
import { Bell, Boxes, LogOut, PackagePlus, RefreshCw, Save, Send, ShoppingCart, Users, Wallet } from "lucide-react";
import { AdminSession, Api, formatVnd } from "./api";

type Tab = "overview" | "products" | "users" | "orders" | "broadcasts";

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
};
type Category = { id: string; name: string };
type Product = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string | null;
  price: number;
  status: string;
  deliveryType: string;
  sharedContent?: string;
  sharedFilePath?: string;
  manualInstructions?: string;
  category?: Category;
  _count?: { inventoryItems: number };
};
type User = { id: string; telegramId: string; username?: string; firstName?: string; balance: number; createdAt: string };
type Order = {
  id: string;
  code: string;
  totalAmount: number;
  status: string;
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
          <NavButton active={tab === "orders"} onClick={() => setTab("orders")} icon={<Wallet />}>
            Đơn & tiền
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
        {tab === "orders" && <OrdersView api={api} onError={setError} />}
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
  useEffect(() => {
    setLoading(true);
    api
      .get<Dashboard>("/admin/dashboard")
      .then(setDashboard)
      .catch((err) => onError((err as Error).message))
      .finally(() => setLoading(false));
  }, [api, onError]);

  return (
    <div className="stack">
      {loading && <LoadingBlock label="Đang tải tổng quan..." />}
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
  const [importing, setImporting] = useState(false);
  const [inventoryProductId, setInventoryProductId] = useState("");
  const [inventoryContent, setInventoryContent] = useState("");
  const [form, setForm] = useState({
    name: "",
    price: 10000,
    categoryId: "",
    deliveryType: "STOCK_ITEM",
    description: "",
    imageUrl: "",
    sharedContent: "",
    sharedFilePath: "",
    manualInstructions: "Vui lòng ib admin @vanhdao99 để nhận hàng."
  });

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
      await api.post("/admin/products", {
        ...form,
        categoryId: form.categoryId || null,
        price: Number(form.price),
        imageUrl: form.imageUrl || null,
        sharedContent: form.sharedContent || null,
        sharedFilePath: form.sharedFilePath || null
      });
      setForm({ ...form, name: "", description: "", imageUrl: "", sharedContent: "", sharedFilePath: "" });
      await load();
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setCreating(false);
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
        <h2>Tạo sản phẩm</h2>
        <form className="formGrid" onSubmit={submitProduct}>
          <label>
            Tên
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
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
          <label>
            Giá VND
            <input type="number" value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) })} min={1} />
          </label>
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
          <label className="wide">
            Mô tả
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} />
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
            {creating ? <RefreshCw className="spin" size={16} /> : <PackagePlus size={16} />} {creating ? "Đang tạo..." : "Tạo sản phẩm"}
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
        columns={["Tên", "Giá", "Loại", "Tồn", "Trạng thái"]}
        rows={products.map((product) => [
          <ProductNameCell product={product} />,
          formatVnd(product.price),
          product.deliveryType,
          String(product._count?.inventoryItems ?? 0),
          product.status
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
      <div>
        <strong>{product.name}</strong>
        {product.category?.name && <span>{product.category.name}</span>}
      </div>
    </div>
  );
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
        columns={["Mã", "User", "Sản phẩm", "Số tiền", "Trạng thái"]}
        rows={orders.map((order) => [
          order.code,
          order.user?.username ? `@${order.user.username}` : order.user?.telegramId,
          order.product?.name,
          formatVnd(order.totalAmount),
          order.status
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
  const titles: Record<Tab, string> = {
    overview: "Tổng quan",
    products: "Sản phẩm",
    users: "User Telegram",
    orders: "Đơn hàng & thanh toán",
    broadcasts: "Thông báo bot"
  };
  return titles[tab];
}
