import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const run = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** Every caller owns its container; never accept an application DATABASE_URL. */
export async function startPostgres({ signal } = {}) {
  const name = "agentcaller-e2e-" + randomUUID();
  const stop = () => {
    try {
      run(["rm", "--force", name]);
    } catch {
      /* Already removed. */
    }
  };
  try {
    signal?.throwIfAborted();
    run([
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
    for (let attempt = 0; attempt < 60; attempt++) {
      signal?.throwIfAborted();
      try {
        run(["exec", name, "pg_isready", "-U", "postgres"]);
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!ready) throw new Error("Owned E2E PostgreSQL did not become ready");
    const port = run(["port", name, "5432/tcp"]).split(":").at(-1);
    return {
      url: "postgresql://postgres:offline-test@127.0.0.1:" + port + "/postgres",
      stop,
    };
  } catch (error) {
    stop();
    throw error;
  }
}
