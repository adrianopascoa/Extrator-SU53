export const DEFAULT_CRITICAL_ITEMS: string[] = [
  // Valores / Transações críticas
  '/IRM/GPPM',
  'ZFI136N',
  'ZFI264',
  'ZFI453',
  'ZMM006',
  'ZMM313',
  'ZMM407_004N',
  'ME28',
  'ME29N',
  'ME35K',
  'ME35L',
  'ME54',
  'ME54N',
  'ME55',
  'ML85',
  'ZMM007',
  'ZMM343',
  'SM01',
  'RZ11',
  'XD02',
  'SE16',
  'SE16N',
  'SE80',
  // Objetos de autorização críticos
  'M_EINK_FRG',
  'S_DEVELOP',
  'S_DBG',
  'Z_USERSTAT',
  'Z_APROVFRE',
  'ZTR_NIVEL',
  'SNOTE_DISPLAY',
];

const CRITICAL_RULES_STORAGE_KEY = 'sap_su53_critical_rules_v1';

export function normalizeCriticalToken(token: string): string {
  return token.trim().toUpperCase();
}

export function parseCriticalTokensInput(rawInput: string): string[] {
  return rawInput
    .split(/[\s,;|\n\r]+/)
    .map((item) => normalizeCriticalToken(item))
    .filter((item) => item.length >= 2);
}

export function loadCriticalItems(): string[] {
  try {
    const raw = window.localStorage.getItem(CRITICAL_RULES_STORAGE_KEY);
    if (!raw) return [...DEFAULT_CRITICAL_ITEMS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_CRITICAL_ITEMS];
    const cleaned = Array.from(
      new Set(
        parsed
          .map((v) => (typeof v === 'string' ? normalizeCriticalToken(v) : ''))
          .filter(Boolean)
      )
    );
    return cleaned;
  } catch {
    return [...DEFAULT_CRITICAL_ITEMS];
  }
}

export function saveCriticalItems(items: string[]): string[] {
  const normalized = Array.from(
    new Set(items.map((v) => normalizeCriticalToken(v)).filter(Boolean))
  );
  try {
    window.localStorage.setItem(CRITICAL_RULES_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignora caso localStorage esteja indisponível
  }
  return normalized;
}
