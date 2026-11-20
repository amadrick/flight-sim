// Every mission, in menu order (category, then order).
import { TRAINING } from './training.js';
import { CAMPAIGN } from './campaign.js';
import { INSTANT } from './instant.js';

const CAT = { training: 0, campaign: 1, instant: 2 };
export const MISSIONS = [...TRAINING, ...CAMPAIGN, ...INSTANT].sort((a, b) => CAT[a.category] - CAT[b.category] || a.order - b.order);
