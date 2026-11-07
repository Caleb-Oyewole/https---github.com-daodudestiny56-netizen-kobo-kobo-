import { AppError } from '../errors';
import type { Deps } from '../deps';
import { nairaDisplay, parsePositiveNaira, rateDisplay, rateToHundredths } from '../money';
import { getPensionSummary } from '../pension/summary';
import { formatWatDay } from '../time';
import { maskNuban, requestEmergencyWithdrawal } from '../withdrawals/service';
import {
  emergencyStatus,
  findMerchantByPhone,
  isPausedNow,
  parseRate,
  pauseSweeps,
  resumeSweeps,
  setSweepRate,
  todaySummary,
  type ChannelMerchant,
} from './actions';

/**
 * USSD menu (`*384*5050#`) for Africa's Talking. AT sends the whole path so far in `text` ("5*1500*1"), so the
 * handler is stateless. Every reply is `CON ...` (menu continues) or `END ...` (session over) and fits one
 * 182-character USSD screen. `0` goes back one step, `99` returns to the main menu.
 */
const con = (...lines: string[]) => `CON ${lines.join('\n')}`;
const end = (...lines: string[]) => `END ${lines.join('\n')}`;

/** Apply back (0) and home (99) navigation to the raw path. */
export function resolvePath(text: string): string[] {
  const out: string[] = [];
  for (const part of text === '' ? [] : text.split('*')) {
    if (part === '0') out.pop();
    else if (part === '99') out.length = 0;
    else out.push(part.trim());
  }
  return out;
}

function mainMenu(m: ChannelMerchant): string {
  return con(
    'Welcome to Kobo Kobo',
    '1. Check Balance',
    "2. Today's Takings & Sweep",
    `3. Change Sweep Rate (Now: ${rateDisplay(rateToHundredths(m.sweep_percentage))}%)`,
    '4. Pause / Resume Sweeps',
    '5. Emergency Withdrawal',
    '6. Spoken Balance (Voice Call)',
  );
}

export async function handleUssd(deps: Deps, input: { phoneNumber: string; text: string }): Promise<string> {
  const merchant = await findMerchantByPhone(deps.db, input.phoneNumber);
  if (!merchant) return end('This number is not registered on Kobo Kobo. Sign up in the app to start saving.');

  const path = resolvePath(input.text ?? '');
  const [choice, ...rest] = path;
  if (choice === undefined) return mainMenu(merchant);

  try {
    switch (choice) {
      case '1':
        return await balanceScreen(deps, merchant);
      case '2':
        return await todayScreen(deps, merchant);
      case '3':
        return await rateFlow(deps, merchant, rest);
      case '4':
        return await pauseFlow(deps, merchant, rest);
      case '5':
        return await withdrawFlow(deps, merchant, rest);
      case '6':
        return await voiceRequest(deps, merchant);
      default:
        return end('Invalid choice. Dial again to start over.');
    }
  } catch (e) {
    if (e instanceof AppError && e.status < 500) return end(e.message);
    console.error('[ussd] unhandled error', e);
    return end('Sorry, something went wrong. Please try again shortly.');
  }
}

async function balanceScreen(deps: Deps, m: ChannelMerchant) {
  const s = await getPensionSummary(deps.db, m.id, deps.clock());
  return con(
    'Kobo Kobo Balance',
    `Total: ${nairaDisplay(s.total)}`,
    `Emergency: ${nairaDisplay(s.emergency)} (${s.eligibility.eligible ? 'Eligible' : emergencyStatus(s.eligibility)})`,
    `Retirement: ${nairaDisplay(s.retirement)} (Locked to 50)`,
    '0. Back',
  );
}

async function todayScreen(deps: Deps, m: ChannelMerchant) {
  const t = await todaySummary(deps, m);
  const rate = rateDisplay(rateToHundredths(m.sweep_percentage));
  if (t.record?.status === 'EXECUTED') {
    return end(`Tonight's sweep is done: ${nairaDisplay(t.record.sweepAmount)} saved.`, `Ref ${t.record.pensionReference}`);
  }
  const lines = [`Takings so far: ${nairaDisplay(t.takings)}`];
  if (isPausedNow(m, deps.clock())) {
    lines.push('Sweeps are paused: nothing will be taken tonight.');
  } else {
    lines.push(`Sweep tonight (${rate}%): ${nairaDisplay(t.projected)}`, 'Sweeps run at 11pm.');
  }
  return end(...lines);
}

async function rateFlow(deps: Deps, m: ChannelMerchant, rest: string[]) {
  if (rest.length === 0) {
    return con('Enter your new sweep rate, 1 to 5 (e.g. 2 or 2.5).', `Now: ${rateDisplay(rateToHundredths(m.sweep_percentage))}%`, '0. Back');
  }
  const h = parseRate(rest[rest.length - 1]);
  if (h === null) return end('Invalid rate. Use a number from 1 to 5. Dial again to retry.');
  await setSweepRate(deps.db, m.id, h);
  return end(`Done! Your sweep rate is now ${rateDisplay(h)}%.`, 'It applies from the next nightly sweep.');
}

async function pauseFlow(deps: Deps, m: ChannelMerchant, rest: string[]) {
  const paused = isPausedNow(m, deps.clock());
  if (rest.length === 0) {
    return paused
      ? con(`Sweeps are paused${m.paused_until ? ` until ${formatWatDay(m.paused_until)}` : ''}.`, '1. Resume now', '0. Back')
      : con('Sweeps are on.', '1. Pause for 48 hours', '0. Back');
  }
  if (rest[0] !== '1') return end('Invalid choice. Dial again to start over.');
  if (paused) {
    await resumeSweeps(deps.db, m.id);
    return end('Sweeps resumed. Your next sweep runs at 11pm.');
  }
  const until = await pauseSweeps(deps, m.id);
  return end(`Sweeps paused until ${formatWatDay(until)}.`, 'Dial again to resume sooner.');
}

async function withdrawFlow(deps: Deps, m: ChannelMerchant, rest: string[]) {
  const s = await getPensionSummary(deps.db, m.id, deps.clock());
  if (!s.eligibility.eligible) return end(`Emergency cashout unavailable: ${emergencyStatus(s.eligibility)}.`);

  if (rest.length === 0) {
    return con(`Emergency Pot: ${nairaDisplay(s.emergency)}`, 'Enter amount in naira to withdraw to your Access account:', '0. Back');
  }
  let amount;
  try {
    amount = parsePositiveNaira(rest[0].replace(/,/g, ''));
  } catch {
    return end('Invalid amount. Dial again and enter naira, e.g. 1500.');
  }
  if (amount > s.emergency) return end(`You only have ${nairaDisplay(s.emergency)} in your Emergency Pot.`);

  if (rest.length === 1) {
    return con(`Withdraw ${nairaDisplay(amount)} to Access ${maskNuban(m.access_nuban)}?`, '1. Yes', '2. No');
  }
  if (rest[1] !== '1') return end('Cancelled. No money was moved.');

  const w = await requestEmergencyWithdrawal(deps, { merchantId: m.id, amount });
  if (w.status === 'REJECTED') return end('The bank could not process this. Your money is safe in the Emergency Pot.');
  return end(`${nairaDisplay(amount)} is on its way to your Access account ${maskNuban(m.access_nuban)}.`);
}

async function voiceRequest(deps: Deps, m: ChannelMerchant) {
  await deps.db.query(
    `INSERT INTO voice_callback_requests (merchant_id, language)
     SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM voice_callback_requests WHERE merchant_id = $1 AND status = 'PENDING')`,
    [m.id, m.preferred_language],
  );
  return end('You will get a call shortly with your balance. Thank you for saving with Kobo Kobo.');
}
