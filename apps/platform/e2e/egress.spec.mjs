import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test, expect, control } from "./support/fixtures.mjs";

test("Node HTTP and fetch cannot escape the fake-provider boundary", async () => {
  const probe = `
    import { get } from "node:https";
    const fetchStatus = (await fetch("https://unexpected-provider.invalid/fetch")).status;
    const httpStatus = await new Promise((resolve, reject) => {
      get("https://unexpected-provider.invalid/http", response => { response.resume(); resolve(response.statusCode); }).on("error", reject);
    });
    console.log(JSON.stringify({ fetchStatus, httpStatus }));
  `;
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        fileURLToPath(new URL("./support/server-preload.mjs", import.meta.url)),
        "--input-type=module",
        "-e",
        probe,
      ],
      { env: process.env, timeout: 10_000 },
    );
    expect(JSON.parse(stdout)).toEqual({ fetchStatus: 599, httpStatus: 599 });
    expect((await control("state")).violations).toEqual([
      "https://unexpected-provider.invalid",
      "https://unexpected-provider.invalid",
    ]);
  } finally {
    await control("reset", {});
  }
});
