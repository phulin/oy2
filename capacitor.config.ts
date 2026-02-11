import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'site.oyme',
  appName: 'Oy',
  webDir: 'dist/client',
  server: {
    url: 'https://oyme.site',
    iosScheme: 'https',
    androidScheme: 'https'
  }
};

export default config;
