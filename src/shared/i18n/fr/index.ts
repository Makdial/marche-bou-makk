import type { TranslationKey } from '../en';
import { frApp } from './app';
import { frShop } from './shop';
import { frNotify } from './notify';
import { frStaff } from './staff';
import { frErrors } from './errors';

export const fr: Record<TranslationKey, string> = {
  ...frApp,
  ...frShop,
  ...frNotify,
  ...frStaff,
  ...frErrors,
};
