import { CONTROL_COPY, DESK_COPY, HERO_COPY, HOW_COPY, TICKET_COPY, type SceneLang } from "./copy";

/** Every scene string by language, for consumers that want them all (tests, a CMS export). Scenes import their own. */
export const SCENE_COPY = {
  es: { ...CONTROL_COPY.es, hero: HERO_COPY.es, how: HOW_COPY.es, desk: DESK_COPY.es, ticket: TICKET_COPY.es },
  en: { ...CONTROL_COPY.en, hero: HERO_COPY.en, how: HOW_COPY.en, desk: DESK_COPY.en, ticket: TICKET_COPY.en },
} satisfies Record<SceneLang, unknown>;

export type SceneCopy = (typeof SCENE_COPY)["es"];
