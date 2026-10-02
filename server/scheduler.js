import { db } from './db.js';
import { getSettings } from './settings.js';
import {
  hydrate, createDocument, setRecurring, nextRecurringDate, logActivity,
} from './repos/documents.js';
import { sendDocument, canAutoSend, baseUrl } from './sender.js';
import { addDays, localToday } from '../public/js/shared/format.js';

const EVERY_MS = 10 * 60 * 1000;

async function runRecurring(settings, today) {
  const templates = db.prepare("SELECT * FROM documents WHERE recurring IS NOT NULL AND status <> 'void'").all().map(hydrate);
  for (const tpl of templates) {
    const rec = tpl.recurring;
    if (!rec?.enabled || !rec.next_date || rec.next_date > today) continue;
    if (rec.end_date && rec.next_date > rec.end_date) {
      setRecurring(tpl.id, { ...rec, enabled: false });
      continue;
    }
    const doc = createDocument({
      ...tpl,
      number: '',
      issue_date: today,
      due_date: addDays(today, settings.documents.defaultDueDays),
      recurring: null,
      parent_id: tpl.id,
    });
    const day = rec.day || Number(rec.next_date.slice(8, 10));
    setRecurring(tpl.id, { ...rec, day, next_date: nextRecurringDate(rec.next_date, rec.interval, day) });
    logActivity(tpl.id, 'recurring', `Created ${doc.number} from this recurring invoice`);
    if (rec.auto_send && canAutoSend(doc)) {
      try {
        await sendDocument(doc.id, {}, baseUrl());
      } catch (err) {
        logActivity(doc.id, 'error', `Automatic send failed: ${err.message}`);
      }
    }
  }
}

async function runReminders(settings, today) {
  if (!settings.automation.reminders) return;
  const days = [...settings.automation.reminderDays].sort((a, b) => a - b);
  if (!days.length) return;
  const due = db.prepare(`SELECT * FROM documents
    WHERE type = 'invoice' AND status IN ('sent', 'viewed') AND due_date IS NOT NULL AND due_date < ?
      AND total > amount_paid`).all(today).map(hydrate);
  for (const doc of due) {
    const step = doc.reminders_sent;
    if (step >= days.length || addDays(doc.due_date, days[step]) > today) continue;
    if (!canAutoSend(doc)) continue;
    try {
      await sendDocument(doc.id, { kind: 'reminder' }, baseUrl());
    } catch (err) {
      logActivity(doc.id, 'error', `Reminder failed: ${err.message}`);
    }
  }
}

let running = false;

export async function tick() {
  if (running) return;
  running = true;
  try {
    const settings = getSettings();
    const today = localToday();
    if (settings.automation.recurring) await runRecurring(settings, today);
    await runReminders(settings, today);
  } catch (err) {
    console.error('[scheduler]', err);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  setTimeout(tick, 5000);
  setInterval(tick, EVERY_MS).unref();
}
