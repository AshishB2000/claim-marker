export { DamageMarker } from './marker/DamageMarker'
export type { DamageMarkerHandle, DamageMarkerProps, ExportResult } from './marker/DamageMarker'

export { mount } from './marker/mount'
export type { MountOptions, MountedMarker } from './marker/mount'

export { ScenarioBuilder } from './scenario/ScenarioBuilder'
export type { ScenarioBuilderProps, ScenarioExport, ScenarioHandle } from './scenario/ScenarioBuilder'

export { mountScenario } from './scenario/mount'
export type { MountScenarioOptions, MountedScenario } from './scenario/mount'

export { SCHEMA, SEVERITIES, SEVERITY_COLOR, emptyValue, parse, parseDamages } from './schema'
export type { ClaimValue, Damage, Severity } from './schema'

export {
  ROLES,
  ROLE_COLOR,
  ROLE_LABEL,
  SCENARIO_SCHEMA,
  emptyScenario,
  parseScenario,
  seedVehicles,
} from './scenario/schema'
export type { Role, ScenarioValue, ScenarioVehicle } from './scenario/schema'

export { LAYOUTS, LAYOUT_IDS } from './scenario/layouts'
export type { LayoutId, Point2 } from './scenario/layouts'

export { VEHICLES, VEHICLE_IDS, ZONE_IDS, nearestZone, zoneById, zonesOf } from './zones'
export type { V3, Vehicle, Zone, ZoneId } from './zones'
