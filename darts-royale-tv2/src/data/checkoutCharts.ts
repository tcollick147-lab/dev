// src/data/checkoutChart.ts

export type Bed =
  | `S${1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20}`
  | `D${1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20}`
  | `T${1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20}`
  | "SBULL"
  | "DBULL";

// Helper to keep the chart readable
const B = (b: string) => b as Bed;

/**
 * Double-Out checkout chart (Winmau Checkout Poster)
 *
 * Notes:
 * - "Bull" on the poster = 50 (DBULL)
 * - "25" on the poster = outer bull (SBULL)
 *
 * Consistency rule applied:
 * - If a 2-dart finish differs from the (2nd, 3rd) darts of a listed 3-dart finish
 *   that leaves the same remainder after the first dart, we prefer the 3-dart continuation
 *   (so mid-turn suggestions remain consistent).
 *
 * - 1-dart finishes are kept exactly as provided below (per your request).
 */
export const CHECKOUT_CHART: Record<number, Bed[]> = {
  // ---------------------
  // 3-dart finishes (Winmau)
  // ---------------------
  170: [B("T20"), B("T20"), B("DBULL")],
  169: [], // no out
  168: [], // no out
  167: [B("T20"), B("T19"), B("DBULL")],
  166: [], // no out
  165: [], // no out
  164: [B("T20"), B("T18"), B("DBULL")],
  163: [], // no out
  162: [], // no out
  161: [B("T20"), B("T17"), B("DBULL")],
  160: [B("T20"), B("T20"), B("D20")],

  158: [B("T20"), B("T20"), B("D19")],
  157: [B("T20"), B("T19"), B("D20")],
  156: [B("T20"), B("T20"), B("D18")],
  155: [B("T20"), B("T19"), B("D19")],
  154: [B("T20"), B("T18"), B("D20")],
  153: [B("T20"), B("T19"), B("D18")],
  152: [B("T20"), B("T20"), B("D16")],
  151: [B("T20"), B("T17"), B("D20")],
  150: [B("T20"), B("T18"), B("D18")],
  149: [B("T20"), B("T19"), B("D16")],
  148: [B("T20"), B("T20"), B("D14")],
  147: [B("T20"), B("T17"), B("D18")],
  146: [B("T20"), B("T18"), B("D16")],
  145: [B("T20"), B("T15"), B("D20")],
  144: [B("T20"), B("T20"), B("D12")],
  143: [B("T20"), B("T17"), B("D16")],
  142: [B("T20"), B("T14"), B("D20")],
  141: [B("T20"), B("T19"), B("D12")],
  140: [B("T20"), B("T20"), B("D10")],
  139: [B("T19"), B("T14"), B("D20")],
  138: [B("T20"), B("T18"), B("D12")],
  137: [B("T20"), B("T19"), B("D10")],
  136: [B("T20"), B("T20"), B("D8")],
  135: [B("SBULL"), B("T20"), B("DBULL")], // 25 + T20 + Bull
  134: [B("T20"), B("T14"), B("D16")],
  133: [B("T20"), B("T19"), B("D8")],
  132: [B("SBULL"), B("T19"), B("DBULL")], // 25 + T19 + Bull
  131: [B("T20"), B("T13"), B("D16")],
  130: [B("T20"), B("S20"), B("DBULL")], // T20 + 20 + Bull
  129: [B("S19"), B("T20"), B("DBULL")], // 19 + T20 + Bull
  128: [B("S18"), B("T20"), B("DBULL")], // 18 + T20 + Bull
  127: [B("T20"), B("S17"), B("DBULL")], // T20 + 17 + Bull
  126: [B("T19"), B("S19"), B("DBULL")], // T19 + 19 + Bull
  125: [B("SBULL"), B("T20"), B("D20")],  // 25 + T20 + D20
  124: [B("T20"), B("S14"), B("DBULL")], // T20 + 14 + Bull
  123: [B("T19"), B("S16"), B("DBULL")], // T19 + 16 + Bull
  122: [B("T18"), B("S18"), B("DBULL")], // T18 + 18 + Bull
  121: [B("T20"), B("S11"), B("DBULL")], // T20 + 11 + Bull
  120: [B("T20"), B("S20"), B("D20")],   // T20 + 20 + D20
  119: [B("T19"), B("S12"), B("DBULL")], // T19 + 12 + Bull
  118: [B("T20"), B("S18"), B("D20")],
  117: [B("T20"), B("S17"), B("D20")],
  116: [B("T20"), B("S16"), B("D20")],
  115: [B("T20"), B("S15"), B("D20")],
  114: [B("T20"), B("S14"), B("D20")],
  113: [B("T19"), B("S16"), B("D20")],
  112: [B("T20"), B("S20"), B("D16")],
  111: [B("T19"), B("S14"), B("D20")],
  110: [B("T20"), B("DBULL")], // 60 + 50 (highest 2-dart finish)
  109: [B("T20"), B("S17"), B("D16")],
  108: [B("T20"), B("S16"), B("D16")],
  107: [B("T19"), B("DBULL")], // 57 + 50
  106: [B("T20"), B("S6"),  B("D20")],
  105: [B("T20"), B("S13"), B("D16")],
  104: [B("T18"), B("DBULL")], // 54 + 50
  103: [B("T19"), B("S6"),  B("D20")],
  102: [B("T16"), B("S14"), B("D20")],
  101: [B("T17"), B("DBULL")], // 51 + 50
  99:  [B("T19"), B("S10"), B("D16")],

  // ---------------------
  // 2-dart finishes (Winmau) + consistency overrides
  // ---------------------
  
  
  100: [B("T20"), B("D20")],

  98: [B("T20"), B("D19")],
  97: [B("T19"), B("D20")],
  96: [B("T20"), B("D18")],
  95: [B("T19"), B("D19")],
  94: [B("T18"), B("D20")],
  93: [B("T19"), B("D18")],
  92: [B("T20"), B("D16")],
  91: [B("T17"), B("D20")],

  // ✅ override for consistency (from 150: T20, T18, D18 -> remainder 90 = T18, D18)
  90: [B("T18"), B("D18")],

  89: [B("T19"), B("D16")],
  88: [B("T20"), B("D14")],
  87: [B("T17"), B("D18")],
  86: [B("T18"), B("D16")],
  85: [B("T15"), B("D20")],
  84: [B("T20"), B("D12")],
  83: [B("T17"), B("D16")],

  // ✅ override for consistency (from 139/142: ... -> remainder 82 = T14, D20)
  82: [B("T14"), B("D20")],

  81: [B("T19"), B("D12")],
  80: [B("T20"), B("D10")],
  79: [B("T19"), B("D11")],
  78: [B("T18"), B("D12")],
  77: [B("T19"), B("D10")],
  76: [B("T20"), B("D8")],
  75: [B("T17"), B("D12")],
  74: [B("T14"), B("D16")],
  73: [B("T19"), B("D8")],
  72: [B("T16"), B("D12")],
  71: [B("T13"), B("D16")],

  // ✅ override for consistency (from 130: T20, 20, Bull -> remainder 70 = 20, Bull)
  70: [B("S20"), B("DBULL")],

  // ✅ override for consistency (from 126: T19, 19, Bull -> remainder 69 = 19, Bull)
  69: [B("S19"), B("DBULL")],

  // ✅ override for consistency (from 122: T18, 18, Bull -> remainder 68 = 18, Bull)
  68: [B("S18"), B("DBULL")],

  // ✅ override for consistency (from 127: T20, 17, Bull -> remainder 67 = 17, Bull)
  67: [B("S17"), B("DBULL")],

  // ✅ override for consistency (from 123: T19, 16, Bull -> remainder 66 = 16, Bull)
  66: [B("S16"), B("DBULL")],

  65: [B("T19"), B("D4")],
  64: [B("S14"), B("DBULL")], // override (from 124 -> remainder 64 = 14, Bull)
  63: [B("T13"), B("D12")],
  62: [B("S12"), B("DBULL")], // override (from 119 -> remainder 62 = 12, Bull)
  61: [B("S11"), B("DBULL")], // override (from 121 -> remainder 61 = 11, Bull)

  60: [B("S20"), B("D20")],
  59: [B("S19"), B("D20")],
  58: [B("S18"), B("D20")],
  57: [B("S17"), B("D20")],
  56: [B("S16"), B("D20")],
  55: [B("S15"), B("D20")],
  54: [B("S14"), B("D20")],
  53: [B("S13"), B("D20")],
  52: [B("S20"), B("D16")],
  51: [B("S19"), B("D16")],

  // (Poster lists 50 as "18 + D16", but you asked to keep 1-dart finishes unchanged,
  // so 50 is defined as DBULL below.)
  49: [B("S17"), B("D16")],
  48: [B("S16"), B("D16")],
  47: [B("S7"),  B("D20")],
  46: [B("S6"),  B("D20")],
  45: [B("S13"), B("D16")],
  44: [B("S4"),  B("D20")],
  43: [B("S3"),  B("D20")],
  42: [B("S10"), B("D16")],
  41: [B("S9"),  B("D16")],

  // ---------------------
  // 1-dart finishes (double out) — kept exactly (per your request)
  // ---------------------
  50: [B("DBULL")],

  40: [B("D20")],
  38: [B("D19")],
  36: [B("D18")],
  34: [B("D17")],
  32: [B("D16")],
  30: [B("D15")],
  28: [B("D14")],
  26: [B("D13")],
  24: [B("D12")],
  22: [B("D11")],
  20: [B("D10")],
  18: [B("D9")],
  16: [B("D8")],
  14: [B("D7")],
  12: [B("D6")],
  10: [B("D5")],
  8:  [B("D4")],
  6:  [B("D3")],
  4:  [B("D2")],
  2:  [B("D1")],
};
