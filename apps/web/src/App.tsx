import {
  AlertOutlined,
  BarChartOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  KeyOutlined,
  ShoppingCartOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProductOutlined,
  SettingOutlined,
  SwapOutlined,
  TeamOutlined,
  UploadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Button,
  ConfigProvider,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Select,
  Space,
  Spin,
  Typography,
  message,
  theme,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { changePassword, errorMessage } from "./api/client";
import { useAuth } from "./auth/AuthContext";
import { AnomaliesPage } from "./pages/AnomaliesPage";
import { BackupsPage } from "./pages/BackupsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { GlobalOperationsPage } from "./pages/GlobalOperationsPage";
import { ImportsPage } from "./pages/ImportsPage";
import { LoginPage } from "./pages/LoginPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { ProductManagementPage } from "./pages/ProductManagementPage";
import { ProductsPage } from "./pages/ProductsPage";
import { SpuComparisonPage } from "./pages/SpuComparisonPage";
import { SystemBackupsPage } from "./pages/SystemBackupsPage";
import { TemuShopsPage } from "./pages/TemuShopsPage";
import { UsersPage } from "./pages/UsersPage";
import { ZhihouAccountPage } from "./pages/ZhihouAccountPage";
import { ZhihouOrdersPage } from "./pages/ZhihouOrdersPage";

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, loading, logout, switchShop } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordForm] = Form.useForm<{
    currentPassword: string;
    newPassword: string;
  }>();
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (session?.user.mustChangePassword) setPasswordOpen(true);
  }, [session?.user.mustChangePassword]);

  if (loading)
    return (
      <div className="auth-page">
        <Spin size="large" />
      </div>
    );
  if (!session)
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );

  const menu = [
    { key: "/", icon: <BarChartOutlined />, label: "经营总览" },
    {
      key: "/product-management",
      icon: <ProductOutlined />,
      label: "产品管理",
    },
    { key: "/products", icon: <ProductOutlined />, label: "SPU 数据" },
    { key: "/orders", icon: <ShoppingCartOutlined />, label: "订单管理" },
    { key: "/spu-comparison", icon: <SwapOutlined />, label: "SPU 对比" },
    {
      key: "/global-operations",
      icon: <HistoryOutlined />,
      label: "全局操作记录",
    },
    { key: "/imports", icon: <UploadOutlined />, label: "每日导入" },
    { key: "/anomalies", icon: <AlertOutlined />, label: "异常提示" },
    { key: "/backups", icon: <DatabaseOutlined />, label: "备份管理" },
    ...(session.user.role === "admin"
      ? [
          {
            key: "/admin/temu-shops",
            icon: <SettingOutlined />,
            label: "管理员后台",
          },
          {
            key: "/admin/zhihou-erp",
            icon: <KeyOutlined />,
            label: "智猴账号管理",
          },
          { key: "/users", icon: <TeamOutlined />, label: "用户管理" },
          {
            key: "/system-backups",
            icon: <DatabaseOutlined />,
            label: "系统备份",
          },
        ]
      : []),
  ];
  const selected = location.pathname.startsWith("/products")
    ? "/products"
    : location.pathname;

  const savePassword = async () => {
    try {
      const values = await passwordForm.validateFields();
      await changePassword(values);
      messageApi.success("密码已修改，请重新登录");
      await logout();
    } catch (error) {
      if (error instanceof Error) messageApi.error(errorMessage(error));
    }
  };

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#ff6a2a",
          borderRadius: 10,
          colorBgLayout: "#f4f6f9",
        },
        components: {
          Layout: { siderBg: "#101828", headerBg: "#ffffff" },
          Menu: { darkItemBg: "#101828", darkItemSelectedBg: "#ff6a2a" },
        },
      }}
    >
      {contextHolder}
      <Layout className="app-layout">
        <Sider
          collapsible
          trigger={null}
          collapsed={collapsed}
          width={224}
          className="app-sider"
        >
          <div className="brand">
            <CloudServerOutlined />
            <span>{!collapsed && "Temu 数据分析"}</span>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selected]}
            items={menu}
            onClick={({ key }) => navigate(key)}
          />
        </Sider>
        <Layout>
          <Header className="app-header">
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <Space className="header-account">
              <Select
                value={session.activeShop.id}
                style={{ width: 220 }}
                options={session.availableShops.map((shop) => ({
                  value: shop.id,
                  label: `当前店铺：${shop.name}`,
                }))}
                onChange={(id) => void switchShop(id)}
              />
              <Text>
                <UserOutlined /> {session.user.username}
              </Text>
              <Button onClick={() => setPasswordOpen(true)}>修改密码</Button>
              <Button icon={<LogoutOutlined />} onClick={() => void logout()}>
                退出
              </Button>
            </Space>
          </Header>
          <Content className="app-content">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route
                path="/product-management"
                element={<ProductManagementPage />}
              />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/products/:spu" element={<ProductDetailPage />} />
              <Route path="/orders" element={<ZhihouOrdersPage />} />
              <Route path="/spu-comparison" element={<SpuComparisonPage />} />
              <Route
                path="/global-operations"
                element={<GlobalOperationsPage />}
              />
              <Route path="/imports" element={<ImportsPage />} />
              <Route path="/anomalies" element={<AnomaliesPage />} />
              <Route path="/backups" element={<BackupsPage />} />
              <Route
                path="/admin/temu-shops"
                element={
                  session.user.role === "admin" ? (
                    <TemuShopsPage />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route
                path="/admin/zhihou-erp"
                element={
                  session.user.role === "admin" ? (
                    <ZhihouAccountPage />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route path="/users" element={<UsersPage />} />
              <Route
                path="/system-backups"
                element={
                  session.user.role === "admin" ? (
                    <SystemBackupsPage />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
      <Modal
        title="修改密码"
        open={passwordOpen}
        closable={!session.user.mustChangePassword}
        maskClosable={!session.user.mustChangePassword}
        onCancel={() => setPasswordOpen(false)}
        onOk={() => void savePassword()}
        okText="保存并重新登录"
      >
        <Form form={passwordForm} layout="vertical">
          <Form.Item
            name="currentPassword"
            label="当前密码"
            rules={[{ required: true }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[{ required: true }, { min: 8 }, { max: 128 }]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </ConfigProvider>
  );
}
