import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { PrimusNetwork } from "@primuslabs/network-core-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Submitting an on-chain task + waiting for the attestor + polling for the
// task result regularly takes 60–120s. Default Next/Vercel limits would kill
// the route well before that.
export const maxDuration = 300;

// XPaths verified against example-order.html via scripts/test_xpaths.py.
//
// Primus parser dialect (decoded from runtime errors and the SDK's html.test):
//   * `//*[@id="X"]/tag[N]/tag[N]/...` only — id-anchored wildcard
//     descendant, then pure child-axis. Every element step requires an
//     explicit [N] index; otherwise "[Find] index is missing for ...".
//   * `[@data-component="X"]`, `[@class="X"]`, etc. fall through to
//     OtherError|basic_string — only `@id` works as a predicate attribute.
//   * Returned value is the matched element's outer HTML (open tag + attrs
//     + inner content + close tag), not its text content.
//
// Only three useful top-level ids: `orderDetails` (root container),
// `shipment-top-row`, and `od-subtotals`. Anchor at the closest one per
// field. `op: "SHA256_EX"` makes the attestor sign sha256(outer_html); the
// Noir circuit recomputes that hash over the plain text we hand it as
// private input and verifies the attestor's signature.
type ResponseResolve = {
  keyName: string;
  parseType: "html" | "json";
  parsePath: string;
  op: "SHA256_EX" | "REVEAL_STRING";
};

const FIELD_RESOLVES: ResponseResolve[] = [
  {
    keyName: "shipmentStatus",
    parseType: "html",
    parsePath: '//*[@id="shipment-top-row"]/div[1]/div[1]/h4[1]',
    op: "SHA256_EX",
  },
  {
    // Anchor wraps the title <a> as outer HTML
    //   `<a class="a-link-normal" href="/dp/<ASIN>?ref_=…">PRODUCT TITLE</a>`
    // — so a single signed field carries BOTH the human-readable title AND
    // the ASIN. Slice both out in Noir; no separate `asinHref` resolve.
    keyName: "productTitle",
    parseType: "html",
    parsePath:
      '//*[@id="orderDetails"]' +
      "/div[1]/div[3]/div[1]/div[1]/div[7]/div[1]/div[1]/div[1]/div[1]" +
      "/div[1]/div[1]/div[1]/div[1]/div[2]/div[1]/div[1]/div[1]/div[2]" +
      "/div[1]/div[1]/div[1]/a[1]",
    op: "SHA256_EX",
  },
  {
    keyName: "shipTo",
    parseType: "html",
    parsePath:
      '//*[@id="orderDetails"]' +
      "/div[1]/div[3]/div[1]/div[1]/div[6]/div[1]/div[1]/div[1]/div[1]" +
      "/div[1]/div[1]/div[1]/div[1]/div[1]/ul[1]",
    op: "SHA256_EX",
  },
  {
    // Grand total value span. NOTE: `li[6]` is position-dependent on the fee
    // breakdown — works for the standard six-row layout (subtotal, shipping,
    // total-before-tax, tax, regional fees, grand total). If a row appears
    // or disappears (promo credit, gift wrap, etc.) the index shifts and the
    // path breaks. For full robustness across order shapes, widen to ul[1]
    // and slice in Noir.
    keyName: "grandTotal",
    parseType: "html",
    parsePath:
      '//*[@id="od-subtotals"]' +
      "/div[1]/div[1]/ul[1]/li[6]/span[1]/div[1]/div[2]/span[1]",
    op: "SHA256_EX",
  },
];

// Cache the initialized PrimusNetwork on globalThis (NOT module scope). The
// SDK's `init()` boots a process-global WASM module and the
// onRuntimeInitialized callback fires exactly once per Node process; a
// second `init()` call hangs 5s and rejects with "WASM module
// initialization timeout". Globals survive Turbopack hot-reloads of this
// route file; module-scope state does not.
type PrimusCache = {
  instance: InstanceType<typeof PrimusNetwork> | null;
  initFor: { chainId: number; signer: string } | null;
  initPromise: Promise<unknown> | null;
};
const PRIMUS_CACHE_KEY = "__amazon_zktls_primus_cache__";
const cache: PrimusCache = ((globalThis as unknown as Record<string, unknown>)[
  PRIMUS_CACHE_KEY
] ??= { instance: null, initFor: null, initPromise: null }) as PrimusCache;

async function getInitializedPrimus(
  wallet: ethers.Wallet,
  chainId: number,
): Promise<InstanceType<typeof PrimusNetwork>> {
  const fingerprint = { chainId, signer: wallet.address };
  if (
    cache.instance &&
    cache.initFor &&
    cache.initFor.chainId === fingerprint.chainId &&
    cache.initFor.signer === fingerprint.signer
  ) {
    return cache.instance;
  }
  if (cache.initPromise) {
    await cache.initPromise;
    if (cache.instance) return cache.instance;
  }
  const primus = new PrimusNetwork();
  cache.initPromise = primus.init(wallet, chainId, "wasm");
  try {
    await cache.initPromise;
    cache.instance = primus;
    cache.initFor = fingerprint;
    return primus;
  } finally {
    cache.initPromise = null;
  }
}

// JSON-stringify replacer that flattens ethers BigNumber and native bigint
// into decimal strings. Without this the chain-side fields (timestamps,
// task ids returned as BN) crash NextResponse.json().
function safeJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (
        v &&
        typeof v === "object" &&
        "_isBigNumber" in v &&
        (v as { _isBigNumber?: unknown })._isBigNumber === true
      ) {
        return (v as { toString: () => string }).toString();
      }
      return v;
    }),
  );
}

export async function POST(req: Request) {
  const {
    PRIMUS_TX_PRIVATE_KEY,
    CHAIN_ID,
    RPC_URL,
    NEXT_PUBLIC_PRIMUS_APP_ID,
  } = process.env;

  if (!PRIMUS_TX_PRIVATE_KEY || !CHAIN_ID || !RPC_URL) {
    return NextResponse.json(
      {
        error:
          "missing env: PRIMUS_TX_PRIVATE_KEY, CHAIN_ID, RPC_URL must be set",
      },
      { status: 500 },
    );
  }
  if (!NEXT_PUBLIC_PRIMUS_APP_ID) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_PRIMUS_APP_ID not set" },
      { status: 500 },
    );
  }

  let body: { orderId?: string; cookieHeader?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { orderId, cookieHeader } = body;
  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json(
      { error: "orderId (string) required" },
      { status: 400 },
    );
  }

  // StaticJsonRpcProvider: never re-detects the network at runtime. Required
  // because (a) Base Sepolia (84532) isn't in ethers v5's built-in network
  // table so plain JsonRpcProvider's auto-detect throws `noNetwork`, and (b)
  // the SDK pulls a nested ethers copy that can mismatch ours during
  // instanceof checks.
  const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL, {
    name: "base-sepolia",
    chainId: Number(CHAIN_ID),
  });
  const wallet = new ethers.Wallet(PRIMUS_TX_PRIVATE_KEY, provider);

  const request = {
    url: `https://www.amazon.com/gp/css/summary/print.html?orderID=${encodeURIComponent(
      orderId.trim(),
    )}`,
    method: "GET",
    header:
      cookieHeader && cookieHeader.trim() !== ""
        ? { Cookie: cookieHeader }
        : {},
    body: "",
  };
  const responseResolves = FIELD_RESOLVES;
  const attestParams = { address: wallet.address };

  const trace: string[] = [];
  const log = (line: string) =>
    trace.push(`[${new Date().toISOString()}] ${line}`);

  try {
    log(`probing provider at ${RPC_URL}`);
    const detected = await provider.getNetwork();
    log(
      `provider.getNetwork() ok: chainId=${detected.chainId}, name=${detected.name}`,
    );
    const blockNumber = await provider.getBlockNumber();
    const balance = await wallet.getBalance();
    log(
      `block=${blockNumber} signer=${wallet.address} balanceWei=${balance.toString()}`,
    );

    log(`init PrimusNetwork (chainId=${CHAIN_ID}, backend=wasm)`);
    const primus = await getInitializedPrimus(wallet, Number(CHAIN_ID));

    log("submitTask on Base Sepolia");
    const submitResult = (await primus.submitTask(attestParams)) as Record<
      string,
      unknown
    >;
    log(`submitTask done: ${JSON.stringify(safeJson(submitResult))}`);

    log(`attest with ${responseResolves.length} resolve(s) over 1 request`);
    const attestResult = await primus.attest(
      {
        ...attestParams,
        ...submitResult,
        requests: [request],
        responseResolves: [responseResolves],
        sslCipher: "ECDHE-RSA-AES128-GCM-SHA256",
        attMode: { algorithmType: "proxytls", resultType: "plain" },
        noProxy: false,
        getAllJsonResponse: "true",
      } as unknown as Parameters<typeof primus.attest>[0],
      5 * 60 * 1000,
    );
    if (!attestResult?.[0]?.attestation) {
      throw new Error("attest returned no attestation");
    }
    log("attest done");

    const taskId = attestResult[0].taskId;
    const reportTxHash = attestResult[0].reportTxHash;
    log(
      `verifyAndPollTaskResult taskId=${taskId} reportTxHash=${reportTxHash}`,
    );
    const taskResult = await primus.verifyAndPollTaskResult({
      taskId,
      reportTxHash,
    });
    log("verifyAndPollTaskResult done");

    // The attestor signs sha256(extracted_outer_html); the plain extracted
    // text is the private input the Noir circuit hashes back. Pull it via
    // getPlainResponse so the client can persist (content, signed_hash)
    // pairs alongside the attestation.
    const privateData = responseResolves.map((rr) => {
      const content = primus.getPlainResponse(taskId, 0, rr.parsePath);
      if (content == null)
        throw new Error(`getPlainResponse missing for ${rr.keyName}`);
      return { id: rr.keyName, content };
    });

    return NextResponse.json({
      ok: true,
      attestation: safeJson(attestResult),
      taskResult: safeJson(taskResult),
      taskId,
      privateData,
      verificationType: responseResolves.map(() => "SHA256_HASH"),
      log: trace,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    const stack = e instanceof Error ? e.stack : undefined;
    log(`error: ${msg}`);
    console.error("[/api/primus/attest] failure:", e);
    return NextResponse.json(
      { ok: false, error: msg, stack, log: trace },
      { status: 500 },
    );
  }
}
