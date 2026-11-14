import { describe, expect, it } from "vitest";

import { withDateFnsImports } from "./sg-fix.mjs";

describe("withDateFnsImports", () => {
  it("adds the import after the last import when a helper is used without one", () => {
    const out = withDateFnsImports('import a from "a";\n\nconst x = hoursToMilliseconds(2);\n');
    expect(out).toContain('import { hoursToMilliseconds } from "date-fns";');
    expect(out.indexOf("date-fns")).toBeGreaterThan(out.indexOf('from "a"'));
  });

  it("merges into an existing date-fns import, sorted, without duplicates", () => {
    const out = withDateFnsImports(
      'import { minutesToMilliseconds } from "date-fns";\nconst x = differenceInMilliseconds(a, b) + minutesToMilliseconds(1);\n',
    );
    expect(out).toContain('import { differenceInMilliseconds, minutesToMilliseconds } from "date-fns";');
  });

  it("leaves a source that uses no helper untouched", () => {
    const src = 'import a from "a";\nconst x = 1;\n';
    expect(withDateFnsImports(src)).toBe(src);
  });
});
