export function normalizePastedKey(value) {
  return value.replace(/\x1b\[(?:200|201)~/g,'').trim();
}

export function isPlausibleMetaKey(value) {
  return value.startsWith('LLM_') && !value.includes('...') && !value.includes('…');
}
