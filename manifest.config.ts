import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Session Manager',
  version: '0.1.0',
  description: 'Save and switch multiple sessions per website.',
  action: { default_popup: 'src/popup/index.html' },
  background: { service_worker: 'src/background.ts', type: 'module' },
  permissions: ['cookies', 'storage', 'unlimitedStorage', 'scripting', 'tabs'],
  host_permissions: ['<all_urls>'],
})
