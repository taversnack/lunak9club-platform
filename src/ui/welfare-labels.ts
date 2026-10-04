export const INCIDENT_KIND_LABELS: Record<string, string> = {
  injury: 'Injury',
  illness: 'Illness',
  fight: 'Scuffle or fight',
  behaviour: 'Behaviour',
  escape: 'Escape or near miss',
  other: 'Other',
};

export const SEVERITY_LABELS: Record<string, string> = { minor: 'Minor', moderate: 'Moderate', serious: 'Serious' };
export const SEVERITY_TONE: Record<string, 'info' | 'warning' | 'danger'> = {
  minor: 'info',
  moderate: 'warning',
  serious: 'danger',
};

export const ATE_LABELS: Record<string, string> = {
  all: 'Ate everything',
  some: 'Ate some',
  none: 'Didn’t eat',
  not_fed: 'Not fed here',
};
export const DRINKING_LABELS: Record<string, string> = {
  normal: 'Drinking normally',
  more: 'Drinking more than usual',
  less: 'Drinking less than usual',
};
export const TOILET_LABELS: Record<string, string> = { normal: 'Toileting normal', unusual: 'Toileting unusual' };
export const MOOD_LABELS: Record<string, string> = { happy: 'Happy', settled: 'Settled', unsettled: 'Unsettled' };
