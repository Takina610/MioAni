import type { Anime } from './anime'

export type ScheduleItem = {
  anime: Anime
  /** Local display time `HH:mm` when known. */
  airTime?: string
  timed: boolean
}

export type ScheduleDay = {
  /** JS weekday: 0=Sun … 6=Sat. */
  weekday: number
  label: string
  isToday: boolean
  items: ScheduleItem[]
}

/** Loose input used by the pure week builder. */
export type ScheduleSourceItem = {
  anime: Anime
  airWeekday: number
  airTime?: string
}
