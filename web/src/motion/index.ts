/* Car Spa motion: live HTML/CSS scenes that replace the explainer video. Each scene is its own module and CSS file,
   so the landing can lazy-load them: `lazy(() => import("../motion/HowItWorksScene").then(m => ({ default: m.HowItWorksScene })))`. */
export { HeroScene } from "./HeroScene";
export type { HeroSceneProps } from "./HeroScene";
export { HowItWorksScene } from "./HowItWorksScene";
export type { HowItWorksSceneProps } from "./HowItWorksScene";
export { DesktopTicketScene } from "./DesktopTicketScene";
export type { DesktopTicketSceneProps } from "./DesktopTicketScene";
export { SceneToggle } from "./SceneToggle";
export type { SceneToggleProps } from "./SceneToggle";
export { StepRail } from "./StepRail";
export { useSceneVisibility, useSceneController, usePrefersReducedMotion } from "./useSceneVisibility";
export type { SceneVisibility, SceneVisibilityOptions, SceneControllerOptions } from "./useSceneVisibility";
export { CONTROL_COPY, HERO_COPY, HOW_COPY, DESK_COPY, TICKET_COPY, WORK_TICKET_NUMBER } from "./copy";
export type { SceneLang } from "./copy";
export { SCENE_COPY } from "./copy-all";
export type { SceneCopy } from "./copy-all";
export { MuscleCar, MUSCLE_CAR_VIEWBOX, MUSCLE_CAR_WHEELS } from "./art/MuscleCar";
export type { MuscleCarProps } from "./art/MuscleCar";
export { MuscleCarFront, MUSCLE_CAR_FRONT_VIEWBOX } from "./art/MuscleCarFront";
export type { MuscleCarFrontProps } from "./art/MuscleCarFront";
