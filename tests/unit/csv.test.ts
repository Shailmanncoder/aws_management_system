import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "@/server/security/csv";

describe("CSV export safety", () => {
  it.each(["=HYPERLINK(\"http://evil\")", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"])("neutralises formula injection: %s", (v) => {
    expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
  });
  it("quotes separators, quotes and newlines", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvRow(["x", null, 3])).toBe("x,,3\r\n");
  });
});
