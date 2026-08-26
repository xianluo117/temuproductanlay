import type {
  TemuBrowserEvent,
  TemuBrowserRuntimeStatus,
  TemuShopProfile,
  TemuTrafficSyncStatus,
  UserAccount,
} from "@temu-analytics/shared";
import {
  Button,
  Drawer,
  Form,
  Input,
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
  getLatestTemuTrafficSync,
  getTemuBrowserEvents,
  getTemuShopProfiles,
  getUsers,
  startTemuShopBrowser,
  startTemuTrafficSync,
  stopTemuShopBrowser,
  updateTemuShopGrants,
  updateTemuShopProfile,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";

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
const syncStatusLabels: Record<TemuTrafficSyncStatus["status"], string> = {
  running: "同步中",
  completed: "已完成",
  failed: "失败",
};

interface ProfileForm {
  name: string;
  accountLabel: string;
  locale: string;
  timezone: string;
  enabled: boolean;
  grantedUserIds: number[];
}

export function TemuShopsPage() {
  const { session } = useAuth();
  const [items, setItems] = useState<TemuShopProfile[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [syncStatuses, setSyncStatuses] = useState<
    Record<number, TemuTrafficSyncStatus | null>
  >({});
  const [editing, setEditing] = useState<TemuShopProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<TemuBrowserEvent[]>([]);
  const [eventProfile, setEventProfile] = useState<TemuShopProfile | null>(
    null,
  );
  const [busyId, setBusyId] = useState<number | null>(null);
  const [form] = Form.useForm<ProfileForm>();
  const [messageApi, contextHolder] = message.useMessage();

  const reload = useCallback(async () => {
    const profiles = await getTemuShopProfiles();
    setItems(profiles);
    const statuses = await Promise.all(
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
    );
    setSyncStatuses(Object.fromEntries(statuses));
  }, []);
  useEffect(() => {
    if (session?.user.role !== "admin") return;
    void Promise.all([reload(), getUsers().then(setUsers)]);
    const timer = window.setInterval(() => void reload(), 3000);
    return () => window.clearInterval(timer);
  }, [reload, session?.user.role]);

  if (session?.user.role !== "admin") return <Text>无权访问管理员后台。</Text>;

  const showCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: "",
      accountLabel: "",
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
      <Table
        rowKey="id"
        dataSource={items}
        pagination={false}
        scroll={{ x: 1760 }}
        columns={[
          { title: "店铺", dataIndex: "name", fixed: "left", width: 150 },
          { title: "账号标识", dataIndex: "accountLabel", width: 160 },
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
            render: (value: string | null) =>
              value ? new Date(value).toLocaleString() : "-",
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
                    {new Date(sync.startedAt).toLocaleString()}
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
            title: "操作",
            fixed: "right",
            width: 500,
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
              render: (value: string) => new Date(value).toLocaleString(),
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
