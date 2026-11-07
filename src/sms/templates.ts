/**
 * SMS copy. Plain ASCII on purpose ("N" not the naira sign): GSM-7 keeps a message at 160 chars/segment, and many
 * feature phones cannot render the naira sign. English and Nigerian Pidgin are written; Yoruba, Hausa and Igbo
 * fall back to English until the copy is translated.
 */
export type Lang = 'en' | 'pidgin' | 'yoruba' | 'hausa' | 'igbo';

type Copy<V> = { en: (v: V) => string; pidgin?: (v: V) => string };
function pick<V>(lang: string, copy: Copy<V>): (v: V) => string {
  return (lang === 'pidgin' && copy.pidgin) || copy.en;
}

export interface ReceiptVars {
  takings: string;
  rate: string;
  sweep: string;
  emergency: string;
  retirement: string;
  reference: string;
}

export const sweepReceipt = (lang: string, v: ReceiptVars): string =>
  pick<ReceiptVars>(lang, {
    en: (x) =>
      `Kobo Kobo: Today sales ${x.takings}. Sweep ${x.rate}% (${x.sweep}) sent to Access ARM Pension. Emergency Pot: +${x.emergency}. Retirement Pot: +${x.retirement}. Ref: ${x.reference}. Text PAUSE to pause.`,
    pidgin: (x) =>
      `Kobo Kobo: Today sales na ${x.takings}. We don save ${x.rate}% (${x.sweep}) for Access ARM Pension. Emergency Pot: +${x.emergency}. Retirement Pot: +${x.retirement}. Ref: ${x.reference}. Text PAUSE make we rest.`,
  })(v);

export const bufferSkipped = (lang: string, v: { buffer: string }): string =>
  pick<{ buffer: string }>(lang, {
    en: (x) => `Kobo Kobo: We skipped tonight's pension sweep so your account keeps at least ${x.buffer}. Your savings are safe.`,
    pidgin: (x) => `Kobo Kobo: We no take pension money tonight so your account go still get ${x.buffer}. Your savings dey safe.`,
  })(v);

export const guardHeld = (lang: string): string =>
  pick<Record<string, never>>(lang, {
    en: () => `Kobo Kobo: Tonight's pension sweep is on hold while we check a large payment. No money was moved.`,
    pidgin: () => `Kobo Kobo: We hold tonight pension sweep to check one big payment. No money comot.`,
  })({});

export const withdrawalConfirmed = (lang: string, v: { amount: string; account: string }): string =>
  pick<{ amount: string; account: string }>(lang, {
    en: (x) => `Kobo Kobo: ${x.amount} from your Emergency Pot is on its way to your Access account ${x.account}.`,
    pidgin: (x) => `Kobo Kobo: ${x.amount} from your Emergency Pot dey come to your Access account ${x.account}.`,
  })(v);
