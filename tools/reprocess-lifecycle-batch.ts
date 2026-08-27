import { reprocessLifecycleBatch } from "../apps/server/src/temu-shops/traffic-sync-service.ts";

reprocessLifecycleBatch(1, 3);
console.log("reprocessed");
