import { h, modal } from '../util.js';
import * as store from '../store.js';
import * as ai from '../ai.js';
import { allExercises, MUSCLES, exerciseOr } from '../data/exercises.js';
import { suggest, exerciseRecords, muscleSets, weekStart, addDays, sessionSummary, dayKey, crowdGrid, quietTimes, busyTimes, fmtDayHour } from '../metrics.js';
import { targetText } from './common.js';
import { todayPlan } from './today.js';

/** Conversation survives closing the sheet, cleared when a workout ends. */
let history = [];
let historyFor = null;
/** The message from the last failed send, cleared at the start of the next one. */
let lastError = null;

function context(extra = {}) {
  const st = store.getState();
  const bw = st.profile.bodyweight;
  const a = st.active;
  const wk = weekStart(Date.now());
  const ms = muscleSets(st.sessions, wk, addDays(wk, 7));
  const about = extra.about ? exerciseOr(extra.about) : null;
  const tp = !a ? todayPlan(st) : null;
  const gid = store.currentGym();
  const g = gid && store.gym(gid);
  return {
    profile: { bodyweightLb: bw, age: st.profile.age },
    gym: g ? { name: g.name, chain: g.chain || undefined, missingHere: store.missingAt(gid) } : null,
    gymBusyTimes: busyTimesFor(st.sessions, gid),
    plan: st.prefs.mode === '3day' ? '3-day full body' : '4-day upper/lower (Mon Upper A, Tue Lower A, Thu Upper B, Fri Lower B)',
    askingAbout: about ? { id: about.id, name: about.name, setup: about.setup, cues: about.cues, alternatives: about.alts.map((x) => exerciseOr(x).name), myNotes: store.machineNote(about.id), records: exerciseRecords(st.sessions, about.id, bw) } : undefined,
    workoutInProgress: a
      ? {
          plan: a.name,
          minutesIn: Math.round((Date.now() - a.startedAt) / 60000),
          current: a.entries[a.current] ? exerciseOr(a.entries[a.current].ex).name : undefined,
          exercises: a.entries.map((e) => ({
            name: exerciseOr(e.ex).name,
            target: targetText(e.target, exerciseOr(e.ex)),
            logged: e.sets,
            suggestion: suggest(e.ex, e.target, st.sessions, bw)?.reason,
            swappedFrom: e.plannedEx !== e.ex ? exerciseOr(e.plannedEx).name : undefined,
          })),
        }
      : null,
    nextPlanned: tp ? { name: store.getPlan(tp.planId)?.name, when: tp.label, restDay: tp.rest, doneThisWeek: tp.weekDone, weeklyTarget: tp.weekTarget } : undefined,
    thisWeekSetsPerMuscle: Object.fromEntries(Object.entries(ms.sets).filter(([, v]) => v > 0).map(([k, v]) => [MUSCLES[k], v])),
    recentWorkouts: st.sessions.slice(-6).map((s) => ({ date: dayKey(s.startedAt), plan: s.name, ...pick(sessionSummary(s, bw)), notes: s.notes || undefined })),
    library: allExercises().map((e) => ({ id: e.id, name: e.name, primary: e.muscles.primary, alts: e.alts })),
  };
}

function pick(sum) {
  return { minutes: Math.round(sum.durationMin), sets: sum.workSets, pounds: sum.tonnage };
}

export function openCoach(ctx, extra = {}) {
  const key = store.active()?.id ?? 'idle';
  if (historyFor !== key) {
    history = [];
    historyFor = key;
    lastError = null;
  }
  const log = h('div', { class: 'chat' });
  const draw = () => {
    log.replaceChildren(
      ...(history.length
        ? history.map((m) => h('div', { class: `chat__msg chat__msg--${m.role}` }, m.content))
        : [h('p', { class: 'muted small' }, 'Ask anything: "leg press is taken, what now?", "is my seat right if I feel it in my shoulders?", "how heavy should I go on lat pulldown?"')]),
      ...(lastError ? [h('p', { class: 'chat__error', role: 'alert' }, lastError)] : []),
    );
    log.scrollTop = log.scrollHeight;
  };
  const input = h('textarea', { class: 'input', rows: 2, placeholder: extra.about ? `About ${exerciseOr(extra.about).name}…` : 'Ask the coach…' });
  const send = h('button', { class: 'btn btn--primary', type: 'button' }, 'Send');
  const go = async () => {
    const text = input.value.trim();
    if (!text) return;
    lastError = null;
    input.value = '';
    history.push({ role: 'user', content: text });
    draw();
    send.disabled = true;
    const thinking = h('div', { class: 'chat__msg chat__msg--assistant is-thinking' }, '…');
    log.append(thinking);
    try {
      const reply = await ai.coach(history, context(extra));
      history.push({ role: 'assistant', content: reply });
    } catch (err) {
      history.pop();
      input.value = text;
      lastError = err.message;
    } finally {
      send.disabled = false;
      draw();
    }
  };
  send.addEventListener('click', go);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      go();
    }
  });
  draw();
  modal('Coach', h('div', { class: 'stack' }, log, h('div', { class: 'chat__compose' }, input, send), h('p', { class: 'muted small' }, 'Not medical advice. Stop anything that hurts.')), { wide: true });
  setTimeout(() => input.focus(), 50);
}

/** Labels only, e.g. { quietest: ['Sat 9 am'], busiest: ['Mon 6 pm'] }, or undefined without data. */
function busyTimesFor(sessions, gid) {
  const grid = crowdGrid(sessions, gid);
  if (grid.totalRated < 3) return undefined;
  const label = (c) => fmtDayHour(c.day, c.hour);
  const quietest = quietTimes(grid).map(label);
  const busiest = busyTimes(grid).map(label);
  return quietest.length || busiest.length ? { quietest, busiest } : undefined;
}
