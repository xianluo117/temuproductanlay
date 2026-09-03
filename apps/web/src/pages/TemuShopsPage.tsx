import type {
  TemuBrowserEvent,
  TemuBrowserRuntimeStatus,
  TemuLifecycleSyncStatus,
  TemuShopProfile,
  TemuTrafficSyncStatus,
  UserAccount,
} from "@temu-analytics/shared";
import {
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  checkTemuShopBrowser,
  createTemuShopProfile,
  deleteTemuShopProfile,
  errorMessage,
  getLatestTemuLifecycleSync,
  getLatestTemuTrafficSync,
  getTemuBrowserEvents,
  getTemuShopProfiles,
  getUsers,
  getImageDownloadConcurrencySettings,
  saveImageDownloadConcurrencySettings,
  startTemuLifecycleSync,
  startTemuShopBrowser,
  startTemuTrafficSync,
  stopTemuShopBrowser,
  updateTemuShopGrants,
  updateTemuShopProfile,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { localDateTime } from "../utils/date-time";

const { Title, Text } = Typography;
const statusColors: Record<TemuBrowserRuntimeStatus, string> = {
  STOPPED: "default",
  STARTING: "processing",
  READY: "success",
  LOGIN_REQUIRED: "warning",
  RISK_BLOCKED: "error",
  ERROR: "error",
};
const syncStatusColors: Record<TemuTrafficSyncStatus["status"], string> = {
  running: "processing",
  completed: "success",
  failed: "error",
};
const lifecycleStatusColors: Record<TemuLifecycleSyncStatus["status"], string> = {
  running: "processing",
  completed: "success",
  failed: "error",
  partial: "warning",
};
const lifecycleStatusLabels: Record<TemuLifecycleSyncStatus["status"], string> = {
  running: "同步中",
  completed: "已完成",
  failed: "失败",
  partial: "部分完成",
};
const syncStatusLabels: Record<TemuTrafficSyncStatus["status"], string> = {
  running: "同步中",
  completed: "已完成",
  failed: "失败",
};

interface ProfileForm {
  name: string;
  accountLabel: string;
  loginAccount: string;
  loginPassword: string;
  locale: string;
  timezone: string;
  enabled: boolean;
  grantedUserIds: number[];
}

interface ImageDownloadSettingsForm {
  legacyImportConcurrency: number;
  globalQueueConcurrency: number;
}

export function TemuShopsPage() {
  const { session } = useAuth();
  const [items, setItems] = useState<TemuShopProfile[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [syncStatuses, setSyncStatuses] = useState<
    Record<number, TemuTrafficSyncStatus | null>
  >({});
  const [lifecycleSyncStatuses, setLifecycleSyncStatuses] = useState<
    Record<number, TemuLifecycleSyncStatus | null>
  >({});
  const [editing, setEditing] = useState<TemuShopProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<TemuBrowserEvent[]>([]);
  const [eventProfile, setEventProfile] = useState<TemuShopProfile | null>(
    null,
  );
  const [busyId, setBusyId] = useState<number | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [form] = Form.useForm<ProfileForm>();
  const [settingsForm] = Form.useForm<ImageDownloadSettingsForm>();
  const [messageApi, contextHolder] = message.useMessage();

  const reload = useCallback(async () => {
    const profiles = await getTemuShopProfiles();
    setItems(profiles);
    const [statuses, lifecycleStatuses] = await Promise.all([
      Promise.all(
        profiles.map(async (profile) => {
          try {
            return [
              profile.id,
              await getLatestTemuTrafficSync(profile.id),
            ] as const;
          } catch {
            return [profile.id, null] as const;
          }
        }),
      ),
      Promise.all(
        profiles.map(async (profile) => {
          try {
            return [
              profile.id,
              await getLatestTemuLifecycleSync(profile.id),
            ] as const;
          } catch {
            return [profile.id, null] as const;
          }
        }),
      ),
    ]);
    setSyncStatuses(Object.fromEntries(statuses));
    setLifecycleSyncStatuses(Object.fromEntries(lifecycleStatuses));
  }, []);
  useEffect(() => {
    if (session?.user.role !== "admin") return;
    void Promise.all([
      reload(),
      getUsers().then(setUsers),
      getImageDownloadConcurrencySettings().then((settings) =>
        settingsForm.setFieldsValue(settings),
      ),
    ]).catch((error) => messageApi.error(errorMessage(error)));
    const timer = window.setInterval(() => void reload(), 3000);
    return () => window.clearInterval(timer);
  }, [messageApi, reload, session?.user.role, settingsForm]);

  if (session?.user.role !== "admin") return <Text>无权访问管理员后台。</Text>;

  const saveImageDownloadSettings = async () => {
    setSettingsLoading(true);
    try {
      const values = await settingsForm.validateFields();
      const settings = await saveImageDownloadConcurrencySettings(values);
      settingsForm.setFieldsValue(settings);
      messageApi.success("图片下载并发设置已保存");
    } catch (error) {
      if (error instanceof Error) messageApi.error(errorMessage(error));
    } finally {
      setSettingsLoading(false);
    }
  };

  const showCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: "",
      accountLabel: "",
      loginAccount: "",
      loginPassword: "",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      enabled: true,
      grantedUserIds: [],
    });
    setOpen(true);
  };

  const showEdit = (profile: TemuShopProfile) => {
    setEditing(profile);
    form.setFieldsValue({
      name: profile.name,
      accountLabel: profile.accountLabel,
      loginAccount: profile.loginAccount ?? "",
      loginPassword: "",
      locale: profile.locale,
      timezone: profile.timezone,
      enabled: profile.enabled,
      grantedUserIds: profile.grantedUsers.map((user) => user.id),
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await updateTemuShopProfile(editing.id, values);
        await updateTemuShopGrants(editing.id, {
          userIds: values.grantedUserIds,
        });
      } else {
        await createTemuShopProfile(values);
      }
      setOpen(false);
      await reload();
      messageApi.success("店铺档案已保存");
    } catch (error) {
      if (error instanceof Error) messageApi.error(errorMessage(error));
    }
  };

  const action = async (
    id: number,
    operation: () => Promise<unknown>,
    success: string,
  ) => {
    setBusyId(id);
    try {
      await operation();
      messageApi.success(success);
      await reload();
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const syncTraffic = async (profile: TemuShopProfile) => {
    setBusyId(profile.id);
    try {
      const result = await startTemuTrafficSync(profile.id);
      setSyncStatuses((current) => ({
        ...current,
        [profile.id]: result.sync,
      }));
      messageApi.success(result.message);
      await reload();
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const syncLifecycle = async (profile: TemuShopProfile) => {
    setBusyId(profile.id);
    try {
      const result = await startTemuLifecycleSync(profile.id);
      setLifecycleSyncStatuses((current) => ({
        ...current,
        [profile.id]: result.sync,
      }));
      messageApi.success(result.message);
      await reload();
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const showEvents = async (profile: TemuShopProfile) => {
    try {
      setEventProfile(profile);
      setEvents(await getTemuBrowserEvents(profile.id));
    } catch (error) {
      messageApi.error(errorMessage(error));
    }
  };

  return (
    <div>
      {contextHolder}
      <div className="page-heading">
        <div>
          <Title level={2}>管理员后台 · 店铺档案</Title>
          <Text type="secondary">
            统一管理 Temu 登录档案、CloakBrowser 实例和用户数据查看权
          </Text>
        </div>
        <Button type="primary" onClick={showCreate}>
          新建店铺档案
        </Button>
      </div>
      <Card title="图片下载并发设置" style={{ marginBottom: 16 }}>
        <Form
          form={settingsForm}
          layout="inline"
          initialValues={{
            legacyImportConcurrency: 10,
            globalQueueConcurrency: 10,
          }}
        >
          <Form.Item
            name="legacyImportConcurrency"
            label="旧导入图片队列"
            rules={[
              { required: true, message: "请输入并发上限" },
              { type: "integer", min: 1, max: 50, message: "请输入 1–50 的整数" },
            ]}
          >
            <InputNumber min={1} max={50} precision={0} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item
            name="globalQueueConcurrency"
            label="全局图片队列"
            rules={[
              { required: true, message: "请输入并发上限" },
              { type: "integer", min: 1, max: 50, message: "请输入 1–50 的整数" },
            ]}
          >
            <InputNumber min={1} max={50} precision={0} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              loading={settingsLoading}
              onClick={() => void saveImageDownloadSettings()}
            >
              保存设置
            </Button>
          </Form.Item>
        </Form>
        <Text type="secondary">
          默认均为 10，允许 1–50。提高上限后立即补充任务；降低上限不会中断正在下载的任务，仅限制后续领取。
        </Text>
      </Card>
      <Table
        rowKey="id"
        dataSource={items}
        pagination={false}
        scroll={{ x: 1760 }}
        columns={[
          { title: "店铺", dataIndex: "name", fixed: "left", width: 150 },
          { title: "账号标识", dataIndex: "accountLabel", width: 160 },
          {
            title: "登录账号",
            dataIndex: "loginAccount",
            width: 220,
            render: (value: string | null, record: TemuShopProfile) => (
              <Space size={6}>
                <span>{value ?? "未配置"}</span>
                <Tag color={record.hasLoginPassword ? "success" : "warning"}>
                  {record.hasLoginPassword ? "密码已配置" : "密码未配置"}
                </Tag>
              </Space>
            ),
          },
          {
            title: "mallId",
            dataIndex: "mallId",
            width: 150,
            render: (value: string | null) => value ?? "登录后绑定",
          },
          { title: "Profile key", dataIndex: "profileKey", width: 190 },
          { title: "CDP", dataIndex: "cdpPort", width: 90 },
          {
            title: "授权用户",
            width: 220,
            render: (_, record: TemuShopProfile) => (
              <Space wrap>
                {record.grantedUsers.length ? (
                  record.grantedUsers.map((user) => (
                    <Tag key={user.id}>{user.username}</Tag>
                  ))
                ) : (
                  <Text type="secondary">未授权</Text>
                )}
              </Space>
            ),
          },
          {
            title: "状态",
            width: 130,
            render: (_, record: TemuShopProfile) => (
              <Tag color={statusColors[record.runtimeStatus]}>
                {record.runtimeStatus}
              </Tag>
            ),
          },
          {
            title: "最近检查",
            dataIndex: "lastCheckedAt",
            width: 180,
            render: (value: string | null) => localDateTime(value),
          },
          {
            title: "最近错误",
            dataIndex: "lastError",
            width: 240,
            ellipsis: true,
            render: (value: string | null) => value ?? "-",
          },
          {
            title: "商品流量同步",
            width: 310,
            render: (_, record: TemuShopProfile) => {
              const sync = syncStatuses[record.id];
              if (!sync) return <Text type="secondary">尚未同步</Text>;
              return (
                <Space direction="vertical" size={2}>
                  <Space wrap>
                    <Tag color={syncStatusColors[sync.status]}>
                      {syncStatusLabels[sync.status]}
                    </Tag>
                    <Text type="secondary">
                      {sync.totalPages} 页 / {sync.totalItems} 件
                    </Text>
                  </Space>
                  <Text type="secondary">
                    写入 {sync.importedItems}，覆盖 {sync.replacedItems}，操作人{" "}
                    {sync.requestedByUsername}
                  </Text>
                  <Text type="secondary">
                    {localDateTime(sync.startedAt)}
                  </Text>
                  {sync.errorMessage && (
                    <Text
                      type="danger"
                      ellipsis={{ tooltip: sync.errorMessage }}
                      style={{ maxWidth: 280 }}
                    >
                      {sync.errorMessage}
                    </Text>
                  )}
                </Space>
              );
            },
          },
          {
            title: "生命周期同步",
            width: 340,
            render: (_, record: TemuShopProfile) => {
              const sync = lifecycleSyncStatuses[record.id];
              if (!sync) return <Text type="secondary">尚未同步</Text>;
              return (
                <Space direction="vertical" size={2}>
                  <Space wrap>
                    <Tag color={lifecycleStatusColors[sync.status]}>
                      {lifecycleStatusLabels[sync.status]}
                    </Tag>
                    <Text type="secondary">
                      {sync.totalPages} 页 / SPU {sync.totalSpus} / SKC {sync.totalSkcs} / SKU {sync.totalSkus}
                    </Text>
                  </Space>
                  <Text type="secondary">
                    操作人 {sync.requestedByUsername} · {localDateTime(sync.startedAt)}
                  </Text>
                  {sync.errorMessage && (
                    <Text type="danger" ellipsis={{ tooltip: sync.errorMessage }} style={{ maxWidth: 310 }}>
                      {sync.errorMessage}
                    </Text>
                  )}
                </Space>
              );
            },
          },
          {
            title: "操作",
            fixed: "right",
            width: 620,
            render: (_, record: TemuShopProfile) => (
              <Space wrap>
                <Button onClick={() => showEdit(record)}>配置</Button>
                <Button
                  type="primary"
                  loading={busyId === record.id}
                  disabled={
                    !record.enabled || record.runtimeStatus !== "STOPPED"
                  }
                  onClick={() =>
                    void action(
                      record.id,
                      () => startTemuShopBrowser(record.id),
                      "正在启动可视浏览器",
                    )
                  }
                >
                  启动登录
                </Button>
                <Button
                  loading={busyId === record.id}
                  disabled={record.runtimeStatus === "STOPPED"}
                  onClick={() =>
                    void action(
                      record.id,
                      () => checkTemuShopBrowser(record.id),
                      "健康检查已发送",
                    )
                  }
                >
                  检查会话
                </Button>
                <Button
                  loading={
                    busyId === record.id ||
                    syncStatuses[record.id]?.status === "running"
                  }
                  disabled={
                    record.runtimeStatus !== "READY" ||
                    syncStatuses[record.id]?.status === "running"
                  }
                  onClick={() => void syncTraffic(record)}
                >
                  同步商品流量
                </Button>
                <Button
                  loading={
                    busyId === record.id ||
                    lifecycleSyncStatuses[record.id]?.status === "running"
                  }
                  disabled={
                    record.runtimeStatus !== "READY" ||
                    lifecycleSyncStatuses[record.id]?.status === "running"
                  }
                  onClick={() => void syncLifecycle(record)}
                >
                  同步生命周期
                </Button>
                <Button
                  danger
                  loading={busyId === record.id}
                  disabled={record.runtimeStatus === "STOPPED"}
                  onClick={() =>
                    void action(
                      record.id,
                      () => stopTemuShopBrowser(record.id),
                      "正在停止浏览器",
                    )
                  }
                >
                  停止
                </Button>
                <Button onClick={() => void showEvents(record)}>事件</Button>
                <Popconfirm
                  title="确认删除该档案？Profile 数据不会自动删除。"
                  onConfirm={() =>
                    void action(
                      record.id,
                      () => deleteTemuShopProfile(record.id),
                      "店铺档案已删除",
                    )
                  }
                >
                  <Button danger disabled={record.runtimeStatus !== "STOPPED"}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? "编辑店铺档案" : "新建店铺档案"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        width={640}
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="店铺名称"
            rules={[{ required: true }, { max: 100 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="loginAccount"
            label="Temu 登录账号"
            extra="手机号或子账号邮箱；包含 @ 时按邮箱登录处理。"
            rules={[
              { max: 320, message: "登录账号不能超过 320 个字符" },
              ({ getFieldValue }) => ({
                validator: async (_, value: string) => {
                  if (!value || editing || getFieldValue("loginPassword")) return;
                  throw new Error("新建店铺填写登录账号时必须同时填写密码");
                },
              }),
            ]}
          >
            <Input placeholder="手机号或子账号邮箱" />
          </Form.Item>
          <Form.Item
            name="loginPassword"
            label="Temu 登录密码"
            extra={editing ? "留空表示保持原密码不变。" : "首次配置登录账号时必须填写。"}
            rules={[
              ({ getFieldValue }) => ({
                validator: async (_, value: string) => {
                  if (value || editing || !getFieldValue("loginAccount")) return;
                  throw new Error("请填写 Temu 登录密码");
                },
              }),
            ]}
          >
            <Input.Password placeholder={editing ? "留空保持原密码" : "请输入密码"} />
          </Form.Item>
          <Form.Item
            name="accountLabel"
            label="账号备注名称"
            extra="仅用于区分不同浏览器档案，不参与 Temu 登录。可填写店铺简称、登录邮箱或手机号尾号。"
            rules={[
              { required: true, message: "请输入账号备注名称" },
              { max: 200 },
            ]}
          >
            <Input placeholder="例如：美国店主账号、邮箱尾号 1234" />
          </Form.Item>
          <Space align="start" style={{ width: "100%" }}>
            <Form.Item name="locale" label="语言" rules={[{ required: true }]}>
              <Input style={{ width: 220 }} />
            </Form.Item>
            <Form.Item
              name="timezone"
              label="时区"
              rules={[{ required: true }]}
            >
              <Input style={{ width: 260 }} />
            </Form.Item>
          </Space>
          <Form.Item name="grantedUserIds" label="数据查看授权用户">
            <Select
              mode="multiple"
              allowClear
              options={users
                .filter((user) => user.enabled)
                .map((user) => ({ value: user.id, label: user.username }))}
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
        {editing && (
          <Text type="secondary">
            Profile key、指纹种子和 CDP 端口创建后固定，不在此处修改。
          </Text>
        )}
      </Modal>
      <Drawer
        width={720}
        title={`${eventProfile?.name ?? ""} · 浏览器事件`}
        open={Boolean(eventProfile)}
        onClose={() => setEventProfile(null)}
      >
        <Table
          rowKey="id"
          dataSource={events}
          pagination={{ pageSize: 20 }}
          columns={[
            {
              title: "时间",
              dataIndex: "createdAt",
              width: 180,
              render: (value: string) => localDateTime(value),
            },
            { title: "事件", dataIndex: "eventType", width: 190 },
            {
              title: "状态",
              dataIndex: "status",
              width: 130,
              render: (value: TemuBrowserRuntimeStatus | null) =>
                value ? <Tag color={statusColors[value]}>{value}</Tag> : "-",
            },
            { title: "消息", dataIndex: "message" },
          ]}
        />
      </Drawer>
    </div>
  );
}
