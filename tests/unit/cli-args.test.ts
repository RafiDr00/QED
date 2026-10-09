import { describe, expect, it } from "vitest";

import {
  COMMANDS,
  parseFlags,
  parseInputs,
  parseTolerance,
  UsageError,
} from "../../packages/cli/src/args.js";

const check = (argv: string[]) => parseFlags(argv, COMMANDS.check, "check");

describe("flags are declared per command", () => {
  it("reads values, inline values and switches", () => {
    const flags = check(["--base", "main", "--inputs=50", "--no-color"]);
    expect(flags.named.get("base")).toBe("main");
    expect(flags.named.get("inputs")).toBe("50");
    expect(flags.switches.has("no-color")).toBe(true);
  });

  it("refuses a flag the command does not have, rather than ignoring it", () => {
    expect(() => check(["--tolerence", "float=1e-9"])).toThrow(UsageError);
    expect(() => check(["--tolerence", "float=1e-9"])).toThrow(/no flag --tolerence/);
  });

  it("refuses a flag that belongs to a different command", () => {
    expect(() => check(["--input", "[1]"])).toThrow(UsageError);
  });

  it("refuses a value flag with no value", () => {
    expect(() => check(["--base"])).toThrow(/needs a value/);
    expect(() => check(["--base="])).toThrow(/needs a value/);
  });

  it("refuses a value on a switch, and a flag given twice", () => {
    expect(() => check(["--no-color=yes"])).toThrow(/takes no value/);
    expect(() => check(["--base", "a", "--base", "b"])).toThrow(/twice/);
  });

  it("gives a value flag the next token even when it starts with a dash", () => {
    const flags = parseFlags(
      ["src/a.ts", "f", "--input", "[-1]"],
      COMMANDS.repro,
      "repro",
    );
    expect(flags.named.get("input")).toBe("[-1]");
    expect(flags.positional).toEqual(["src/a.ts", "f"]);
  });
});

describe("--inputs", () => {
  it("falls back when absent", () => {
    expect(parseInputs(undefined, 1000)).toBe(1000);
  });

  it("takes a whole number above zero", () => {
    expect(parseInputs("2000", 1000)).toBe(2000);
  });

  it.each(["0", "abc", "-5", "1.5", "1e3", "", "99999999999999999999"])(
    "refuses '%s'",
    (raw) => {
      expect(() => parseInputs(raw, 1000)).toThrow(UsageError);
    },
  );
});

describe("--tolerance", () => {
  it("is exact when absent", () => {
    expect(parseTolerance(undefined)).toBeUndefined();
  });

  it("reads an absolute epsilon", () => {
    expect(parseTolerance("float=1e-9")).toEqual({ floatEpsilon: 1e-9 });
  });

  it("reads a relative epsilon", () => {
    expect(parseTolerance("rel=1e-12")).toEqual({
      floatEpsilon: 0,
      relativeEpsilon: 1e-12,
    });
  });

  it("reads both", () => {
    expect(parseTolerance("float=1e-9, rel=1e-12")).toEqual({
      floatEpsilon: 1e-9,
      relativeEpsilon: 1e-12,
    });
  });

  it.each([
    "float",
    "float=",
    "float=abc",
    "float=0",
    "float=-1e-9",
    "float=Infinity",
    "abs=1e-9",
    "float=1e-9=2",
    "float=1e-9,float=1e-6",
  ])("refuses '%s'", (raw) => {
    expect(() => parseTolerance(raw)).toThrow(UsageError);
  });
});
