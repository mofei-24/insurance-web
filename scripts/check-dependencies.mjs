import fs from "node:fs";
import path from "node:path";
const project = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const missing = Object.keys({
  ...project.dependencies,
  ...project.devDependencies,
}).filter((name) => {
  const file = path.join("node_modules", name, "package.json");
  if (!fs.existsSync(file)) return true;
  const installed = JSON.parse(fs.readFileSync(file, "utf8"));
  return installed.version !== lock.packages[`node_modules/${name}`]?.version;
});
if (missing.length) {
  console.log(`Missing or changed: ${missing.join(", ")}`);
  process.exitCode = 1;
}
