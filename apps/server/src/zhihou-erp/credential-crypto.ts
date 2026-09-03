import { decryptCredential, encryptCredential } from "../auth/credential-crypto.js";

export function encryptZhihouPassword(password: string): string {
  return encryptCredential(password);
}

export function decryptZhihouPassword(encoded: string): string {
  try {
    return decryptCredential(encoded);
  } catch {
    throw new Error("智猴密码解密失败，请检查凭据密钥或重新设置密码。");
  }
}
