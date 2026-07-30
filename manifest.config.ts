import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Session Manager',
  version: '0.2.0',
  description: 'Save and switch multiple sessions per website.',
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },
  background: { service_worker: 'src/background.ts', type: 'module' },
  permissions: ['cookies', 'storage', 'unlimitedStorage', 'scripting', 'tabs'],
  host_permissions: ['<all_urls>'],
})
