// 构建期提取脚本：调用上游自带的打包清单 standaloneSourceFiles()，
// 把「独立服务真正需要的精确文件」复制到 /dist，自动排除 DSH 内核耦合的插件包。
import { standaloneSourceFiles } from "/src/scripts/pack-standalone.mjs";
import fs from "node:fs";
import path from "node:path";

const SRC = "/src";
const DST = "/dist";

const files = standaloneSourceFiles();
fs.mkdirSync(DST, { recursive: true });
let n = 0;
for (const f of files) {
  const s = path.join(SRC, f);
  if (!fs.existsSync(s)) {
    console.error("MISSING in upstream tree:", f);
    process.exit(1);
  }
  const d = path.join(DST, f);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(s, d);
  n++;
}
console.log("Extracted", n, "standalone files into /dist");
