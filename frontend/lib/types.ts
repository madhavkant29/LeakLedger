export type Balance = {
  node_id: string;
  interval_start: string;
  interval_end: string;
  inflow_m3: number;
  measured_children_m3: number;
  known_unmetered_m3: number;
  storage_change_m3: number;
  residual_m3: number;
  residual_ratio: number;
  coverage: number;
  completeness: number;
  freshness_seconds: number;
  alignment_valid: boolean;
  state: string;
  evidence_quality: string;
  explanation: string;
  stop_reason?: string | null;
};

export type IncidentEvent = {
  timestamp: string;
  event_type: string;
  actor: string;
  detail: string;
  payload?: Record<string, unknown>;
};

export type RepairAction = {
  timestamp: string;
  actor: string;
  repair_type: string;
  location: string;
  notes: string;
  cost?: number | null;
  cause?: string | null;
};

export type Incident = {
  id: string;
  site_id: string;
  node_id: string;
  status: string;
  opened_at: string;
  residual_m3: number;
  residual_ratio: number;
  persistence_count: number;
  evidence_quality: string;
  deepest_trustworthy_node_id: string;
  boundary_explanation: string;
  events: IncidentEvent[];
  repair?: RepairAction | null;
  verification_valid_intervals: number;
  verification_required_intervals: number;
  pre_repair_residual_rate?: number | null;
  post_repair_residuals: number[];
  verification_last_interval_end?: string | null;
  current_balance?: Balance | null;
};

export type TopologyNode = {
  id: string;
  label: string;
  parent_id: string | null;
  kind: string;
  unit: string;
  active: boolean;
  expected_interval_minutes: number;
  known_unmetered_m3_per_interval: number;
  storage_capacity_m3: number | null;
  storage_change_m3_per_interval: number | null;
  buffered: boolean;
  state: string;
  balance: Balance | null;
};

export type TopoTreeNode = {
  id: string;
  label: string;
  children?: TopoTreeNode[];
};

export type TopologyResponse = {
  tree: TopoTreeNode[];
  nodes: TopologyNode[];
};

export type AuditEvent = {
  timestamp: string;
  event_type: string;
  actor: string;
  detail: string;
  correlation_id?: string | null;
  payload?: Record<string, unknown> | null;
};

export type MeterRow = {
  id: string;
  label: string;
  parent_id: string | null;
  kind: string;
  buffered: boolean;
  expected_interval_minutes: number;
  known_unmetered_m3_per_interval: number;
  active: boolean;
  latest_reading: { event_id: string; meter_id: string; timestamp: string; cumulative_m3: number } | null;
  reading_count: number;
  health: string;
  age_seconds: number | null;
};

export type SiteSettings = {
  minimum_residual_m3: number;
  minimum_residual_ratio: number;
  persistence_intervals: number;
  minimum_coverage: number;
  freshness_limit_seconds: number;
  alignment_tolerance_seconds: number;
  verification_required_intervals: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  site_timezone: string;
};

export type DemoState = {
  scenario: string;
  step: number;
  running: boolean;
  latest_balance: Balance | null;
  root_balance: Balance | null;
  incidents: Incident[];
};
