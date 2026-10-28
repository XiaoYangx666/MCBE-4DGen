/**
 * Candidate planners for the research harness.
 *
 * The implementation lives in `src/atlas-core/plan.ts` so the desktop and
 * browser production paths can share it. This module only keeps the research
 * names stable.
 */
import {
  planAtlasBudget,
  type AtlasBudgetOptions,
  type AtlasBudgetResult,
} from '../../../src/atlas-core/plan.ts';

export type CandidateOptions = AtlasBudgetOptions;
export type CandidateResult = AtlasBudgetResult;
export const planCandidate = planAtlasBudget;
