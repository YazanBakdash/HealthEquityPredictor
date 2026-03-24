export interface PolicyParameter {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  impact: number; // Impact on life expectancy per unit
}

export interface PolicyArea {
  id: string;
  name: string;
  icon: string;
  parameters: PolicyParameter[];
}

export interface SimulationState {
  currentAreaId: string | null;
  parameterValues: Record<string, number>;
  predictedOutcome: number;
  isSimulating: boolean;
}
