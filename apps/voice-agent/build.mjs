import { build } from "esbuild";
// Bundle workspace TypeScript; leave native RTC and provider packages to Node.
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  plugins: [
    {
      name: "workspace",
      setup(builder) {
        builder.onResolve({ filter: /^[^./]|^@/ }, (args) => {
          if (args.path === "@agentcaller/contracts") return undefined;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
