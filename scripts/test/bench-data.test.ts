import { describe, expect, it } from "vitest";
import { DATASETS, parseCsv, splitOf } from "../bench-data";

describe("benchmark data handling", () => {
  it("parses quoted CSV fields with commas, quotes and newlines", () => {
    const rows = parseCsv('a,b\n"x, y","say ""hi""\nthere"\r\n1,2\n');
    expect(rows).toEqual([
      { a: "x, y", b: 'say "hi"\nthere' },
      { a: "1", b: "2" },
    ]);
  });

  it("splits by group, deterministically, so near-copies stay on one side", () => {
    const a = { dataset: "d", text: "one", label: 1 as const, source: "user" as const, group: "community:7" };
    const b = { ...a, text: "one, slightly reworded" };
    expect(splitOf(a)).toBe(splitOf(b));
    const groups = Array.from({ length: 2000 }, (_, i) => splitOf({ ...a, group: `g${i}` }));
    const test = groups.filter((s) => s === "test").length;
    expect(test).toBeGreaterThan(900);
    expect(test).toBeLessThan(1100);
  });

  it("pins every file to a commit and a checksum", () => {
    for (const d of DATASETS)
      for (const f of Object.values(d.files)) {
        expect(f.url).toMatch(/\/[0-9a-f]{40}\//);
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
  });
});
