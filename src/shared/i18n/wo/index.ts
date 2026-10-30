import type { TranslationKey } from '../en';
import { woApp } from './app';
import { woShop } from './shop';
import { woNotify } from './notify';
import { woStaff } from './staff';
import { woErrors } from './errors';

export const wo: Record<TranslationKey, string> = {
  ...woApp,
  ...woShop,
  ...woNotify,
  ...woStaff,
  ...woErrors,
};
