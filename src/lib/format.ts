export function moneyFormatter(currency: string, locale: string) {
  let f: Intl.NumberFormat;
  try {
    f = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 });
  } catch {
    f = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
  }
  return (n: number) => f.format(n);
}
