'use strict';

/**
 * Starter content generated for every new wedding plan.
 * These are planning templates, not claims about the market.
 */

const CHECKLIST_TEMPLATE = [
  { phase: 'First decisions', title: 'Agree a guest count range', detail: 'Everything else follows this number. Agree a floor and a ceiling, not an exact figure.' },
  { phase: 'First decisions', title: 'Agree who is contributing and how much', detail: 'Have the money conversation early. It is easier now than after a deposit.' },
  { phase: 'First decisions', title: 'Decide one day or two', detail: 'If you are combining traditions, decide whether this is one long day or two events.' },
  { phase: 'First decisions', title: 'Set a total budget', detail: 'A working figure you can revise. Add it to the budget tab so the planner can do the arithmetic.' },
  { phase: 'Twelve months out', title: 'Shortlist and visit venues', detail: 'Ask about ceremony requirements, open flame, sound limits and corkage on the first visit.' },
  { phase: 'Twelve months out', title: 'Book the venue', detail: 'Read the supplier clause before you sign. Some venues restrict who you can bring in.' },
  { phase: 'Twelve months out', title: 'Book photography and video', detail: 'Good documentary teams book out first for peak Saturdays.' },
  { phase: 'Twelve months out', title: 'Confirm officiant or celebrant', detail: 'Religious ceremonies often have their own lead times and preparation requirements.' },
  { phase: 'Nine months out', title: 'Book decor and florals', detail: 'Bring photographs of the venue so quotes are realistic rather than aspirational.' },
  { phase: 'Nine months out', title: 'Send save the dates', detail: 'Only once the venue contract is signed.' },
  { phase: 'Nine months out', title: 'Start outfit shopping', detail: 'Allow time for two fittings, and more if anything is being made.' },
  { phase: 'Six months out', title: 'Book hair and makeup, and book trials', detail: 'Ask to see work on your skin tone and hair texture before you book.' },
  { phase: 'Six months out', title: 'Give notice at the register office', detail: 'In England and Wales this is usually at least 29 days before the ceremony.' },
  { phase: 'Six months out', title: 'Book music and entertainment', detail: 'Check the venue sound limiter before you sign a band.' },
  { phase: 'Three months out', title: 'Send invitations and open RSVPs', detail: 'Set the RSVP deadline six weeks before the day, not two.' },
  { phase: 'Three months out', title: 'Confirm the running order with every supplier', detail: 'In writing, in one thread, so nobody is working from a different version.' },
  { phase: 'Three months out', title: 'Plan transport and any accommodation blocks', detail: '' },
  { phase: 'One month out', title: 'Chase outstanding RSVPs', detail: 'Phone calls work. Emails do not.' },
  { phase: 'One month out', title: 'Give final numbers to the venue', detail: '' },
  { phase: 'One month out', title: 'Build the hour by hour timeline', detail: 'Use the timeline tab, then send it to everyone who is working on the day.' },
  { phase: 'One month out', title: 'Complete the seating plan', detail: '' },
  { phase: 'Final week', title: 'Confirm arrival times with every supplier', detail: '' },
  { phase: 'Final week', title: 'Hand the timeline and phone numbers to one trusted person', detail: 'Not to yourselves. You will be busy.' },
  { phase: 'Final week', title: 'Pack rings, documents and anything borrowed', detail: '' },
];

const BUDGET_TEMPLATE = [
  { category: 'Venue and catering', share: 0.4 },
  { category: 'Photography and video', share: 0.12 },
  { category: 'Decor and florals', share: 0.12 },
  { category: 'Outfits and jewellery', share: 0.11 },
  { category: 'Planning and coordination', share: 0.07 },
  { category: 'Music and entertainment', share: 0.07 },
  { category: 'Hair and makeup', share: 0.05 },
  { category: 'Stationery and favours', share: 0.03 },
  { category: 'Contingency', share: 0.03 },
];

const TIMELINE_TEMPLATE = [
  { at_time: '07:30', title: 'Hair and makeup begins', detail: 'Start with whoever needs the longest.', owner: 'Hair and makeup team' },
  { at_time: '10:00', title: 'Photographer arrives', detail: 'Preparation coverage and detail shots.', owner: 'Photographer' },
  { at_time: '11:30', title: 'Outfits on', detail: '', owner: '' },
  { at_time: '12:30', title: 'Guests arrive', detail: 'Ushers in place 30 minutes before this.', owner: 'Ushers' },
  { at_time: '13:00', title: 'Ceremony', detail: '', owner: 'Officiant' },
  { at_time: '14:00', title: 'Confetti and group photographs', detail: 'Give the photographer a written list of the groups you actually want.', owner: 'Photographer' },
  { at_time: '15:00', title: 'Drinks reception', detail: '', owner: 'Venue' },
  { at_time: '16:30', title: 'Guests seated', detail: '', owner: 'Venue' },
  { at_time: '17:00', title: 'Meal service', detail: '', owner: 'Catering' },
  { at_time: '19:00', title: 'Speeches', detail: 'Agree a hard limit per speaker in advance.', owner: '' },
  { at_time: '20:00', title: 'First dance and dancing', detail: '', owner: 'Band or DJ' },
  { at_time: '23:30', title: 'Last dance and send off', detail: '', owner: '' },
];

module.exports = { CHECKLIST_TEMPLATE, BUDGET_TEMPLATE, TIMELINE_TEMPLATE };
