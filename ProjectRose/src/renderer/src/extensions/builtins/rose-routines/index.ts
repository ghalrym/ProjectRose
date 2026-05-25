// rose-routines — fourth built-in extension.
//
// Recurring prompts that fire the Agent on a calendar schedule. Workspace-
// scoped: routine definitions live at <workspace>/.projectrose/routines/
// {slug}.md, each fire's transcript is persisted under
// <workspace>/.projectrose/routines/{slug}/runs/{timestamp}.md. See ADR 0013
// for the boundary against Scheduled Task and Event, and ADR 0014 for the
// extension contract amendment this depends on.

export { manifest } from './manifest'
export { RoutinesPage as PageView } from './RoutinesPage'
