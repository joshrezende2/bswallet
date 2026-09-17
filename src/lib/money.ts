export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Converte texto digitado ("1.234,56" ou "1234.56") em centavos. */
export function parseAmountToCents(input: string): number {
  if (!input) return 0;
  const clean = input
    .replace(/\s|R\$/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const value = Number(clean);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
