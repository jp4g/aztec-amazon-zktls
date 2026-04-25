"use client";

import { Fragment, useCallback, useState } from "react";

type Status = "idle" | "running" | "success" | "error";

type AttestResponse = {
  ok: boolean;
  attestation?: unknown;
  taskResult?: unknown;
  taskId?: string;
  privateData?: { id: string; content: string }[];
  verificationType?: string[];
  log?: string[];
  error?: string;
};

const COOKIE_FIELDS = [
  "session-id",
  "ubid-main",
  "at-main",
  "sess-at-main",
  "x-main",
  "session-token",
  "lc-main",
] as const;
type CookieField = (typeof COOKIE_FIELDS)[number];
type CookieMap = Record<CookieField, string>;

const EMPTY_COOKIES: CookieMap = COOKIE_FIELDS.reduce(
  (acc, k) => ({ ...acc, [k]: "" }),
  {} as CookieMap,
);

// Map cookie field name → NEXT_PUBLIC_AMAZON_<UPPER_SNAKE> env var. Read at
// module load (Next inlines NEXT_PUBLIC_* at build/dev time). Any field whose
// env var is unset stays blank in the form.
const ENV_KEY: Record<CookieField, string> = {
  "session-id": "NEXT_PUBLIC_AMAZON_SESSION_ID",
  "ubid-main": "NEXT_PUBLIC_AMAZON_UBID_MAIN",
  "at-main": "NEXT_PUBLIC_AMAZON_AT_MAIN",
  "sess-at-main": "NEXT_PUBLIC_AMAZON_SESS_AT_MAIN",
  "x-main": "NEXT_PUBLIC_AMAZON_X_MAIN",
  "session-token": "NEXT_PUBLIC_AMAZON_SESSION_TOKEN",
  "lc-main": "NEXT_PUBLIC_AMAZON_LC_MAIN",
};
const ENV_COOKIES: CookieMap = COOKIE_FIELDS.reduce((acc, k) => {
  acc[k] = process.env[ENV_KEY[k]] ?? "";
  return acc;
}, { ...EMPTY_COOKIES });

const DEFAULT_ORDER_ID = process.env.NEXT_PUBLIC_AMAZON_ORDER_ID ?? "";

function assembleCookieHeader(map: CookieMap): string {
  return COOKIE_FIELDS.filter((k) => map[k].trim() !== "")
    .map((k) => `${k}=${map[k].trim()}`)
    .join("; ");
}

export default function AttestPurchase() {
  const [orderId, setOrderId] = useState(DEFAULT_ORDER_ID);
  const [cookies, setCookies] = useState<CookieMap>(ENV_COOKIES);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AttestResponse | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const cookieHeader = assembleCookieHeader(cookies);
  const hasCookies = cookieHeader !== "";

  const handleAttest = useCallback(async () => {
    setStatus("running");
    setError(null);
    setResult(null);
    setLogs([
      `[${new Date().toISOString()}] POST /api/primus/attest (this can take 60–120s — submitTask + on-chain wait + attestor work)`,
    ]);

    try {
      const res = await fetch("/api/primus/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: orderId.trim(),
          cookieHeader,
        }),
      });
      const json = (await res.json()) as AttestResponse;
      if (json.log) setLogs((prev) => [...prev, ...json.log!]);
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `attest endpoint returned ${res.status}`);
      }
      setResult(json);
      setStatus("success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      setError(msg);
      setStatus("error");
    }
  }, [orderId, cookieHeader]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attestation-${result.taskId ?? Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="attest">
      <section className="row">
        <label>
          Order ID:{" "}
          <input
            type="text"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            disabled={status === "running"}
            style={{
              font: "inherit",
              padding: "6px 10px",
              borderRadius: 4,
              border: "1px solid #d4d4d4",
              width: 220,
            }}
          />
        </label>
      </section>

      <section
        className="row"
        style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <label style={{ fontSize: 13 }}>
            Amazon session cookies (DevTools → Application → Cookies →
            <code> https://www.amazon.com</code>):
          </label>
          <button
            type="button"
            onClick={() => setCookies(EMPTY_COOKIES)}
            disabled={status === "running" || !hasCookies}
            style={{
              font: "inherit",
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid #d4d4d4",
              background: "#fafafa",
              cursor: hasCookies ? "pointer" : "not-allowed",
              flexShrink: 0,
            }}
          >
            Clear
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            columnGap: 10,
            rowGap: 6,
            alignItems: "center",
          }}
        >
          {COOKIE_FIELDS.map((name) => (
            <Fragment key={name}>
              <label
                htmlFor={`cookie-${name}`}
                style={{
                  font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: "#444",
                }}
              >
                {name}
              </label>
              <input
                id={`cookie-${name}`}
                type="text"
                value={cookies[name]}
                onChange={(e) =>
                  setCookies((prev) => ({ ...prev, [name]: e.target.value }))
                }
                disabled={status === "running"}
                placeholder={name}
                spellCheck={false}
                style={{
                  font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
                  padding: "6px 10px",
                  borderRadius: 4,
                  border: "1px solid #d4d4d4",
                  width: "100%",
                }}
              />
            </Fragment>
          ))}
        </div>
      </section>

      <section className="row">
        <button
          type="button"
          onClick={handleAttest}
          disabled={status === "running" || !orderId.trim() || !hasCookies}
        >
          {status === "running" ? "Attesting…" : "Attest Amazon purchase"}
        </button>
        <span className={`status status-${status}`}>{status}</span>
      </section>

      {error && (
        <section className="error">
          <strong>Error:</strong> {error}
        </section>
      )}

      {status === "success" && result?.privateData && (
        <section className="result">
          <h2>Extracted fields (signed sha256 hashes)</h2>
          <p style={{ fontSize: 12, color: "#666", margin: "0 0 8px" }}>
            Each <code>content</code> below is the plain text the Primus
            attestor saw inside its Phala TEE. The attestation stores
            <code> sha256(content)</code>; the Noir circuit recomputes the
            hash with this text as private input and verifies the signature.
          </p>
          <pre>{JSON.stringify(result.privateData, null, 2)}</pre>
          <button type="button" onClick={handleDownload}>
            Download attestation.json
          </button>
        </section>
      )}

      {result?.attestation !== undefined && (
        <details>
          <summary>Full attestation result</summary>
          <pre>{JSON.stringify(result.attestation, null, 2)}</pre>
        </details>
      )}

      {logs.length > 0 && (
        <details open={status !== "success"}>
          <summary>Logs</summary>
          <pre>{logs.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}
