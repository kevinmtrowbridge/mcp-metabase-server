import * as esbuild from "esbuild";
import { builtinModules } from "node:module";

// Externalize Node builtins AND npm packages that use CJS require() internally.
// axios -> form-data -> combined-stream uses require("util") at runtime.
// Bundling these CJS packages into ESM causes "Dynamic require not supported" errors.
const external = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  // npm packages with CJS internals that break under ESM bundling
  "axios",
  "form-data",
  "combined-stream",
  "follow-redirects",
  "mime-types",
  "proxy-from-env",
];

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.js",
  external,
});

console.log("Bundle built: dist/index.js");
console.log("Note: axios and its CJS deps are external — node_modules must be present at runtime.");
