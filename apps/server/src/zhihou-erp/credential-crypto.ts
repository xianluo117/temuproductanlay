import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config, paths } from "../config.js";

const ALGORITHM: CipherGCMTypes = "aes-256-gcm";
const VERSION = "v1";

function encryptionKey(): Buffer {
  if (config.zhihouCredentialKey.trim()) {
    const configuredKey = Buffer.from(
      config.zhihouCredentialKey.trim(),
      "base64",
    );
    if (configuredKey.length !== 32)
      throw new Error("ZHIHOU_CREDENTIAL_KEY 必须是 32 字节密钥的 Base64 编码。");
    return configuredKey;
  }
  fs.mkdirSync(path.dirname(paths.zhihouCredentialKey), { recursive: true });
  if (fs.existsSync(paths.zhihouCredentialKey)) {
    const storedKey = Buffer.from(
      fs.readFileSync(paths.zhihouCredentialKey, "utf8").trim(),
      "base64",
    );
    if (storedKey.length !== 32)
      throw new Error("本地智猴凭据密钥文件无效，请恢复正确密钥或重新配置账号。");
    return storedKey;
  }
  const generatedKey = randomBytes(32);
  fs.writeFileSync(paths.zhihouCredentialKey, generatedKey.toString("base64"), {
    encoding: "utf8",
    flag: "wx",
  });
  return generatedKey;
}

export function encryptZhihouPassword(password: string): string {
  if (!password) throw new Error("智猴密码不能为空。");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final(),
  ]);
  const authenticationTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    authenticationTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptZhihouPassword(encoded: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = encoded.split(".");
  if (
    version !== VERSION ||
    !ivValue ||
    !tagValue ||
    ciphertextValue === undefined
  )
    throw new Error("智猴密码密文格式无效。");
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("智猴密码解密失败，请检查凭据密钥或重新设置密码。");
  }
}
