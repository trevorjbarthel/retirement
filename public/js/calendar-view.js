// ===== calendar-view.js =====
// The month-by-month transition calendar: single-page rendering, navigation, the print
// export that lays out every month, and the narrow-viewport prose summary.

import {
  daysBetween, firstOfNextMonth
} from '/js/calc.js';
import { $, fmtDateShort, escapeHtml, afterRender } from '/js/dom.js';

// ===== TIMELINE CALENDAR (single month, paginated) =====
export let calCtx = null; // { today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart, rangeStart, rangeEnd }
export let calView = null; // { year, month } of the month currently on screen

export function renderTimelineCalendar(today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart) {
  let rangeStart = new Date(s.sb ? (sbStart < today ? sbStart : today) : today);
  rangeStart.setDate(1);
  // firstOfNextMonth, not setMonth(+1). setMonth overflows on a month-end separation
  // (Jan 31 + 1 month = Mar 3), which appended a phantom empty month to the calendar view
  // and to the printed plan.
  const rangeEnd = firstOfNextMonth(sep);

  calCtx = { today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart, rangeStart, rangeEnd };

  // Keep the visitor's current page across live edits (e.g. adjusting leave days)
  // as long as it's still in range; otherwise default back to today's month.
  const viewDate = calView ? new Date(calView.year, calView.month, 1) : null;
  const inRange = viewDate && viewDate >= rangeStart && viewDate <= rangeEnd;
  if (!inRange) calView = { year: rangeStart.getFullYear(), month: rangeStart.getMonth() };

  renderCalendarPage();
}

export function renderCalendarPage() {
  const container = $('calendarMonthsContainer');
  if (!container || !calCtx || !calView) return;
  const { today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart, rangeStart, rangeEnd } = calCtx;

  container.innerHTML = renderCalMonth(calView.year, calView.month, today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart);

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const label = $('calMonthLabel');
  if (label) label.textContent = `${monthNames[calView.month]} ${calView.year}`;

  const viewDate = new Date(calView.year, calView.month, 1);
  const prevBtn = $('calPrevBtn'), nextBtn = $('calNextBtn');
  if (prevBtn) prevBtn.disabled = viewDate <= rangeStart;
  if (nextBtn) nextBtn.disabled = viewDate >= rangeEnd;

  afterRender();
}

export function calNavigate(delta) {
  if (!calView) return;
  const d = new Date(calView.year, calView.month + delta, 1);
  calView = { year: d.getFullYear(), month: d.getMonth() };
  renderCalendarPage();
}

export function calJumpToToday() {
  if (!calCtx) return;
  const { today, rangeStart, rangeEnd } = calCtx;
  let d = new Date(today.getFullYear(), today.getMonth(), 1);
  if (d < rangeStart) d = new Date(rangeStart);
  if (d > rangeEnd) d = new Date(rangeEnd);
  calView = { year: d.getFullYear(), month: d.getMonth() };
  renderCalendarPage();
}

// Printing needs every month in range, not just the one page currently on screen —
// call this before window.print() and call renderCalendarPage() again afterward to
// restore the single-month view (see the printBtn handler).
export function printAllCalendarMonths() {
  const container = $('calendarMonthsContainer');
  if (!container || !calCtx) return;
  const { today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart, rangeStart, rangeEnd } = calCtx;
  let html = '';
  let current = new Date(rangeStart);
  let guard = 0;
  while (current <= rangeEnd && guard < 36) {
    html += renderCalMonth(current.getFullYear(), current.getMonth(), today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart);
    current.setMonth(current.getMonth() + 1);
    guard++;
  }
  container.innerHTML = html;
  afterRender();
}

export function renderCalMonth(year, month, today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart) {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const start = new Date(firstDay);
  start.setDate(start.getDate() - firstDay.getDay());

  // A real <table> with a <caption> and scoped column headers. This was a bare grid of
  // <div>s: a screen reader got a flat run of numbers with no row/column relationship and
  // no month context, and the "SB"/"PTDY" chips were unexpanded abbreviations found
  // nowhere in the DOM. Each chip now carries an sr-only expansion.
  const spanLabel = s.transType === 'Retirement' ? 'Retirement date' : 'Separation date';
  // The heading lives OUTSIDE the table so it survives the narrow-viewport rule that hides
  // the grid; the table's own caption is sr-only to avoid announcing the month twice.
  let html = `<div class="cal-month-card">`
    + `<h3 class="text-base font-bold text-navy-700 mb-3">${monthNames[month]} ${year}</h3>`
    + `<table class="cal-grid-table"><caption class="sr-only">${monthNames[month]} ${year} — transition calendar</caption>`
    + '<thead><tr>'
    + dow.map(d => `<th scope="col" class="cal-dow"><abbr title="${d}day">${d}</abbr></th>`).join('')
    + '</tr></thead><tbody><tr>';

  let current = new Date(start);
  let col = 0;
  while (current <= lastDay || current.getDay() !== 0) {
    if (col === 7) { html += '</tr><tr>'; col = 0; }
    const isOther = current.getMonth() !== month;
    const isToday = daysBetween(today, current) === 0;
    let events = '';

    if (!isOther) {
      const chip = (bg, short, long) =>
        `<span class="cal-event" data-css-bg="${bg}">${short}<span class="sr-only"> — ${long}</span></span>`;
      if (s.sb && daysBetween(sbStart, current) >= 0 && daysBetween(current, sbEnd) >= 0) events += chip('#3468b0', 'SB', 'SkillBridge');
      if (s.ptdy && daysBetween(ptdyStart, current) >= 0 && daysBetween(current, ptdyEnd) >= 0) events += chip('#836616', 'PTDY', 'Permissive TDY');
      if (daysBetween(termStart, current) >= 0 && daysBetween(current, sep) >= 0) events += chip('#2d6a4f', 'Leave', 'Terminal leave');
      if (daysBetween(sep, current) === 0) events += chip('#b91c1c', escapeHtml(s.transType === 'Retirement' ? 'RET' : 'SEP'), escapeHtml(spanLabel));
    }

    html += `<td class="cal-day${isOther ? ' other-month' : ''}${isToday ? ' is-today' : ''}"${isOther ? ' aria-hidden="true"' : ''}>`
      + `<span class="cal-day-num">${current.getDate()}</span>${isToday ? '<span class="sr-only"> (today)</span>' : ''}${events}</td>`;
    current.setDate(current.getDate() + 1);
    col++;
  }
  while (col < 7 && col > 0) { html += '<td class="cal-day other-month" aria-hidden="true"></td>'; col++; }

  html += '</tr></tbody></table>';
  // Below ~400px the 7-column grid renders day text at ~7px, which is not usable. Give
  // narrow viewports a plain-language summary of the same spans instead of a wall of dots.
  html += `<p class="cal-narrow-summary text-xs text-navy-500 leading-relaxed mt-2">${escapeHtml(calMonthSummary(year, month, today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart))}</p>`;
  html += '</div>';
  return html;
}

// Plain-language description of what happens in a given month. Used as the narrow-viewport
// fallback and as the calendar's accessible summary.
export function calMonthSummary(year, month, today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const overlaps = (a, b) => a <= last && b >= first;
  const fmtRange = (a, b) => {
    const from = a < first ? first : a;
    const to = b > last ? last : b;
    return from.getDate() === to.getDate() ? `${fmtDateShort(from)}` : `${fmtDateShort(from)}–${fmtDateShort(to)}`;
  };
  const parts = [];
  if (s.sb && overlaps(sbStart, sbEnd)) parts.push(`SkillBridge ${fmtRange(sbStart, sbEnd)}`);
  if (s.ptdy && overlaps(ptdyStart, ptdyEnd)) parts.push(`Permissive TDY ${fmtRange(ptdyStart, ptdyEnd)}`);
  if (overlaps(termStart, sep)) parts.push(`Terminal leave ${fmtRange(termStart, sep)}`);
  if (sep >= first && sep <= last) parts.push(`${s.transType} date ${fmtDateShort(sep)}`);
  return parts.length ? parts.join(' · ') : 'Nothing scheduled this month.';
}

export function wireCalendar() {
  $('calPrevBtn').addEventListener('click', () => calNavigate(-1));
  $('calNextBtn').addEventListener('click', () => calNavigate(1));
  $('calTodayBtn').addEventListener('click', () => calJumpToToday());

}
