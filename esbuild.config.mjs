import esbuild from "esbuild"; import builtins from "builtin-modules";
const prod = process.argv[2] === "production";
await esbuild.build({ entryPoints:["src/main.ts"], bundle:true, external:["obsidian","electron","@codemirror/*","@lezer/*",...builtins],
  format:"cjs", target:"es2020", sourcemap: prod?false:"inline", minify: prod, treeShaking:true, outfile:"main.js", logLevel:"info" });
