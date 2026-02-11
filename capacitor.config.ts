import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'site.oyme',
  appName: 'Oy',
  webDir: 'dist/client',
  server: {
    url: 'https://oyme.site',
    iosScheme: 'https',
    androidScheme: 'https'
  },
  plugins: {
    SocialLogin: {
      google: true,
      apple: false,
      facebook: false,
      twitter: false,
    },
  },
};

export default config;
