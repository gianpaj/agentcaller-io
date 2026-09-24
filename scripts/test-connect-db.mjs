import { spawnSync } from "node:child_process";
const name = `agentcaller-test-${process.pid}`;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0)
    throw new Error(result.stderr || `${command} exited ${result.status}`);
  return result.stdout?.trim();
}
try {
  run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=offline-test",
    "-p",
    "127.0.0.1::5432",
    "postgres:17-alpine",
  ]);
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (
      spawnSync("docker", ["exec", name, "pg_isready", "-U", "postgres"], {
        stdio: "ignore",
      }).status === 0
    ) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Local PostgreSQL did not become ready");
  const port = run("docker", ["port", name, "5432/tcp"]).split(":").at(-1);
  run(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@agentcaller/platform",
      "exec",
      "vitest",
      "run",
      "src/lib/connect-me.integration.test.ts",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        CONNECT_TEST_DATABASE_URL: `postgresql://postgres:offline-test@127.0.0.1:${port}/postgres`,
      },
    },
  );
} finally {
  spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
}
