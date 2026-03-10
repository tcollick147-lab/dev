export function toNum(text: string, fallback: number) {
  const cleaned = String(text ?? "").replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}
