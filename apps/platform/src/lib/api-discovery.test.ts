import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { GET as getCatalog } from "@/app/.well-known/api-catalog/route";
import { GET as getOpenapi } from "@/app/openapi.json/route";

describe("API discovery", () => {
  it("serves a Linkset with public API description, documentation, and health links", async () => {
    const response = getCatalog();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    );
    const { linkset } = await response.json();
    expect(linkset).toHaveLength(1);
    expect(linkset[0]).toEqual({
      anchor: "https://agentcaller.io/api/v1/calls",
      "service-desc": [
        {
          href: "https://agentcaller.io/openapi.json",
          type: "application/json",
        },
      ],
      "service-doc": [
        { href: "https://docs.agentcaller.io", type: "text/html" },
      ],
      status: [
        { href: "https://agentcaller.io/api/health", type: "application/json" },
      ],
    });
  });

  it("adds all four discovery relations to the homepage response", async () => {
    const rules = await nextConfig.headers!();
    const homepage = rules.find((rule) => rule.source === "/");
    const link = homepage?.headers.find(
      (header) => header.key === "Link",
    )?.value;
    expect(link).toContain('</.well-known/api-catalog>; rel="api-catalog"');
    expect(link).toContain('</openapi.json>; rel="service-desc"');
    expect(link).toContain('<https://docs.agentcaller.io>; rel="service-doc"');
    expect(link).toContain('</auth.md>; rel="describedby"');
    const billing = rules.find((rule) => rule.source === "/billing/:path*");
    expect(billing?.headers).toEqual(
      expect.arrayContaining([
        { key: "Cache-Control", value: "private, no-store" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ]),
    );
  });

  it("describes every public API operation without advertising internal routes", async () => {
    const response = getOpenapi();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const spec = await response.json();
    expect(spec.openapi).toBe("3.1.1");
    expect(spec.servers).toEqual([{ url: "https://agentcaller.io" }]);
    expect(spec.components.securitySchemes.apiKey.scheme).toBe("bearer");
    expect(spec.security).toEqual([{ apiKey: [] }]);
    expect(spec.paths["/api/health"].get.security).toEqual([]);

    const apiRoot = new URL("../app/api/", import.meta.url);
    const operations: string[] = [];
    for (const file of readdirSync(apiRoot, { recursive: true }) as string[]) {
      // Provider webhooks authenticate provider callbacks, not API clients.
      if (
        !file.endsWith("route.ts") ||
        file.startsWith("internal/") ||
        file.startsWith("stripe/")
      )
        continue;
      const source = readFileSync(join(apiRoot.pathname, file), "utf8");
      const path = `/api/${file.replace(/\/route\.ts$/, "").replace(/\[([^\]]+)\]/g, "{$1}")}`;
      for (const match of source.matchAll(
        /export (?:async )?function (GET|POST|DELETE)\(/g,
      )) {
        if (path.includes("{operation}")) {
          const handler = source.slice(
            match.index,
            source.indexOf("export ", match.index + 1) === -1
              ? undefined
              : source.indexOf("export ", match.index + 1),
          );
          const names = [
            ...handler.matchAll(/operation\s*(?:===|!==)\s*"([^"]+)"/g),
          ];
          expect(names.length).toBeGreaterThan(0);
          for (const name of names)
            operations.push(
              `${match[1].toLowerCase()} ${path.replace("{operation}", name[1])}`,
            );
        } else {
          operations.push(`${match[1].toLowerCase()} ${path}`);
        }
      }
    }
    const documented = Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.keys(item as object)
        .filter((method) => ["get", "post", "delete"].includes(method))
        .map((method) => `${method} ${path}`),
    );
    expect(documented.sort()).toEqual(operations.sort());
    expect(spec.paths["/api/stripe/webhook"]).toBeUndefined();
  });

  it("publishes shared task input constraints and the custom calling window", async () => {
    const spec = await getOpenapi().json();
    const schema = spec.components.schemas.CreateCall;
    expect(schema.required).toEqual(
      expect.arrayContaining([
        "destination",
        "destinationCountry",
        "language",
        "maxDurationSeconds",
        "maxAmountUsd",
        "task",
      ]),
    );
    expect(schema.properties.maxDurationSeconds.maximum).toBe(1800);
    const tasks = schema.properties.task.oneOf ?? schema.properties.task.anyOf;
    expect(
      tasks
        .map(
          (task: { properties: { type: { const: string } } }) =>
            task.properties.type.const,
        )
        .sort(),
    ).toEqual([
      "appointment",
      "availability",
      "connect_me",
      "information",
      "reservation",
    ]);
    const connect = tasks.find(
      (task: { properties: { type: { const: string } } }) =>
        task.properties.type.const === "connect_me",
    );
    expect(connect.properties.callingWindow.anyOf[0]).toEqual({
      const: "now",
      type: "string",
    });
    expect(connect.properties.callingWindow.anyOf[1].required).toEqual([
      "timezone",
      "weekdays",
      "start",
      "end",
    ]);
    expect(connect.required).not.toContain("maxAttempts");
    expect(connect.properties.maxAttempts.default).toBe(6);
  });

  it("distinguishes saved-card request schemas, responses, and supported authentication", async () => {
    const spec = await getOpenapi().json();
    const { CreateCall, CreateStripeCall, QuoteStripeCall } =
      spec.components.schemas;
    expect(CreateCall.required).toContain("maxAmountUsd");
    expect(CreateStripeCall.required).toEqual(
      expect.arrayContaining(["maxAmountCents", "quoteVersion"]),
    );
    expect(CreateStripeCall.properties.maxAmountUsd).toBeUndefined();
    expect(CreateStripeCall.properties.maxAmountCents.type).toBe("integer");
    expect(CreateStripeCall.additionalProperties).toBe(false);
    expect(CreateStripeCall.properties.task.properties.type.const).toBe(
      "connect_me",
    );
    expect(
      CreateStripeCall.properties.task.properties.callingWindow.anyOf,
    ).toHaveLength(2);
    expect(QuoteStripeCall.required).not.toContain("quoteVersion");
    expect(QuoteStripeCall.properties.quoteVersion).toBeUndefined();
    expect(
      spec.paths["/api/v1/calls"].post.requestBody.content["application/json"]
        .schema.anyOf,
    ).toEqual([
      { $ref: "#/components/schemas/CreateCall" },
      { $ref: "#/components/schemas/CreateStripeCall" },
    ]);
    expect(spec.paths["/api/v1/calls"].post.responses).toHaveProperty("201");
    expect(spec.paths["/api/v1/calls"].post.responses).toHaveProperty("202");
    expect(spec.paths["/api/v1/calls"].post.responses).toHaveProperty("409");
    expect(spec.components.securitySchemes.agentToken).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    for (const [path, method] of [
      ["/api/v1/calls", "post"],
      ["/api/v1/calls/{id}", "get"],
      ["/api/v1/calls/{id}/cancel", "post"],
      ["/api/v1/calls/quote", "post"],
      ["/api/v1/billing/setup", "post"],
      ["/api/v1/billing/setup/{id}", "get"],
      ["/api/v1/billing/status", "get"],
      ["/api/v1/billing/usage", "get"],
    ]) {
      expect(spec.paths[path][method].security).toEqual([
        { apiKey: [] },
        { agentToken: [] },
      ]);
    }
    for (const [path, method] of [
      ["/api/v1/calls", "get"],
      ["/api/v1/calls/{id}", "delete"],
      ["/api/v1/calls/{id}/transcript", "get"],
      ["/api/v1/calls/{id}/recording", "get"],
    ]) {
      expect(spec.paths[path][method].security ?? spec.security).toEqual([
        { apiKey: [] },
      ]);
    }
  });
});
