/** Shared types for the SparkleWash API spec UI */

export interface WebSocketEvent {
  readonly stationId: string;
  readonly state: "idle" | "washing" | "cleaning";
  readonly pressurePsi: number;
  readonly soapLevel: number;
  readonly sequence: number;
}

export type StationProps = { readonly stationId: string };
