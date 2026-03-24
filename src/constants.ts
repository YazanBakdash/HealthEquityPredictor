import { PolicyArea } from './types';

export const INITIAL_POLICY_AREAS: PolicyArea[] = [
  {
    id: 'urban-planning',
    name: 'Urban Planning',
    icon: 'Map',
    parameters: [
      { id: 'food-env', name: 'Food Environment', value: 65, min: 0, max: 100, unit: '%', impact: 0.02 },
      { id: 'grocery-access', name: 'Grocery Access', value: 42, min: 0, max: 100, unit: '%', impact: 0.015 },
      { id: 'zone-density', name: 'Zone Density', value: 30, min: 0, max: 100, unit: '%', impact: 0.01 },
    ],
  },
  {
    id: 'public-health',
    name: 'Public Health',
    icon: 'MedicalServices',
    parameters: [
      { id: 'healthcare-access', name: 'Healthcare Access', value: 72, min: 0, max: 100, unit: '%', impact: 0.03 },
      { id: 'mental-health', name: 'Mental Health Resources', value: 45, min: 0, max: 100, unit: '%', impact: 0.025 },
    ],
  },
  {
    id: 'education',
    name: 'Education',
    icon: 'School',
    parameters: [
      { id: 'school-funding', name: 'School Funding', value: 55, min: 0, max: 100, unit: '%', impact: 0.02 },
      { id: 'literacy-rate', name: 'Literacy Rate', value: 82, min: 0, max: 100, unit: '%', impact: 0.04 },
    ],
  },
  {
    id: 'environment',
    name: 'Environment',
    icon: 'Forest',
    parameters: [
      { id: 'tree-density', name: 'Tree Density', value: 28, min: 0, max: 100, unit: '%', impact: 0.015 },
      { id: 'air-quality', name: 'Air Quality', value: 80, min: 0, max: 100, unit: '%', impact: 0.035 },
    ],
  },
  {
    id: 'transit',
    name: 'Transit',
    icon: 'Bus',
    parameters: [
      { id: 'bus-frequency', name: 'Bus Frequency', value: 40, min: 0, max: 100, unit: '%', impact: 0.01 },
      { id: 'bike-lanes', name: 'Bike Lanes', value: 15, min: 0, max: 100, unit: '%', impact: 0.005 },
    ],
  },
];

export const BASE_LIFE_EXPECTANCY = 75.46;
