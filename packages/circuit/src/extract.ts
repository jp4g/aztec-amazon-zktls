// Port of the browser-side plaintext extractor from
// packages/frontend/components/AttestPurchaseBrowser.tsx. Primus' attestor
// hashes the raw byte slice of the matched HTML node (libxml2 preserves
// source bytes like `&quot;` and `\r\n`). DOMParser/outerHTML re-serializes
// those, so we parse with DOMParser to locate the node, then pull the raw
// substring from the original HTML body by open-tag fingerprint + tag-
// balanced scan.
//
// Used only by the test harness as a plaintext fallback when the
// attestation fixture doesn't include our `_plaintexts` sidecar.

export interface FieldSpec {
  key: string;
  xpath: string;
}

// Same XPaths as the browser component; trailing `?` (WASM dispatch marker)
// stripped — we're just querying with `document.evaluate`.
export const FIELD_PATHS: readonly FieldSpec[] = [
  {
    key: "shipmentStatus",
    xpath: '//*[@id="shipment-top-row"]/div[1]/div[1]/h4[1]',
  },
  {
    key: "productTitle",
    xpath:
      '//*[@id="orderDetails"]/div[1]/div[3]/div[1]/div[1]/div[7]/div[1]/div[1]/div[1]/div[1]/div[1]/div[1]/div[1]/div[1]/div[2]/div[1]/div[1]/div[1]/div[2]/div[1]/div[1]/div[1]/a[1]',
  },
  {
    key: "shipTo",
    xpath:
      '//*[@id="orderDetails"]/div[1]/div[3]/div[1]/div[1]/div[6]/div[1]/div[1]/div[1]/div[1]/div[1]/div[1]/div[1]/div[1]/div[1]/ul[1]',
  },
  {
    key: "grandTotal",
    xpath:
      '//*[@id="od-subtotals"]/div[1]/div[1]/ul[1]/li[6]/span[1]/div[1]/div[2]/span[1]',
  },
];

function rawElementSlice(body: string, start: number, tagName: string): string | null {
  const openTagEnd = body.indexOf(">", start);
  if (openTagEnd === -1) return null;
  const tag = tagName.toLowerCase();
  const openRe = new RegExp(`<${tag}(?=[\\s>/])`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 1;
  let pos = openTagEnd + 1;
  while (depth > 0) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const om = openRe.exec(body);
    const cm = closeRe.exec(body);
    if (!cm) return null;
    if (om && om.index < cm.index) {
      depth++;
      pos = om.index + om[0].length;
    } else {
      depth--;
      pos = cm.index + cm[0].length;
      if (depth === 0) return body.substring(start, pos);
    }
  }
  return null;
}

function normalizedTextContent(html: string): string {
  return (
    new DOMParser()
      .parseFromString(`<x>${html}</x>`, "text/html")
      .documentElement.textContent?.trim() ?? ""
  );
}

export function extractByXPath(html: string, xpath: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const node = doc.evaluate(
    xpath,
    doc,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  ).singleNodeValue as Element | null;
  if (!node) return null;

  const serialized = node.outerHTML;
  const openTagEnd = serialized.indexOf(">");
  const openTag =
    openTagEnd === -1 ? serialized : serialized.substring(0, openTagEnd + 1);
  const targetText = (node.textContent ?? "").trim();

  // Open-tag fingerprint may not be unique (e.g. grandTotal label + value
  // share the same <span class="...">). Enumerate all occurrences, raw-slice
  // each, pick the one whose textContent matches.
  let from = 0;
  let firstSlice: string | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const idx = html.indexOf(openTag, from);
    if (idx === -1) break;
    const slice = rawElementSlice(html, idx, node.tagName);
    if (slice) {
      if (!firstSlice) firstSlice = slice;
      if (normalizedTextContent(slice) === targetText) return slice;
    }
    from = idx + openTag.length;
  }
  return firstSlice;
}

// Returns { keyName: rawOuterHTML } for every FIELD_PATHS entry found in the
// given HTML body.
export function extractAll(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FIELD_PATHS) {
    const v = extractByXPath(html, f.xpath);
    if (v !== null) out[f.key] = v;
  }
  return out;
}
