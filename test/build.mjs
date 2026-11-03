import esbuild from "esbuild";
await esbuild.build({ entryPoints:["src/main.ts"], bundle:true, format:"cjs", platform:"node", outfile:"test/bundle.cjs", alias:{ obsidian:"./test/obsidian-mock.js" }, external:["./obsidian-mock.js"], logLevel:"error" });
