import type { Scenario } from '../types';

export interface IncidentRow { t: number; text: string; by: 'auto' | 'officer' }

export interface IncidentSummary {
  rows: IncidentRow[];
  officerDecisions: number;
  automatedSteps: number;
  alertToIdentified: number | null;
}

export function summarizeIncident(scenario: Scenario, until: number): IncidentSummary {
  const events = scenario.events.filter((event) => event.t <= until).sort((a, b) => a.t - b.t);
  const rows: IncidentRow[] = [];

  const firstHear = events.find((event) => event.type === 'hear');
  if (firstHear?.type === 'hear') {
    const heardBy = events
      .filter((event) => event.type === 'hear' && event.t >= firstHear.t && event.t <= firstHear.t + 2)
      .map((event) => event.type === 'hear' ? event.hydrophone : '');
    rows.push({ t: firstHear.t, text: `Heard by ${heardBy.join(', ')}`, by: 'auto' });
  }

  let alertTime: number | null = null;
  for (const event of events) {
    if (event.type !== 'label') continue;
    const match = event.text.match(/score\s+([\d.]+)/i);
    if (match) {
      alertTime = event.t;
      rows.push({ t: event.t, text: `Alert raised · score ${match[1]}`, by: 'auto' });
      break;
    }
  }

  const locate = events.find((event) => event.type === 'phase' && event.phase === 'LOCATE');
  if (locate) rows.push({ t: locate.t, text: `Located from ${scenario.hydrophones.length} hydrophones`, by: 'auto' });

  for (const event of events) {
    if (event.type === 'action' && event.mode === 'auto') {
      rows.push({ t: event.t, text: event.text, by: 'auto' });
    } else if (event.type === 'scan') {
      rows.push({ t: event.t + event.dur, text: `Scan: ${event.result}`, by: 'auto' });
    } else if (event.type === 'action' && event.mode === 'approved') {
      rows.push({ t: event.t, text: event.text, by: 'officer' });
    }
  }

  const handoff = events.find((event) => event.type === 'phase' && event.phase === 'HANDOFF');
  if (handoff) rows.push({ t: handoff.t, text: 'Handed to officer', by: 'officer' });

  const reveal = events.find((event) => event.type === 'reveal');
  if (reveal?.type === 'reveal') {
    rows.push({ t: reveal.t, text: `Identified: ${reveal.text.split(' · ')[0]}`, by: 'auto' });
  }

  rows.sort((a, b) => a.t - b.t);
  return {
    rows,
    officerDecisions: events.filter((event) => event.type === 'action' && event.mode === 'approved').length,
    automatedSteps: rows.filter((row) => row.by === 'auto').length,
    alertToIdentified: reveal && alertTime !== null ? reveal.t - alertTime : null,
  };
}
