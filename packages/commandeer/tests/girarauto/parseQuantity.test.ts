import { test, expect, describe } from "bun:test";
import { parseQuantity } from "../../commands/all/girarauto.cards";

describe("girarauto's parseQuantity", () => {
  test("a plain positive integer parses as itself", () => {
    expect(parseQuantity('5', 20)).toBe(5);
  });

  test.each(['*', 'all', 'tudo', 'ALL', 'Tudo', '*'])("%s means \"every remaining draw\"", (token) => {
    expect(parseQuantity(token, 12)).toBe(12);
  });

  test("undefined (no argument given) is invalid", () => {
    expect(parseQuantity(undefined, 20)).toBeNull();
  });

  test("zero is invalid - there's nothing to spend", () => {
    expect(parseQuantity('0', 20)).toBeNull();
  });

  test("a negative number is invalid", () => {
    expect(parseQuantity('-5', 20)).toBeNull();
  });

  test("garbage input is invalid", () => {
    expect(parseQuantity('abc', 20)).toBeNull();
  });

  test("a quantity larger than what's remaining still parses - clamping is the caller's job, not parseQuantity's", () => {
    expect(parseQuantity('999', 5)).toBe(999);
  });

  test("'all' with zero remaining draws returns 0, not null - the caller is expected to have already bailed on remaining <= 0 before parsing", () => {
    expect(parseQuantity('all', 0)).toBe(0);
  });
});
