import type {
  ZhihouAccount,
  ZhihouOrderSyncBatch,
} from "@temu-analytics/shared";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  errorMessage,
  getLatestZhihouOrderSync,
  getZhihouAccount,
  saveZhihouAccount,
  syncZhihouPendingOrders,
  testZhihouAccount,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";

const { Title, Text } = Typography;

interface AccountForm {
  account: string;
  password?: string;
  enabled: boolean;
}

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

export function ZhihouAccountPage() {
  const { session } = useAuth();
  const [account, setAccount] = useState<ZhihouAccount | null>(null);
  const [sync, setSync] = useState<ZhihouOrderSyncBatch | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "sync" | null>(null);
  const [form] = Form.useForm<AccountForm>();
  const [messageApi, contextHolder] = message.useMessage();

  const reload = useCallback(async () => {
    const [nextAccount, nextSync] = await Promise.all([
      getZhihouAccount(),
      getLatestZhihouOrderSync(),
    ]);
    setAccount(nextAccount);
    setSync(nextSync);
    form.setFieldsValue({
      account: nextAccount?.account ?? "",
      password: "",
      enabled: nextAccount?.enabled ?? true,
    });
  }, [form]);

  useEffect(() => {
    if (session?.user.role === "admin") void reload();
  }, [reload, session?.user.role]);

  if (session?.user.role !== "admin") return <Text>无权访问管理员后台。</Text>;

  const save = async () => {
    setBusy("save");
    try {
      const values = await form.validateFields();
      const input: AccountForm = {
        account: values.account,
        enabled: values.enabled,
      };
      if (values.password) input.password = values.password;
      await saveZhihouAccount(input);
      messageApi.success("智猴账号已保存");
      await reload();
    } catch (error) {
      if (error instanceof Error) messageApi.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const result = await testZhihouAccount();
      messageApi.success(result.message);
      await reload();
    } catch (error) {
      messageApi.error(errorMessage(error));
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const synchronize = async () => {
    setBusy("sync");
    try {
      const result = await syncZhihouPendingOrders();
      messageApi.success(
        `同步完成：${result.orderCount} 个新订单，${result.itemCount} 条商品明细`,
      );
      await reload();
    } catch (error) {
      messageApi.error(errorMessage(error));
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {contextHolder}
      <div className="page-heading">
        <div>
          <Title level={2}>管理员后台 · 智猴账号</Title>
          <Text type="secondary">
            全系统只使用一个智猴 ERP 账号。本期仅支持登录测试和手动同步 PENDING 新订单。
          </Text>
        </div>
      </div>
      <Alert
        showIcon
        type="info"
        message="字段口径"
        description="智猴订单商品字段 spu 实际为 SKU。同步后会跨全部 Temu 店铺的产品管理数据匹配 SKU，并回溯上级 SPU 与货源链接。"
        style={{ marginBottom: 16 }}
      />
      <Card title="账号配置" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical" style={{ maxWidth: 640 }}>
          <Form.Item
            name="account"
            label="智猴登录账号"
            rules={[{ required: true, message: "请输入智猴登录账号" }, { max: 200 }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label={account?.hasPassword ? "重置密码" : "登录密码"}
            extra={
              account?.hasPassword
                ? "留空表示保留已加密保存的原密码。页面不会读取或回填密码。"
                : "首次配置必须填写。密码使用服务端认证加密保存。"
            }
            rules={account?.hasPassword ? [] : [{ required: true, message: "请输入智猴登录密码" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="enabled" label="启用账号" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Space wrap>
            <Button type="primary" loading={busy === "save"} onClick={() => void save()}>
              保存账号
            </Button>
            <Button
              loading={busy === "test"}
              disabled={!account || busy !== null}
              onClick={() => void test()}
            >
              测试登录
            </Button>
            <Button
              loading={busy === "sync"}
              disabled={!account?.enabled || busy !== null}
              onClick={() => void synchronize()}
            >
              手动同步新订单
            </Button>
          </Space>
        </Form>
      </Card>
      <Card title="运行状态">
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="账号状态">
            {account ? (
              <Tag color={account.enabled ? "success" : "default"}>
                {account.enabled ? "已启用" : "已停用"}
              </Tag>
            ) : (
              "未配置"
            )}
          </Descriptions.Item>
          <Descriptions.Item label="最近登录测试">
            {account ? (
              <Space>
                <Tag
                  color={
                    account.lastTestStatus === "success"
                      ? "success"
                      : account.lastTestStatus === "failed"
                        ? "error"
                        : "default"
                  }
                >
                  {account.lastTestStatus === "success"
                    ? "成功"
                    : account.lastTestStatus === "failed"
                      ? "失败"
                      : "未测试"}
                </Tag>
                {dateTime(account.lastTestedAt)}
              </Space>
            ) : (
              "-"
            )}
          </Descriptions.Item>
          <Descriptions.Item label="测试错误" span={2}>
            {account?.lastTestError ?? "-"}
          </Descriptions.Item>
          <Descriptions.Item label="最近同步">
            {sync ? (
              <Space>
                <Tag
                  color={
                    sync.status === "completed"
                      ? "success"
                      : sync.status === "failed"
                        ? "error"
                        : "processing"
                  }
                >
                  {sync.status === "completed"
                    ? "已完成"
                    : sync.status === "failed"
                      ? "失败"
                      : "同步中"}
                </Tag>
                {dateTime(sync.startedAt)}
              </Space>
            ) : (
              "尚未同步"
            )}
          </Descriptions.Item>
          <Descriptions.Item label="同步数量">
            {sync ? `${sync.pageCount} 页 / ${sync.orderCount} 单 / ${sync.itemCount} 明细` : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="同步错误" span={2}>
            {sync?.errorMessage ?? "-"}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}
