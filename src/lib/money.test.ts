import { describe, expect, it } from "vitest";
import { decimalToCents, detectCurrency, parseAmount } from "./money";

describe("parseAmount", () => {
  it.each([
    ["12.345,67", 1234567],
    ["$ 12.345,67", 1234567],
    ["1.234", 123400],
    ["1.234.567", 123456700],
    ["12,345.67", 1234567],
    ["10.50", 1050],
    ["0,99", 99],
    ["1500", 150000],
    ["1500,5", 150050],
    ["-2.500,00", -250000],
  ])("%s → %i centavos", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it("devuelve null si no hay número", () => {
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("detectCurrency", () => {
  it.each([
    ["U$S 10,00", "USD"],
    ["USD 5", "USD"],
    ["US$ 5", "USD"],
    ["$ 100", "ARS"],
    ["ARS 100", "ARS"],
    ["Importe en dólares", "USD"],
  ])("%s → %s", (input, expected) => {
    expect(detectCurrency(input)).toBe(expected);
  });
});

it("decimalToCents", () => {
  expect(decimalToCents("1234.56")).toBe(123456);
  expect(decimalToCents("0.1")).toBe(10);
});
