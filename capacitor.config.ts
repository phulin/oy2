import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'site.oyme',
  appName: 'Oy',
  webDir: 'dist/client',
  server: {
    url: process.env.CAP_SERVER_URL ?? 'https://oyme.site'
  }
};

export default config;
