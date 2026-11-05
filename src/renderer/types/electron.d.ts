import { QuickFindApi } from '../../preload/api';

declare global {
  interface Window {
    quickFindApi: QuickFindApi;
  }
}

export {};

