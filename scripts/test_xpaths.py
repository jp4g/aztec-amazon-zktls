"""Smoke-test XPaths against example-order.html.

The Primus attestor parser (per the SDK's own html.test.ts and the runtime
error `[ParseHtmlError][Find] can not find attribute by class,"od-status-..."`)
is a restricted XPath dialect that supports ONLY:

  * step navigation: `//tag`, `tag/child`
  * positional indices: `[N]`
  * exact attribute equality: `[@name="value"]`
  * the `@attr` axis to return an attribute value as a string

It does NOT support: `contains()`, `starts-with()`, `text()`,
`normalize-space()`, `substring*`, or any function inside or outside a
predicate. Plan accordingly.

We compensate by leaning on Amazon's per-element `data-component` markers
(itemTitle, shippingAddress, shipmentStatus) which are stable, unique-per-item
anchors that don't need text-matching predicates.
"""
import lxml.html
from pathlib import Path


def extract(node) -> str:
    """Mirror what Primus' attestor returns:
    - For an element node: the serialized outer-HTML, with attributes,
      preserving the source whitespace inside but no trailing siblings.
    - For an attribute (string): the attribute value.
    """
    if isinstance(node, str):
        return node
    if hasattr(node, "tag"):
        from lxml import etree
        return etree.tostring(
            node, method="html", encoding="unicode", with_tail=False
        )
    return str(node)


doc = lxml.html.parse(str(Path(__file__).parent.parent / "example-order.html"))

# Mirror exactly the route's parsePath strings. The Primus parser dialect
# only accepts: `//*[@id="X"]/tag[N]/tag[N]/...` — id-anchored wildcard
# descendant, then pure child-axis with every step indexed [N]. No
# data-component/class predicates, no descendant `//` mid-path, no functions.
XPATHS = {
    "shipmentStatus": '//*[@id="shipment-top-row"]/div[1]/div[1]/h4[1]',
    "productTitle": (
        '//*[@id="orderDetails"]'
        '/div[1]/div[3]/div[1]/div[1]/div[7]/div[1]/div[1]/div[1]/div[1]'
        '/div[1]/div[1]/div[1]/div[1]/div[2]/div[1]/div[1]/div[1]/div[2]'
        '/div[1]/div[1]/div[1]/a[1]'
    ),
    "shipTo": (
        '//*[@id="orderDetails"]'
        '/div[1]/div[3]/div[1]/div[1]/div[6]/div[1]/div[1]/div[1]/div[1]'
        '/div[1]/div[1]/div[1]/div[1]/div[1]/ul[1]'
    ),
    # Grand total value span. li[6] is position-dependent on the fee row count.
    "grandTotal": (
        '//*[@id="od-subtotals"]'
        '/div[1]/div[1]/ul[1]/li[6]/span[1]/div[1]/div[2]/span[1]'
    ),
}

ok = True
for key, xp in XPATHS.items():
    print(f"[{key}]")
    print(f"  xpath:    {xp}")
    try:
        result = doc.xpath(xp)
    except Exception as e:
        print(f"  ERROR:    {e}\n")
        ok = False
        continue

    if isinstance(result, list):
        if not result:
            print("  matched:  0 nodes  (XPath returned empty list)\n")
            ok = False
            continue
        first = result[0]
        text = extract(first)
        printed = " ".join(text.split())
        print(f"  matched:  {len(result)} node(s); showing [0]")
        print(f"  raw_len:  {len(text)}")
        print(f"  text:     {printed!r}")
    else:
        print(f"  scalar:   {result!r}")
    print()

print("PASS" if ok else "FAIL")
