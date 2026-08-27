import { closeDatabase, runDatabaseMigrations } from "./index.js";

try {
  runDatabaseMigrations();
  console.log("数据库结构初始化完成。");
} finally {
  closeDatabase();
}
