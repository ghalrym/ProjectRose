// rose-calendar — third built-in extension (after rose-contacts, rose-email).
//
// Calendar events live in agent Memory at
//   ~/.rose/memory/calendar/{yyyy}/{mm}/{dd}/{slug}.md
// alongside Diary, Behavior Records, and Contacts. See ADR 0012 for the
// "Event is a fourth Memory concept type" decision and the rationale behind
// keeping the recurring-event master + RRULE expansion model.

export { manifest } from './manifest'
export { CalendarPage as PageView } from './CalendarPage'
export { CalendarSettings as SettingsView } from './CalendarSettings'
